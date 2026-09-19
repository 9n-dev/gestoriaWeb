import convertHeic from 'heic-convert';
import type { Job } from 'bullmq';
import { z } from 'zod';
import { deleteObject } from '@/lib/storage/multipart';
import { getObjectBytes, putObject } from '@/lib/storage/objects';
import { enqueue, QUEUES } from '@/lib/queue';
import { getVirusScanner } from '@/modules/documents/antivirus';
import { getDocumentExtractor } from '@/modules/documents/extraction';
import { extractDocument } from '@/modules/documents/extraction/service';
import { processFile, type ProcessingDeps } from '@/modules/documents/processing';

const processSchema = z.object({ tenantId: z.string().min(1), fileId: z.string().min(1) });
const extractSchema = z.object({ tenantId: z.string().min(1), documentId: z.string().min(1) });

const deps: ProcessingDeps = {
  getBytes: getObjectBytes,
  putBytes: putObject,
  deleteObject,
  scanner: getVirusScanner(),
  enqueueExtraction: (tenantId, documentId) =>
    enqueue(QUEUES.files, 'extract', { tenantId, documentId }, `extract_${documentId}`),
  convertHeicToJpeg: async (bytes) =>
    new Uint8Array(await convertHeic({ buffer: bytes, format: 'JPEG', quality: 0.9 })),
};

/**
 * Queue "files".
 * - process: everything between "the bytes are in the bucket" and "people may open it".
 * - extract: AI extraction of invoice fields. A provider error throws, so BullMQ retries it.
 */
export async function filesProcessor(job: Job): Promise<unknown> {
  if (job.name === 'extract') {
    const { tenantId, documentId } = extractSchema.parse(job.data);
    return extractDocument(tenantId, documentId, {
      extractor: getDocumentExtractor(),
      getBytes: getObjectBytes,
    });
  }
  const { tenantId, fileId } = processSchema.parse(job.data);
  await processFile(tenantId, fileId, deps);
}
