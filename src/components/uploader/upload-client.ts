/**
 * Browser side of the resumable upload (§6.3): compress photos, then send the file to the bucket
 * in parts with presigned URLs. Every network step is retried with backoff; if a file still fails,
 * `resume` asks the server which parts arrived and continues from there.
 */
const MAX_SIDE = 2500;
const JPEG_QUALITY = 0.8;
const ATTEMPTS = 6;

export type UploadMeta =
  | { purpose: 'DOCUMENT'; clientId: string; documentType: string; period: PeriodValue | null }
  | {
      purpose: 'PERMANENT_DOCUMENT';
      clientId: string;
      title: string;
      category: string;
      expiresAt: string;
    };
export type PeriodValue = { year: number; type: 'MONTH' | 'QUARTER' | 'YEAR'; ordinal: number };
type Ticket = { fileId: string; partSize: number; partCount: number; uploadedParts: number[] };

export class UploadError extends Error {
  constructor(
    message: string,
    /** Validation and permission errors: retrying will not help. */
    readonly permanent: boolean,
  ) {
    super(message);
  }
}

/** Photos are resized to 2500 px on the long side and re-encoded as JPEG 0.8. PDFs and HEIC pass through. */
export async function compressImage(file: File): Promise<File> {
  if (file.type !== 'image/jpeg' && file.type !== 'image/png') return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.(png|jpe?g)$/i, '') + '.jpg', {
      type: 'image/jpeg',
    });
  } catch {
    // A photo the browser cannot decode is sent as it is; the server decides.
    return file;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retries network failures and 5xx with exponential backoff; 4xx are final. */
async function withRetry<T>(step: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await step();
    } catch (error) {
      if (
        signal?.aborted ||
        (error instanceof UploadError && error.permanent) ||
        attempt === ATTEMPTS
      )
        throw error;
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 15_000));
    }
  }
}

async function api<T>(path: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    ...init,
    signal,
    headers: { 'Content-Type': 'application/json' },
  });
  if (response.ok) return (await response.json()) as T;
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  throw new UploadError(body.error ?? 'No se ha podido subir el archivo.', response.status < 500);
}

async function sendParts(
  file: File,
  ticket: Ticket,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
) {
  const done = new Set(ticket.uploadedParts);
  for (let partNumber = 1; partNumber <= ticket.partCount; partNumber++) {
    if (!done.has(partNumber)) {
      const chunk = file.slice((partNumber - 1) * ticket.partSize, partNumber * ticket.partSize);
      await withRetry(async () => {
        // Signed again on every attempt: URLs only live five minutes.
        const { url } = await api<{ url: string }>(
          `/api/uploads/${ticket.fileId}/parts`,
          { method: 'POST', body: JSON.stringify({ partNumber }) },
          signal,
        );
        const put = await fetch(url, { method: 'PUT', body: chunk, signal });
        if (!put.ok)
          throw new UploadError('El almacenamiento ha rechazado el archivo.', put.status < 500);
      }, signal);
    }
    onProgress(partNumber / ticket.partCount);
  }
  await withRetry(
    () => api(`/api/uploads/${ticket.fileId}/complete`, { method: 'POST' }, signal),
    signal,
  );
}

/** Returns the server file id as soon as it exists, so a failed upload can be resumed. */
export async function uploadFile(
  original: File,
  meta: UploadMeta,
  handlers: {
    onProgress(fraction: number): void;
    onFileId(fileId: string): void;
    signal?: AbortSignal;
  },
): Promise<void> {
  const file = await compressImage(original);
  const ticket = await withRetry(
    () =>
      api<Ticket>('/api/uploads', {
        method: 'POST',
        body: JSON.stringify({
          ...meta,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      }),
    handlers.signal,
  );
  handlers.onFileId(ticket.fileId);
  await sendParts(file, ticket, handlers.onProgress, handlers.signal);
}

/** Continues an upload that gave up: the bucket says which parts it already has. */
export async function resumeUpload(
  original: File,
  fileId: string,
  handlers: { onProgress(fraction: number): void; signal?: AbortSignal },
): Promise<void> {
  const file = await compressImage(original);
  const ticket = await withRetry(
    () => api<Ticket>(`/api/uploads/${fileId}`, { method: 'GET' }),
    handlers.signal,
  );
  await sendParts(file, ticket, handlers.onProgress, handlers.signal);
}
