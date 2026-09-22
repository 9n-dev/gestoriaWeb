import 'server-only';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/env';
import { getStorage } from './client';

const SIGNED_URL_SECONDS = 5 * 60;
const Bucket = env.S3_BUCKET;

/** S3 parts must be at least 5 MiB, except the last one. */
export const PART_SIZE = 5 * 1024 * 1024;

export async function createMultipartUpload(Key: string, ContentType: string): Promise<string> {
  const { UploadId } = await getStorage().send(
    new CreateMultipartUploadCommand({ Bucket, Key, ContentType }),
  );
  if (!UploadId) throw new Error(`no UploadId for ${Key}`);
  return UploadId;
}

/** The browser PUTs the part straight to the bucket with this URL. */
export const presignPart = (Key: string, UploadId: string, PartNumber: number): Promise<string> =>
  getSignedUrl(getStorage(), new UploadPartCommand({ Bucket, Key, UploadId, PartNumber }), {
    expiresIn: SIGNED_URL_SECONDS,
  });

export type UploadedPart = { partNumber: number; etag: string; size: number };

/** Source of truth for resuming: what the bucket has actually received. */
export async function listParts(Key: string, UploadId: string): Promise<UploadedPart[]> {
  const { Parts = [] } = await getStorage().send(new ListPartsCommand({ Bucket, Key, UploadId }));
  return Parts.map((part) => ({
    partNumber: part.PartNumber!,
    etag: part.ETag!,
    size: part.Size ?? 0,
  }));
}

export async function completeMultipartUpload(
  Key: string,
  UploadId: string,
  parts: UploadedPart[],
): Promise<void> {
  await getStorage().send(
    new CompleteMultipartUploadCommand({
      Bucket,
      Key,
      UploadId,
      MultipartUpload: {
        Parts: [...parts]
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
      },
    }),
  );
}

export async function abortMultipartUpload(Key: string, UploadId: string): Promise<void> {
  await getStorage().send(new AbortMultipartUploadCommand({ Bucket, Key, UploadId }));
}

export async function objectSize(Key: string): Promise<number> {
  const { ContentLength } = await getStorage().send(new HeadObjectCommand({ Bucket, Key }));
  return ContentLength ?? 0;
}

export async function deleteObject(Key: string): Promise<void> {
  await getStorage().send(new DeleteObjectCommand({ Bucket, Key }));
}

/** Deletes every object under a prefix (tenant purge). Returns how many went. */
export async function deletePrefix(Prefix: string): Promise<number> {
  let deleted = 0;
  for (;;) {
    // Always the first page: what was listed before is gone by now.
    const { Contents = [] } = await getStorage().send(new ListObjectsV2Command({ Bucket, Prefix }));
    if (Contents.length === 0) return deleted;
    await getStorage().send(
      new DeleteObjectsCommand({
        Bucket,
        Delete: { Objects: Contents.map(({ Key }) => ({ Key })), Quiet: true },
      }),
    );
    deleted += Contents.length;
  }
}

/** 5-minute URL. Only `/api/files/[id]` hands these out, after `can()` and the audit entry. */
export const signedDownloadUrl = (
  Key: string,
  fileName: string,
  contentType: string,
  inline: boolean,
): Promise<string> =>
  getSignedUrl(
    getStorage(),
    new GetObjectCommand({
      Bucket,
      Key,
      ResponseContentType: contentType,
      ResponseContentDisposition: `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    }),
    { expiresIn: SIGNED_URL_SECONDS },
  );

/**
 * Server-side multipart upload fed chunk by chunk: buffers to 5 MiB parts and sends each one as it
 * fills, so an object of any size is written with a bounded amount of memory. `close()` sends the
 * tail and completes the upload; returns the total size.
 */
export function multipartSink(Key: string, ContentType: string) {
  let uploadId: string | null = null;
  const parts: UploadedPart[] = [];
  const pending: Buffer[] = [];
  let buffered = 0;
  let total = 0;

  const flush = async () => {
    uploadId ??= await createMultipartUpload(Key, ContentType);
    const Body = Buffer.concat(pending.splice(0));
    buffered = 0;
    const PartNumber = parts.length + 1;
    const { ETag } = await getStorage().send(
      new UploadPartCommand({ Bucket, Key, UploadId: uploadId, PartNumber, Body }),
    );
    parts.push({ partNumber: PartNumber, etag: ETag!, size: Body.length });
  };

  return {
    write: async (chunk: Uint8Array) => {
      pending.push(Buffer.from(chunk));
      buffered += chunk.byteLength;
      total += chunk.byteLength;
      if (buffered >= PART_SIZE) await flush();
    },
    close: async (): Promise<number> => {
      if (buffered > 0 || parts.length === 0) await flush();
      await completeMultipartUpload(Key, uploadId!, parts);
      return total;
    },
    abort: async () => {
      if (uploadId) await abortMultipartUpload(Key, uploadId).catch(() => {});
    },
  };
}
