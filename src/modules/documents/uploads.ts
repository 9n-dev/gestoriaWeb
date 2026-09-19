import { randomUUID } from 'node:crypto';
import type { Period, StoredFile } from '@prisma/client';
import { prisma, tenantDb } from '@/lib/db';
import { toDateOnly } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { MAX_FILE_BYTES } from '@/lib/files/sniff';
import { enqueue, QUEUES } from '@/lib/queue';
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  deleteObject,
  listParts,
  objectSize,
  PART_SIZE,
  presignPart,
} from '@/lib/storage/multipart';
import { recordAudit } from '@/modules/audit/service';
import { refreshChecklist } from '@/modules/checklists/sync';
import {
  assertCan,
  can,
  type Action,
  type Resource,
  type SessionUser,
} from '@/modules/auth/permissions';
import { loadForStaff, resourceOf } from '@/modules/clients/service';
import { uploadRequestSchema, type UploadRequest } from './schema';

export type UploadTicket = {
  fileId: string;
  partSize: number;
  partCount: number;
  uploadedParts: number[];
};

type PeriodRef = Pick<Period, 'year' | 'type' | 'ordinal'>;
export const ensurePeriod = (period: PeriodRef) =>
  prisma.period.upsert({ where: { year_type_ordinal: period }, create: period, update: {} });

const PURPOSE_ACTION = {
  DOCUMENT: 'document.upload',
  PERMANENT_DOCUMENT: 'permanentDocument.manage',
  OBLIGATION_RECEIPT: 'obligation.update',
} as const satisfies Record<string, Action>;

/** Client resource for upload checks, including whether the target period is closed for it. */
async function uploadResource(
  user: SessionUser,
  clientId: string,
  periodId?: string | null,
): Promise<Resource> {
  const client = await loadForStaff(user, clientId);
  const closed = periodId
    ? await tenantDb(client.tenantId).clientPeriod.count({
        where: { clientId, periodId, status: 'CLOSED' },
      })
    : 0;
  return { ...resourceOf(client), periodClosed: closed > 0 };
}

/**
 * Step 1 of a resumable upload (§6.3). Creates the file (PENDING) with its owner row, so the
 * metadata chosen by the user survives until the bytes arrive, and opens an S3 multipart upload.
 * The browser then PUTs each part straight to the bucket with `signPart` URLs.
 */
export async function initiateUpload(
  user: SessionUser,
  input: UploadRequest,
): Promise<UploadTicket> {
  const request = uploadRequestSchema.parse(input);
  const period =
    request.purpose === 'DOCUMENT' && request.period ? await ensurePeriod(request.period) : null;
  const resource = await uploadResource(user, request.clientId, period?.id);
  // can() blocks client users when the period is closed; staff may still upload.
  const action = PURPOSE_ACTION[request.purpose];
  if (!can(user, action, resource) && can(user, action, { ...resource, periodClosed: false })) {
    throw new AppError(
      'FORBIDDEN',
      'La documentación de este periodo ya está cerrada. Escribe a tu gestor si necesitas añadir algo.',
    );
  }
  assertCan(user, action, resource);

  const { tenantId } = resource;
  const storageKey = `${tenantId}/clients/${request.clientId}/${randomUUID()}`;
  const multipartUploadId = await createMultipartUpload(storageKey, request.mimeType);
  const db = tenantDb(tenantId);

  const file = await db.storedFile.create({
    data: {
      tenantId,
      kind: request.purpose,
      status: 'PENDING',
      storageKey,
      originalName: request.fileName,
      mimeType: request.mimeType,
      sizeBytes: request.sizeBytes,
      multipartUploadId,
    },
  });
  if (request.purpose === 'DOCUMENT') {
    await db.document.create({
      data: {
        tenantId,
        clientId: request.clientId,
        fileId: file.id,
        type: request.documentType,
        periodId: period?.id,
        uploadedById: user.id,
        source: 'WEB',
      },
    });
  } else if (request.purpose === 'OBLIGATION_RECEIPT') {
    // The receipt ("justificante") of a filing. A new one replaces the previous file.
    const obligation = await db.obligation.findFirst({
      where: { id: request.obligationId, clientId: request.clientId },
      select: { id: true, receiptFileId: true },
    });
    if (!obligation) {
      await db.storedFile.delete({ where: { id: file.id } });
      throw new AppError('NOT_FOUND', 'No encontramos esa obligación.');
    }
    await db.obligation.update({ where: { id: obligation.id }, data: { receiptFileId: file.id } });
    if (obligation.receiptFileId) {
      await db.storedFile.update({
        where: { id: obligation.receiptFileId },
        data: { deletedAt: new Date() },
      });
    }
  } else {
    await db.permanentDocument.create({
      data: {
        tenantId,
        clientId: request.clientId,
        fileId: file.id,
        title: request.title,
        category: request.category,
        expiresAt: request.expiresAt ? toDateOnly(request.expiresAt) : null,
        uploadedById: user.id,
      },
    });
  }
  return { fileId: file.id, partSize: PART_SIZE, partCount: partCount(file), uploadedParts: [] };
}

const partCount = (file: Pick<StoredFile, 'sizeBytes'>) =>
  Math.max(1, Math.ceil(file.sizeBytes / PART_SIZE));

type PendingUpload = StoredFile & {
  multipartUploadId: string;
  clientId: string;
  periodId: string | null;
};

/** The pending upload, if this user may still write to the client it belongs to. */
async function loadUpload(
  user: SessionUser,
  fileId: string,
): Promise<StoredFile & { clientId: string; periodId: string | null }> {
  if (!user.tenantId)
    throw new AppError('FORBIDDEN', 'No tienes permiso para realizar esta acción.');
  const file = await tenantDb(user.tenantId).storedFile.findFirst({
    where: {
      id: fileId,
      kind: { in: ['DOCUMENT', 'PERMANENT_DOCUMENT', 'OBLIGATION_RECEIPT'] },
      deletedAt: null,
    },
    include: { document: true, permanentDocument: true, obligationReceipt: true },
  });
  const owner = file?.document ?? file?.permanentDocument ?? file?.obligationReceipt;
  if (!file || !owner) throw new AppError('NOT_FOUND', 'No encontramos esa subida.');

  const periodId = file.document?.periodId ?? null;
  assertCan(
    user,
    PURPOSE_ACTION[file.kind as keyof typeof PURPOSE_ACTION],
    await uploadResource(user, owner.clientId, periodId),
  );
  return { ...file, clientId: owner.clientId, periodId };
}

async function loadPending(user: SessionUser, fileId: string): Promise<PendingUpload> {
  const file = await loadUpload(user, fileId);
  if (file.status !== 'PENDING' || !file.multipartUploadId) {
    throw new AppError('CONFLICT', 'Esta subida ya ha terminado.');
  }
  return file as PendingUpload;
}

export async function signPart(
  user: SessionUser,
  fileId: string,
  partNumber: number,
): Promise<string> {
  const file = await loadPending(user, fileId);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > partCount(file)) {
    throw new AppError('VALIDATION', 'Número de parte no válido.');
  }
  return presignPart(file.storageKey, file.multipartUploadId, partNumber);
}

/** For resuming after a connection drop: which parts the bucket already has. */
export async function uploadStatus(user: SessionUser, fileId: string): Promise<UploadTicket> {
  const file = await loadPending(user, fileId);
  const parts = await listParts(file.storageKey, file.multipartUploadId);
  return {
    fileId,
    partSize: PART_SIZE,
    partCount: partCount(file),
    uploadedParts: parts.map((part) => part.partNumber),
  };
}

async function discard(file: StoredFile): Promise<void> {
  const db = tenantDb(file.tenantId);
  await db.document.deleteMany({ where: { fileId: file.id } });
  await db.permanentDocument.deleteMany({ where: { fileId: file.id } });
  await db.obligation.updateMany({
    where: { receiptFileId: file.id },
    data: { receiptFileId: null },
  });
  await db.storedFile.delete({ where: { id: file.id } });
}

/**
 * Last step: assembles the object, verifies its real size (the declared one is not trusted) and
 * hands the file to the worker. Safe to call twice.
 */
export async function completeUpload(
  user: SessionUser,
  fileId: string,
): Promise<{ fileId: string }> {
  const current = await loadUpload(user, fileId);
  if (current.status !== 'PENDING') return { fileId };
  const file = current as PendingUpload;

  const parts = await listParts(file.storageKey, file.multipartUploadId);
  if (parts.length !== partCount(file)) {
    throw new AppError(
      'CONFLICT',
      'La subida está incompleta. Vuelve a intentarlo.',
      `${parts.length}/${partCount(file)} parts`,
    );
  }
  await completeMultipartUpload(file.storageKey, file.multipartUploadId, parts);

  const sizeBytes = await objectSize(file.storageKey);
  if (sizeBytes === 0 || sizeBytes > MAX_FILE_BYTES) {
    await deleteObject(file.storageKey);
    await discard(file);
    throw new AppError(
      'VALIDATION',
      'El archivo supera el máximo de 20 MB.',
      `real size ${sizeBytes}`,
    );
  }

  const db = tenantDb(file.tenantId);
  await db.storedFile.update({
    where: { id: file.id },
    data: { status: 'UPLOADED', sizeBytes, multipartUploadId: null },
  });
  await db.client.update({ where: { id: file.clientId }, data: { lastActivityAt: new Date() } });
  await recordAudit({
    tenantId: file.tenantId,
    actor: user,
    action: `${file.kind === 'DOCUMENT' ? 'document' : file.kind === 'OBLIGATION_RECEIPT' ? 'obligationReceipt' : 'permanentDocument'}.upload`,
    entity: 'StoredFile',
    entityId: file.id,
    diff: { clientId: file.clientId, name: file.originalName, sizeBytes },
  });
  await refreshChecklist(file.tenantId, file.clientId, [file.periodId]);
  await enqueue(QUEUES.files, 'process', { tenantId: file.tenantId, fileId: file.id }, file.id);
  return { fileId };
}

export async function abortUpload(user: SessionUser, fileId: string): Promise<void> {
  const file = await loadPending(user, fileId);
  await abortMultipartUpload(file.storageKey, file.multipartUploadId);
  await discard(file);
}
