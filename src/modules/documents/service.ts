import { Prisma, type DocumentStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma, tenantDb } from '@/lib/db';
import { toDateOnly } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { signedDownloadUrl } from '@/lib/storage/multipart';
import { recordAudit } from '@/modules/audit/service';
import { refreshChecklist } from '@/modules/checklists/sync';
import {
  assertCan,
  can,
  requireTenantId,
  scopeFor,
  type Resource,
  type SessionUser,
} from '@/modules/auth/permissions';
import { getInvoice, invoiceResource } from '@/modules/billing/service';
import { deliveryResource, readableDelivery } from '@/modules/deliveries/access';
import { notifyClientUsers } from '@/modules/messaging/notifications';
import { readableThread, threadResource } from '@/modules/messaging/service';
import {
  DOCUMENT_TYPES,
  documentFieldsSchema,
  rejectionSchema,
  tenantDocumentSettingsSchema,
  type DocumentFieldsInput,
} from './schema';
import { ensurePeriod } from './uploads';

const documentSelect = {
  id: true,
  tenantId: true,
  clientId: true,
  type: true,
  status: true,
  source: true,
  createdAt: true,
  processedAt: true,
  rejectionReason: true,
  rejectionNote: true,
  duplicateOfId: true,
  supplierName: true,
  supplierTaxId: true,
  invoiceNumber: true,
  invoiceDate: true,
  taxBase: true,
  vatRate: true,
  vatAmount: true,
  total: true,
  vatBreakdown: true,
  extractionConfirmed: true,
  extractionStatus: true,
  confidence: true,
  periodId: true,
  period: { select: { year: true, type: true, ordinal: true } },
  file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, status: true } },
  client: { select: { id: true, legalName: true, assignedManagerId: true, status: true } },
  uploadedBy: { select: { name: true } },
} satisfies Prisma.DocumentSelect;

export type DocumentRow = Prisma.DocumentGetPayload<{ select: typeof documentSelect }>;

/** Uploads that never finished stay invisible; so do soft-deleted documents. */
const VISIBLE: Prisma.DocumentWhereInput = {
  deletedAt: null,
  file: { status: { not: 'PENDING' } },
};

export const resourceOf = (document: DocumentRow): Resource => ({
  tenantId: document.tenantId,
  clientId: document.clientId,
  assignedManagerId: document.client.assignedManagerId,
  clientStatus: document.client.status,
  fileStatus: document.file.status,
  documentStatus: document.status,
});

const notFound = () => new AppError('NOT_FOUND', 'No encontramos ese documento.');

/** A document the user may read. Not found and not allowed are indistinguishable. */
export async function getDocument(user: SessionUser, id: string): Promise<DocumentRow> {
  const document = await tenantDb(requireTenantId(user)).document.findFirst({
    where: { id, ...VISIBLE },
    select: documentSelect,
  });
  if (!document || !can(user, 'document.read', resourceOf(document))) throw notFound();
  return document;
}

export const inboxFiltersSchema = z.object({
  statuses: z
    .array(z.enum(['RECEIVED', 'IN_REVIEW', 'BOOKED', 'REJECTED', 'DUPLICATE']))
    .default(['RECEIVED', 'IN_REVIEW']),
  clientId: z.string().optional(),
  managerId: z.string().optional(),
  type: z.enum(DOCUMENT_TYPES).optional(),
  order: z.enum(['oldest', 'newest']).default('oldest'),
});
export type InboxFilters = z.input<typeof inboxFiltersSchema>;

/** Unified inbox (§6.10): documents of assigned clients for managers, of everybody for leads. */
export const INBOX_PAGE_SIZE = 300;

function inboxWhere(user: SessionUser, filters: InboxFilters): Prisma.DocumentWhereInput {
  const { statuses, clientId, managerId, type } = inboxFiltersSchema.parse(filters);
  const ownOnly = scopeFor(user, 'document.process') === 'assigned';
  return {
    ...VISIBLE,
    status: { in: statuses },
    type,
    clientId,
    client: { deletedAt: null, assignedManagerId: ownOnly ? user.id : managerId },
  };
}

/**
 * The work queue: the first 300 documents of the filter, in its order. It is a queue, not an
 * archive: processed documents leave it and the next ones come in, so there are no pages.
 */
export async function listInbox(
  user: SessionUser,
  filters: InboxFilters = {},
): Promise<DocumentRow[]> {
  assertCan(user, 'document.process');
  const { order } = inboxFiltersSchema.parse(filters);
  return tenantDb(requireTenantId(user)).document.findMany({
    where: inboxWhere(user, filters),
    select: documentSelect,
    orderBy: { createdAt: order === 'oldest' ? 'asc' : 'desc' },
    take: INBOX_PAGE_SIZE,
  });
}

/** How many documents match in total, to tell the manager when the queue is longer than the view. */
export async function countInbox(user: SessionUser, filters: InboxFilters = {}): Promise<number> {
  assertCan(user, 'document.process');
  return tenantDb(requireTenantId(user)).document.count({ where: inboxWhere(user, filters) });
}

export async function listClientDocuments(
  user: SessionUser,
  clientId: string,
): Promise<DocumentRow[]> {
  const documents = await tenantDb(requireTenantId(user)).document.findMany({
    where: { clientId, ...VISIBLE },
    select: documentSelect,
    orderBy: { createdAt: 'desc' },
    take: 300,
  });
  return documents.filter((document) => can(user, 'document.read', resourceOf(document)));
}

// ─────────────────────────── Processing ───────────────────────────

async function loadForProcessing(user: SessionUser, id: string): Promise<DocumentRow> {
  const document = await getDocument(user, id);
  assertCan(user, 'document.process', resourceOf(document));
  if (document.file.status !== 'CLEAN') {
    throw new AppError(
      'CONFLICT',
      'El archivo todavía se está analizando. Inténtalo en unos segundos.',
    );
  }
  return document;
}

async function transition(
  user: SessionUser,
  document: DocumentRow,
  status: DocumentStatus,
  data: Prisma.DocumentUncheckedUpdateInput = {},
): Promise<void> {
  const closing = status !== 'IN_REVIEW';
  await tenantDb(document.tenantId).document.update({
    where: { id: document.id },
    data: {
      status,
      processedById: closing ? user.id : null,
      processedAt: closing ? new Date() : null,
      ...data,
    },
  });
  await recordAudit({
    tenantId: document.tenantId,
    actor: user,
    action: `document.${status.toLowerCase()}`,
    entity: 'Document',
    entityId: document.id,
    diff: { before: document.status, after: status },
  });
  await refreshChecklist(document.tenantId, document.clientId, [document.periodId]);
}

/**
 * Fields typed by the manager (proposed by the AI extractor from phase 7). Saving moves a new
 * document to IN_REVIEW and runs the second duplicate check of §6.3: same supplier NIF, number
 * and date. A match is flagged (`duplicateOfId`) for the manager to confirm, never auto-closed.
 */
export async function updateDocumentFields(
  user: SessionUser,
  id: string,
  input: DocumentFieldsInput,
): Promise<{ possibleDuplicateOfId: string | null }> {
  const document = await loadForProcessing(user, id);
  const { period, invoiceDate, vatBreakdown, ...typed } = documentFieldsSchema.parse(input);
  // Several rates: the rows are the truth and the totals follow them (a single row is just the totals).
  const round = (value: number) => Math.round(value * 100) / 100;
  const breakdown = vatBreakdown.length > 1 ? vatBreakdown : null;
  const fields = breakdown
    ? {
        ...typed,
        taxBase: round(breakdown.reduce((sum, row) => sum + row.base, 0)),
        vatAmount: round(breakdown.reduce((sum, row) => sum + row.vat, 0)),
        vatRate: [...breakdown].sort((a, b) => b.base - a.base)[0]!.rate,
      }
    : typed;
  const db = tenantDb(document.tenantId);

  const twin =
    fields.supplierTaxId && fields.invoiceNumber && invoiceDate
      ? await db.document.findFirst({
          where: {
            ...VISIBLE,
            id: { not: id },
            clientId: document.clientId,
            status: { notIn: ['REJECTED', 'DUPLICATE'] },
            supplierTaxId: fields.supplierTaxId,
            invoiceNumber: { equals: fields.invoiceNumber, mode: 'insensitive' },
            invoiceDate: toDateOnly(invoiceDate),
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        })
      : null;

  const periodId = period ? (await ensurePeriod(period)).id : null;
  await db.document.update({
    where: { id },
    data: {
      ...fields,
      vatBreakdown: breakdown ?? Prisma.JsonNull,
      invoiceDate: invoiceDate ? toDateOnly(invoiceDate) : null,
      periodId,
      status: document.status === 'RECEIVED' ? 'IN_REVIEW' : document.status,
      duplicateOfId: twin?.id ?? null,
    },
  });
  await recordAudit({
    tenantId: document.tenantId,
    actor: user,
    action: 'document.updateFields',
    entity: 'Document',
    entityId: id,
    diff: {
      ...fields,
      vatBreakdown: breakdown,
      invoiceDate,
      possibleDuplicateOfId: twin?.id ?? null,
    },
  });
  await refreshChecklist(document.tenantId, document.clientId, [document.periodId, periodId]);
  return { possibleDuplicateOfId: twin?.id ?? null };
}

export async function confirmFields(user: SessionUser, id: string): Promise<void> {
  const document = await loadForProcessing(user, id);
  await tenantDb(document.tenantId).document.update({
    where: { id },
    data: {
      extractionConfirmed: true,
      extractionConfirmedById: user.id,
      extractionConfirmedAt: new Date(),
      status: document.status === 'RECEIVED' ? 'IN_REVIEW' : document.status,
    },
  });
  await recordAudit({
    tenantId: document.tenantId,
    actor: user,
    action: 'document.confirmFields',
    entity: 'Document',
    entityId: id,
  });
}

export async function bookDocument(user: SessionUser, id: string): Promise<void> {
  await transition(user, await loadForProcessing(user, id), 'BOOKED', { duplicateOfId: null });
}

export async function getRejectionReasons(tenantId: string): Promise<string[]> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { settings: true },
  });
  return tenantDocumentSettingsSchema.parse(tenant.settings ?? {}).rejectionReasons;
}

export async function updateRejectionReasons(user: SessionUser, reasons: string[]): Promise<void> {
  assertCan(user, 'tenantSettings.manage');
  const tenantId = requireTenantId(user);
  const rejectionReasons = z
    .array(z.string().trim().min(3).max(120))
    .min(1, 'Deja al menos un motivo.')
    .max(30)
    .parse(reasons);
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { settings: true },
  });
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { settings: { ...(tenant.settings as Prisma.JsonObject), rejectionReasons } },
  });
  await recordAudit({
    tenantId,
    actor: user,
    action: 'tenant.updateRejectionReasons',
    entity: 'Tenant',
    entityId: tenantId,
    diff: { rejectionReasons },
  });
}

/** Rejection with a reason from the tenant's list plus free text; the client knows immediately (§6.3). */
export async function rejectDocument(
  user: SessionUser,
  id: string,
  input: { reason: string; note?: string | null },
): Promise<void> {
  const document = await loadForProcessing(user, id);
  const { reason, note } = rejectionSchema.parse(input);
  if (!(await getRejectionReasons(document.tenantId)).includes(reason)) {
    throw new AppError('VALIDATION', 'Elige un motivo de la lista.');
  }
  await transition(user, document, 'REJECTED', { rejectionReason: reason, rejectionNote: note });
  await notifyClientUsers(document.tenantId, document.clientId, {
    type: 'DOCUMENT_REJECTED',
    title: `Necesitamos que revises «${document.file.originalName}»`,
    body: [reason, note].filter(Boolean).join('. '),
    link: '/documentos',
  });
}

/** Confirms a flagged duplicate, or marks one by hand (then `duplicateOfId` may stay empty). */
export async function markDuplicate(user: SessionUser, id: string): Promise<void> {
  await transition(user, await loadForProcessing(user, id), 'DUPLICATE');
}

/** Back to the inbox from any closed state. */
export async function reopenDocument(user: SessionUser, id: string): Promise<void> {
  await transition(user, await loadForProcessing(user, id), 'IN_REVIEW', {
    rejectionReason: null,
    rejectionNote: null,
  });
}

/** Soft delete. Clients may withdraw a document only while nobody has started on it. */
export async function deleteDocument(user: SessionUser, id: string): Promise<void> {
  const document = await getDocument(user, id);
  assertCan(user, 'document.delete', resourceOf(document));
  await tenantDb(document.tenantId).document.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  await refreshChecklist(document.tenantId, document.clientId, [document.periodId]);
  await recordAudit({
    tenantId: document.tenantId,
    actor: user,
    action: 'document.delete',
    entity: 'Document',
    entityId: id,
  });
}

// ─────────────────────────── File access ───────────────────────────

/**
 * The only way to a file: permission, audit entry, then a 5-minute signed URL (§6.13).
 * Covers documents and permanent documents; deliveries and invoices join in their phases.
 */
export async function fileAccessUrl(
  user: SessionUser,
  fileId: string,
  { inline, ip, userAgent }: { inline: boolean; ip?: string | null; userAgent?: string | null },
): Promise<string> {
  const tenantId = requireTenantId(user);
  const file = await tenantDb(tenantId).storedFile.findFirst({
    where: { id: fileId, deletedAt: null },
    include: {
      document: { select: { id: true, deletedAt: true } },
      invoicePdf: { select: { id: true } },
      messageAttachment: { select: { id: true, message: { select: { threadId: true } } } },
      delivery: { select: { id: true, deletedAt: true } },
      deliveryCertificate: { select: { id: true, deletedAt: true } },
      obligationReceipt: {
        select: {
          id: true,
          client: { select: { id: true, assignedManagerId: true, status: true } },
        },
      },
      permanentDocument: {
        select: {
          id: true,
          deletedAt: true,
          client: { select: { id: true, assignedManagerId: true, status: true } },
        },
      },
    },
  });

  let entity: { name: string; id: string };
  if (file?.document && !file.document.deletedAt) {
    const document = await getDocument(user, file.document.id);
    assertCan(user, 'document.download', resourceOf(document));
    entity = { name: 'Document', id: document.id };
  } else if (file?.permanentDocument && !file.permanentDocument.deletedAt) {
    const { client, id } = file.permanentDocument;
    const resource: Resource = {
      tenantId,
      clientId: client.id,
      assignedManagerId: client.assignedManagerId,
      clientStatus: client.status,
      fileStatus: file.status,
    };
    if (!can(user, 'permanentDocument.read', resource)) throw notFound();
    assertCan(user, 'permanentDocument.download', resource);
    entity = { name: 'PermanentDocument', id };
  } else if (file?.messageAttachment) {
    // Internal threads are refused to client users inside readableThread (can() + `internal`).
    const thread = await readableThread(user, file.messageAttachment.message.threadId);
    assertCan(user, 'messageAttachment.download', {
      ...threadResource(thread),
      fileStatus: file.status,
    });
    entity = { name: 'Thread', id: thread.id };
  } else if (file?.delivery ?? file?.deliveryCertificate) {
    // Same rules for the delivered file and for its signature certificate. The audit entries
    // written below are the view/download history of the delivery (§6.7, ADR 0008).
    const delivery = await readableDelivery(user, (file.delivery ?? file.deliveryCertificate)!.id);
    assertCan(user, 'delivery.download', {
      ...deliveryResource(delivery),
      fileStatus: file.status,
    });
    entity = { name: 'Delivery', id: delivery.id };
  } else if (file?.invoicePdf) {
    const invoice = await getInvoice(user, file.invoicePdf.id);
    assertCan(user, 'invoice.download', { ...invoiceResource(invoice), fileStatus: file.status });
    entity = { name: 'Invoice', id: invoice.id };
  } else if (file?.obligationReceipt) {
    const { client, id } = file.obligationReceipt;
    const resource: Resource = {
      tenantId,
      clientId: client.id,
      assignedManagerId: client.assignedManagerId,
      clientStatus: client.status,
      fileStatus: file.status,
    };
    if (!can(user, 'obligation.read', resource)) throw notFound();
    assertCan(user, 'obligationReceipt.download', resource);
    entity = { name: 'Obligation', id };
  } else {
    throw notFound();
  }

  await recordAudit({
    tenantId,
    actor: user,
    action: inline ? 'file.view' : 'file.download',
    entity: entity.name,
    entityId: entity.id,
    ip,
    userAgent,
  });
  return signedDownloadUrl(file.storageKey, file.originalName, file.mimeType, inline);
}
