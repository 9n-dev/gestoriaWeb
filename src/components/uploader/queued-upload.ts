import { queueAdd, queueRemove, queueSetFileId } from './offline-queue';
import { resumeUpload, uploadFile, UploadError, type UploadMeta } from './upload-client';

type Handlers = { onProgress(progress: number): void; onFileId(fileId: string): void };

/**
 * `uploadFile` with a safety net: the file is written to IndexedDB before the first byte leaves and
 * removed when the server has it (or refuses it for good). A connection lost half-way leaves the
 * entry behind, and `PendingUploads` sends it the next time the person is online (TD-071).
 */
export async function queuedUpload(
  file: File,
  meta: UploadMeta,
  handlers: Handlers,
): Promise<void> {
  const queueId = await queueAdd({ file, meta }).catch(() => undefined);
  const forget = () => {
    if (queueId !== undefined) queueRemove(queueId).catch(() => {});
  };
  try {
    await uploadFile(file, meta, {
      onProgress: handlers.onProgress,
      onFileId: (fileId) => {
        handlers.onFileId(fileId);
        if (queueId !== undefined) queueSetFileId(queueId, fileId).catch(() => {});
      },
    });
    forget();
  } catch (error) {
    if (error instanceof UploadError && error.permanent) forget();
    throw error;
  }
}

/**
 * Sends one entry left over from an earlier visit. The server file id is remembered as soon as it
 * exists, so a second interruption resumes the same upload instead of starting another.
 */
export const sendPending = (entry: {
  id: number;
  file: File;
  meta: UploadMeta;
  fileId?: string;
}) =>
  entry.fileId
    ? resumeUpload(entry.file, entry.fileId, { onProgress: () => {} })
    : uploadFile(entry.file, entry.meta, {
        onProgress: () => {},
        onFileId: (fileId) => queueSetFileId(entry.id, fileId).catch(() => {}),
      });
