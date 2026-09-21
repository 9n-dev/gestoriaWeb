import { tenantDb } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { enqueue, QUEUES } from '@/lib/queue';
import { recordAudit } from '@/modules/audit/service';
import { assertCan, type SessionUser } from '@/modules/auth/permissions';
import { getDocument, resourceOf } from '@/modules/documents/service';

/** Each read costs tokens that the tenant pays for (§6.4): a document is not read more than this. */
export const MAX_EXTRACTIONS_PER_DOCUMENT = 3;

/**
 * "Leer de nuevo": throws the current reading away and queues the document for extraction again.
 * For a read that failed or came out wrong (a blurry first page, the wrong total). What the manager
 * typed goes too — that is the point — so booked documents are left alone.
 */
export async function requestReextraction(user: SessionUser, documentId: string): Promise<void> {
  const document = await getDocument(user, documentId);
  assertCan(user, 'document.process', resourceOf(document));
  if (document.status !== 'RECEIVED' && document.status !== 'IN_REVIEW') {
    throw new AppError('CONFLICT', 'Devuelve el documento a la bandeja antes de leerlo de nuevo.');
  }
  if (document.extractionStatus === 'PENDING' || document.extractionStatus === 'PROCESSING') {
    throw new AppError('CONFLICT', 'Ya se está leyendo. Espera unos segundos.');
  }
  const db = tenantDb(document.tenantId);
  const reads = await db.aiUsageLog.count({ where: { documentId } });
  if (reads >= MAX_EXTRACTIONS_PER_DOCUMENT) {
    throw new AppError(
      'CONFLICT',
      `Este documento ya se ha leído ${reads} veces. Corrige los datos a mano.`,
    );
  }

  await db.document.update({
    where: { id: documentId },
    data: {
      extractionStatus: 'PENDING',
      extractionConfirmed: false,
      supplierName: null,
      supplierTaxId: null,
      invoiceNumber: null,
      invoiceDate: null,
      taxBase: null,
      vatRate: null,
      vatAmount: null,
      total: null,
      confidence: null,
    },
  });
  // A job id of its own: the id of the first extraction is already taken in the queue.
  await enqueue(
    QUEUES.files,
    'extract',
    { tenantId: document.tenantId, documentId },
    `extract_${documentId}_retry${reads + 1}`,
  );
  await recordAudit({
    tenantId: document.tenantId,
    actor: user,
    action: 'document.reextract',
    entity: 'Document',
    entityId: documentId,
    diff: { previousReads: reads },
  });
}
