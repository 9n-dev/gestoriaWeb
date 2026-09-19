/**
 * BullMQ worker process (Railway / Fly.io in production, `npm run worker` in development).
 * One file per job in this folder; payloads are validated with Zod before use.
 */
import convertHeic from 'heic-convert';
import { z } from 'zod';
import { createWorker, QUEUES } from '@/lib/queue';
import { deleteObject } from '@/lib/storage/multipart';
import { getObjectBytes, putObject } from '@/lib/storage/objects';
import { getVirusScanner } from '@/modules/documents/antivirus';
import { processFile, type ProcessingDeps } from '@/modules/documents/processing';

const fileJobSchema = z.object({ tenantId: z.string().min(1), fileId: z.string().min(1) });

const deps: ProcessingDeps = {
  getBytes: getObjectBytes,
  putBytes: putObject,
  deleteObject,
  scanner: getVirusScanner(),
  convertHeicToJpeg: async (bytes) =>
    new Uint8Array(await convertHeic({ buffer: bytes, format: 'JPEG', quality: 0.9 })),
};

const worker = createWorker(QUEUES.files, async (job) => {
  const { tenantId, fileId } = fileJobSchema.parse(job.data);
  await processFile(tenantId, fileId, deps);
});

worker.on('failed', (job, error) =>
  console.error(
    `[worker] ${job?.name} ${job?.id} failed (attempt ${job?.attemptsMade}):`,
    error.message,
  ),
);
worker.on('ready', () => console.info('[worker] ready: files'));

const shutdown = async () => {
  await worker.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
