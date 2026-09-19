import { randomUUID } from 'node:crypto';
import type { FileKind, Period, StoredFile } from '@prisma/client';
import type { z } from 'zod';
import { prisma, tenantDb, type TenantDb } from '@/lib/db';
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
import { attachableMessage } from '@/modules/messaging/service';
import { uploadRequestSchema, type UploadRequest } from './schema';

export type UploadTicket = {
  fileId: string;
  partSize: number;
  partCount: number;
  uploadedParts: number[];
};

type Request = z.output<typeof uploadRequestSchema>;
type Purpose = Request['purpose'];
type PeriodRef = Pick<Period, 'year' | 'type' | 'ordinal'>;

export const ensurePeriod = (period: PeriodRef) =>
  prisma.period.upsert({ where: { year_type_ordinal: period }, create: period, update: {} });

/** What a user needs to be allowed to do, on the client the file belongs to. */
const PURPOSE_ACTION: Record<Exclude<Purpose, 'MESSAGE_ATTACHMENT'>, Action> = {
  DOCUMENT: 'document.upload',
  PERMANENT_DOCUMENT: 'permanentDocument.manage',
  OBLIGATION_RECEIPT: 'obligation.update',
  DELIVERY: 'delivery.create',
};

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
 * May this user upload (or keep uploading) a file of this kind for this client?
 * Message attachments follow the message: only its author, for a short while after sending it.
 */
async function authorize(
  user: SessionUser,
  purpose: Purpose,
  clientId: string,
  context: { periodId?: string | null; messageId?: string },
): Promise<string> {
  if (purpose === 'MESSAGE_ATTACHMENT') {
    const message = await attachableMessage(user, context.messageId ?? '');
    if (message.clientId !== clientId)
      throw new AppError('NOT_FOUND', 'No encontramos ese mensaje.');
    return message.tenantId;
  }

  const resource = await uploadResource(user, clientId, context.periodId);
  const action = PURPOSE_ACTION[purpose];
  // can() blocks client users when the period is closed; staff may still upload.
  if (!can(user, action, resource) && can(user, action, { ...resource, periodClosed: false })) {
    throw new AppError(
      'FORBIDDEN',
      'La documentación de este periodo ya está cerrada. Escribe a tu gestor si necesitas añadir algo.',
    );
  }
  assertCan(user, action, resource);
  return resource.tenantId;
}

/** The row that gives the file its meaning. Created with the file, so the metadata survives the upload. */
async function createOwner(
  db: TenantDb,
  user: SessionUser,
  tenantId: string,
  fileId: string,
  request: Request,
  periodId: string | null,
): Promise<void> {
  const base = { tenantId, clientId: request.clientId, fileId };
  switch (request.purpose) {
    case 'DOCUMENT':
      await db.document.create({
        data: {
          ...base,
          type: request.documentType,
          periodId,
          uploadedById: user.id,
          source: 'WEB',
        },
      });
      return;
    case 'PERMANENT_DOCUMENT':
      await db.permanentDocument.create({
        data: {
          ...base,
          title: request.title,
          category: request.category,
          expiresAt: request.expiresAt ? toDateOnly(request.expiresAt) : null,
          uploadedById: user.id,
        },
      });
      return;
    case 'DELIVERY':
      await db.delivery.create({
        data: {
          ...base,
          title: request.title,
          category: request.category,
          periodId,
          visibleFrom: request.visibleFrom ? toDateOnly(request.visibleFrom) : new Date(),
          requiresSignature: request.requiresSignature,
          uploadedById: user.id,
        },
      });
      return;
    case 'MESSAGE_ATTACHMENT':
      await db.messageAttachment.create({
        data: { tenantId, messageId: request.messageId, fileId },
      });
      return;
    case 'OBLIGATION_RECEIPT': {
      // The receipt ("justificante") of a filing. A new one replaces the previous file.
      const obligation = await db.obligation.findFirst({
        where: { id: request.obligationId, clientId: request.clientId },
        select: { id: true, receiptFileId: true },
      });
      if (!obligation) throw new AppError('NOT_FOUND', 'No encontramos esa obligación.');
      await db.obligation.update({ where: { id: obligation.id }, data: { receiptFileId: fileId } });
      if (obligation.receiptFileId) {
        await db.storedFile.update({
          where: { id: obligation.receiptFileId },
          data: { deletedAt: new Date() },
        });
      }
    }
  }
}

/**
 * Step 1 of a resumable upload (§6.3). Creates the file (PENDING) with its owner row and opens an
 * S3 multipart upload. The browser then PUTs each part straight to the bucket with `signPart` URLs.
 */
export async function initiateUpload(
  user: SessionUser,
  input: UploadRequest,
): Promise<UploadTicket> {
  const request = uploadRequestSchema.parse(input);
  const period =
    (request.purpose === 'DOCUMENT' || request.purpose === 'DELIVERY') && request.period
      ? await ensurePeriod(request.period)
      : null;
  const tenantId = await authorize(user, request.purpose, request.clientId, {
    periodId: request.purpose === 'DOCUMENT' ? period?.id : null,
    messageId: request.purpose === 'MESSAGE_ATTACHMENT' ? request.messageId : undefined,
  });

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
  try {
    await createOwner(db, user, tenantId, file.id, request, period?.id ?? null);
  } catch (error) {
    await db.storedFile.delete({ where: { id: file.id } });
    throw error;
  }
  return { fileId: file.id, partSize: PART_SIZE, partCount: partCount(file), uploadedParts: [] };
}

const partCount = (file: Pick<StoredFile, 'sizeBytes'>) =>
  Math.max(1, Math.ceil(file.sizeBytes / PART_SIZE));

const UPLOAD_KINDS: FileKind[] = [
  'DOCUMENT',
  'PERMANENT_DOCUMENT',
  'OBLIGATION_RECEIPT',
  'DELIVERY',
  'MESSAGE_ATTACHMENT',
];

type Upload = StoredFile & { clientId: string; periodId: string | null };
type PendingUpload = Upload & { multipartUploadId: string };

/** The upload, if this user may still write to whatever it belongs to. */
async function loadUpload(user: SessionUser, fileId: string): Promise<Upload> {
  if (!user.tenantId) {
    throw new AppError('FORBIDDEN', 'No tienes permiso para realizar esta acción.');
  }
  const file = await tenantDb(user.tenantId).storedFile.findFirst({
    where: { id: fileId, kind: { in: UPLOAD_KINDS }, deletedAt: null },
    include: {
      document: true,
      permanentDocument: true,
      obligationReceipt: true,
      delivery: true,
      messageAttachment: { include: { message: { include: { thread: true } } } },
    },
  });
  const clientId =
    file?.document?.clientId ??
    file?.permanentDocument?.clientId ??
    file?.obligationReceipt?.clientId ??
    file?.delivery?.clientId ??
    file?.messageAttachment?.message.thread.clientId;
  if (!file || !clientId) throw new AppError('NOT_FOUND', 'No encontramos esa subida.');

  const periodId = file.document?.periodId ?? null;
  await authorize(user, file.kind as Purpose, clientId, {
    periodId,
    messageId: file.messageAttachment?.messageId,
  });
  return { ...file, clientId, periodId };
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

/** Removes the file row and whatever was created with it. Also used by the cleanup job. */
export async function discardUpload(file: Pick<StoredFile, 'id' | 'tenantId'>): Promise<void> {
  const db = tenantDb(file.tenantId);
  await db.document.deleteMany({ where: { fileId: file.id } });
  await db.permanentDocument.deleteMany({ where: { fileId: file.id } });
  await db.delivery.deleteMany({ where: { fileId: file.id } });
  await db.messageAttachment.deleteMany({ where: { fileId: file.id } });
  await db.obligation.updateMany({
    where: { receiptFileId: file.id },
    data: { receiptFileId: null },
  });
  await db.storedFile.delete({ where: { id: file.id } });
}

const AUDIT_ENTITY: Record<Purpose, string> = {
  DOCUMENT: 'document',
  PERMANENT_DOCUMENT: 'permanentDocument',
  OBLIGATION_RECEIPT: 'obligationReceipt',
  DELIVERY: 'delivery',
  MESSAGE_ATTACHMENT: 'messageAttachment',
};

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
    await discardUpload(file);
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
    action: `${AUDIT_ENTITY[file.kind as Purpose]}.upload`,
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
  await discardUpload(file);
}
