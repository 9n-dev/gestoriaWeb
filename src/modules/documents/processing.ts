import { createHash } from 'node:crypto';
import { tenantDb } from '@/lib/db';
import { sniffDocumentType } from '@/lib/files/sniff';
import { recordAudit } from '@/modules/audit/service';
import { refreshChecklist } from '@/modules/checklists/sync';
import { announceDeliveries } from '@/modules/deliveries/service';
import { notifyClientUsers } from '@/modules/messaging/notifications';
import type { VirusScanner } from './antivirus';

export type ProcessingDeps = {
  getBytes(key: string): Promise<Uint8Array>;
  putBytes(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  convertHeicToJpeg(bytes: Uint8Array): Promise<Uint8Array>;
  scanner: VirusScanner;
};

const BLOCKED_REASON = 'Archivo bloqueado por seguridad';
const UNSUPPORTED_REASON = 'Formato de archivo no admitido';

/**
 * Everything that happens to a file between "the bytes are in the bucket" and "people may open
 * it" (§6.3): real type from the bytes, antivirus, HEIC → JPEG, SHA-256, exact duplicates.
 * Idempotent: only files in UPLOADED are touched, so BullMQ retries and double deliveries are safe.
 * A scanner error throws (the job is retried); it never lets the file through.
 */
export async function processFile(
  tenantId: string,
  fileId: string,
  deps: ProcessingDeps,
): Promise<void> {
  const db = tenantDb(tenantId);
  const file = await db.storedFile.findFirst({
    where: { id: fileId, status: 'UPLOADED', deletedAt: null },
    include: { document: true },
  });
  if (!file) return;

  const original = await deps.getBytes(file.storageKey);
  const type = sniffDocumentType(original);
  const scan = type ? await deps.scanner.scan(original) : null;

  if (!type || scan?.infected) {
    // The object is removed either way; the row stays as evidence and is never served.
    await deps.deleteObject(file.storageKey);
    await db.storedFile.update({
      where: { id: file.id },
      data: {
        status: scan?.infected ? 'INFECTED' : 'UPLOADED',
        scannedAt: new Date(),
        deletedAt: new Date(),
      },
    });
    await recordAudit({
      tenantId,
      action: scan?.infected ? 'file.infected' : 'file.unsupported',
      entity: 'StoredFile',
      entityId: file.id,
      diff: { name: file.originalName, signature: scan?.infected ? scan.signature : null },
    });
    if (file.document) {
      const reason = scan?.infected ? BLOCKED_REASON : UNSUPPORTED_REASON;
      await db.document.update({
        where: { id: file.document.id },
        data: {
          status: 'REJECTED',
          rejectionReason: reason,
          processedAt: new Date(),
          extractionStatus: 'NOT_APPLICABLE',
        },
      });
      await notifyClientUsers(tenantId, file.document.clientId, {
        type: 'DOCUMENT_REJECTED',
        title: `No hemos podido aceptar «${file.originalName}»`,
        body: `${reason}. Vuelve a enviarlo como foto (JPG, PNG, HEIC) o PDF.`,
        link: '/documentos',
      });
      await refreshChecklist(tenantId, file.document.clientId, [file.document.periodId]);
    }
    return;
  }

  let { storageKey, originalName } = file;
  let bytes = original;
  let mimeType: string = type.mime;
  if (type.mime === 'image/heic') {
    bytes = await deps.convertHeicToJpeg(original);
    storageKey = `${file.storageKey}.jpg`;
    originalName = originalName.replace(/\.(heic|heif)$/i, '') + '.jpg';
    mimeType = 'image/jpeg';
    await deps.putBytes(storageKey, bytes, mimeType);
    await deps.deleteObject(file.storageKey);
  }

  // Hash of what the client sent, so re-sending the same photo is caught even after conversion.
  const sha256 = createHash('sha256').update(original).digest('hex');
  await db.storedFile.update({
    where: { id: file.id },
    data: {
      status: 'CLEAN',
      scannedAt: new Date(),
      sha256,
      storageKey,
      originalName,
      mimeType,
      sizeBytes: bytes.length,
    },
  });

  if (file.kind === 'DELIVERY') await announceDeliveries(tenantId, { fileId: file.id });

  if (file.document) {
    const twin = await db.document.findFirst({
      where: {
        id: { not: file.document.id },
        clientId: file.document.clientId,
        deletedAt: null,
        status: { notIn: ['REJECTED', 'DUPLICATE'] },
        file: { sha256, status: 'CLEAN' },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (twin) {
      await db.document.update({
        where: { id: file.document.id },
        data: {
          status: 'DUPLICATE',
          duplicateOfId: twin.id,
          processedAt: new Date(),
          extractionStatus: 'NOT_APPLICABLE',
        },
      });
      await recordAudit({
        tenantId,
        action: 'document.duplicateDetected',
        entity: 'Document',
        entityId: file.document.id,
        diff: { duplicateOfId: twin.id, by: 'sha256' },
      });
      await refreshChecklist(tenantId, file.document.clientId, [file.document.periodId]);
    }
  }
}
