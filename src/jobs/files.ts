import convertHeic from 'heic-convert';
import type { Job } from 'bullmq';
import { z } from 'zod';
import { deleteObject } from '@/lib/storage/multipart';
import { getObjectBytes, putObject } from '@/lib/storage/objects';
import { getVirusScanner } from '@/modules/documents/antivirus';
import { processFile, type ProcessingDeps } from '@/modules/documents/processing';

const payloadSchema = z.object({ tenantId: z.string().min(1), fileId: z.string().min(1) });

const deps: ProcessingDeps = {
  getBytes: getObjectBytes,
  putBytes: putObject,
  deleteObject,
  scanner: getVirusScanner(),
  convertHeicToJpeg: async (bytes) =>
    new Uint8Array(await convertHeic({ buffer: bytes, format: 'JPEG', quality: 0.9 })),
};

/** Queue "files": everything between "the bytes are in the bucket" and "people may open it". */
export async function filesProcessor(job: Job): Promise<void> {
  const { tenantId, fileId } = payloadSchema.parse(job.data);
  await processFile(tenantId, fileId, deps);
}
