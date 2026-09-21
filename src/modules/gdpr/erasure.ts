import { Prisma } from '@prisma/client';
import { prisma, tenantDb } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { enqueue, QUEUES } from '@/lib/queue';
import { deleteObject, deletePrefix } from '@/lib/storage/multipart';
import { recordAudit } from '@/modules/audit/service';
import { notifyUsers } from '@/modules/messaging/notifications';
import { assertCan, requireTenantId, type SessionUser } from '@/modules/auth/permissions';

const DAY_MS = 86_400_000;
export const GRACE_DAYS = 30;
export const DEFAULT_RETENTION_YEARS = 6;

const graceEnd = (now: Date) => new Date(now.getTime() + GRACE_DAYS * DAY_MS);

// ─────────────────────────── One client (right to erasure) ───────────────────────────

/** Hides the client now and schedules the physical deletion in 30 days (§4). Reversible until then. */
export async function requestClientErasure(user: SessionUser, clientId: string): Promise<Date> {
  assertCan(user, 'data.eraseClient');
  const tenantId = requireTenantId(user);
  const now = new Date();
  const purgeAfter = graceEnd(now);
  const { count } = await tenantDb(tenantId).client.updateMany({
    where: { id: clientId, purgeAfter: null },
    data: { deletedAt: now, purgeAfter },
  });
  if (count === 0) throw new AppError('NOT_FOUND', 'No encontramos ese cliente.');

  // People who only represent this client lose access right away.
  await prisma.userSession.updateMany({
    where: {
      tenantId,
      revokedAt: null,
      user: { role: 'CLIENT_USER', clientLinks: { every: { clientId } } },
    },
    data: { revokedAt: now },
  });
  await recordAudit({
    tenantId,
    actor: user,
    action: 'data.erase_client_requested',
    entity: 'Client',
    entityId: clientId,
    diff: { purgeAfter: purgeAfter.toISOString() },
  });
  return purgeAfter;
}

export async function cancelClientErasure(user: SessionUser, clientId: string): Promise<void> {
  assertCan(user, 'data.eraseClient');
  const tenantId = requireTenantId(user);
  const { count } = await tenantDb(tenantId).client.updateMany({
    where: { id: clientId, purgeAfter: { gt: new Date() } },
    data: { deletedAt: null, purgeAfter: null },
  });
  if (count === 0) throw new AppError('NOT_FOUND', 'Ese cliente ya no se puede recuperar.');
  await recordAudit({
    tenantId,
    actor: user,
    action: 'data.erase_client_cancelled',
    entity: 'Client',
    entityId: clientId,
  });
}

export function listPendingErasures(user: SessionUser) {
  assertCan(user, 'data.eraseClient');
  return tenantDb(requireTenantId(user)).client.findMany({
    where: { purgeAfter: { not: null } },
    select: { id: true, legalName: true, taxId: true, purgeAfter: true },
    orderBy: { purgeAfter: 'asc' },
  });
}

/** StoredFile rows plus their bucket objects. Callers delete the referencing rows first. */
async function deleteFiles(tenantId: string, fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return;
  const db = tenantDb(tenantId);
  const files = await db.storedFile.findMany({ where: { id: { in: fileIds } } });
  await db.storedFile.deleteMany({ where: { id: { in: fileIds } } });
  for (const file of files) await deleteObject(file.storageKey).catch(() => {});
}

/**
 * Physical deletion of a client after the grace period. Issued invoices survive with their
 * snapshots (ADR 0007: the gestoría must keep them by law); `clientId` becomes null on them.
 * Users who represented only this client are anonymised rather than deleted: the audit trail
 * and the messages of other threads keep pointing at a row, which no longer names anybody.
 */
export async function purgeClient(tenantId: string, clientId: string): Promise<void> {
  const db = tenantDb(tenantId);
  const ids = (rows: Array<Record<string, string | null>>) =>
    rows.flatMap((row) => Object.values(row)).filter((id): id is string => id !== null);

  const fileIds = [
    ...ids(await db.document.findMany({ where: { clientId }, select: { fileId: true } })),
    ...ids(await db.permanentDocument.findMany({ where: { clientId }, select: { fileId: true } })),
    ...ids(
      await db.delivery.findMany({
        where: { clientId },
        select: { fileId: true, certificateFileId: true },
      }),
    ),
    ...ids(
      await db.obligation.findMany({
        where: { clientId, receiptFileId: { not: null } },
        select: { receiptFileId: true },
      }),
    ),
    ...ids(
      await db.messageAttachment.findMany({
        where: { message: { thread: { clientId } } },
        select: { fileId: true },
      }),
    ),
  ];
  const lonelyUsers = await db.user.findMany({
    where: { role: 'CLIENT_USER', clientLinks: { some: { clientId }, every: { clientId } } },
    select: { id: true },
  });

  await db.client.delete({ where: { id: clientId } }); // cascades to everything client-owned
  await deleteFiles(tenantId, fileIds);
  for (const { id } of lonelyUsers) {
    await prisma.userSession.deleteMany({ where: { userId: id } });
    await prisma.user.update({
      where: { id },
      data: {
        email: `eliminado-${id}@invalid.example`,
        name: 'Usuario eliminado',
        status: 'DISABLED',
        passwordHash: null,
        totpSecret: null,
        totpEnabledAt: null,
        recoveryCodeHashes: [],
      },
    });
  }
  await recordAudit({
    tenantId,
    action: 'data.erase_client_done',
    entity: 'Client',
    entityId: clientId,
  });
}

// ─────────────────────────── Documents: retention and soft deletes ───────────────────────────

/** Days between a retention notice and the first deletion it announces, and how far ahead it looks. */
const NOTICE_LEAD_DAYS = 15;
const NOTICE_WINDOW_DAYS = 45;

async function retentionLimitOf(
  tenantId: string,
  now: Date,
): Promise<{ years: number; limit: Date }> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const years =
    (tenant.settings as { retentionYears?: number } | null)?.retentionYears ??
    DEFAULT_RETENTION_YEARS;
  const limit = new Date(now);
  limit.setFullYear(limit.getFullYear() - years);
  return { years, limit };
}

/**
 * Once a month, tells the tenant admins how many documents the retention policy will delete in the
 * next 45 days. Nothing is ever deleted by retention that a notice at least 15 days old did not
 * announce (see `purgeOldDocuments`), so the admins always have time to export or to change the policy.
 */
export async function sendRetentionNotice(
  tenantId: string,
  now: Date = new Date(),
): Promise<number> {
  const { years, limit } = await retentionLimitOf(tenantId, now);
  const db = tenantDb(tenantId);
  const horizon = new Date(limit.getTime() + NOTICE_WINDOW_DAYS * DAY_MS);
  const upcoming = await db.document.count({
    where: { createdAt: { lt: horizon }, deletedAt: null },
  });
  if (upcoming === 0) return 0;

  // One per tenant and month; the unique key makes a double run harmless.
  const step = now.toISOString().slice(0, 7);
  const { count } = await db.reminderLog.createMany({
    data: [{ tenantId, kind: 'RETENTION_NOTICE', entityId: tenantId, step, sentAt: now }],
    skipDuplicates: true,
  });
  if (count === 0) return 0;

  const admins = await db.user.findMany({
    where: { role: 'TENANT_ADMIN', status: 'ACTIVE' },
    select: { id: true },
  });
  try {
    await notifyUsers(
      tenantId,
      admins.map((admin) => admin.id),
      {
        type: 'SYSTEM',
        title: `${upcoming} ${upcoming === 1 ? 'documento se borrará' : 'documentos se borrarán'} por la política de retención`,
        body: `Conservas los documentos ${years} años. Los que superen ese plazo en los próximos ${NOTICE_WINDOW_DAYS} días se borrarán definitivamente, no antes de ${NOTICE_LEAD_DAYS} días desde hoy. Si los necesitas, expórtalos o amplía el plazo en Ajustes → Datos y privacidad.`,
        link: '/panel/ajustes/datos',
      },
    );
  } catch (error) {
    // Release the claim so tomorrow's run tries again.
    await db.reminderLog.deleteMany({
      where: { kind: 'RETENTION_NOTICE', entityId: tenantId, step },
    });
    throw error;
  }
  return upcoming;
}

/**
 * Physically deletes documents past the tenant's retention period (default 6 years) — only those
 * a notice at least 15 days old announced — and the ones somebody deleted more than 30 days ago
 * (their objects used to stay in the bucket, TD-039).
 */
export async function purgeOldDocuments(tenantId: string, now: Date = new Date()): Promise<number> {
  const { years, limit: retentionLimit } = await retentionLimitOf(tenantId, now);
  const db = tenantDb(tenantId);
  const notice = await db.reminderLog.findFirst({
    where: {
      kind: 'RETENTION_NOTICE',
      entityId: tenantId,
      sentAt: { lte: new Date(now.getTime() - NOTICE_LEAD_DAYS * DAY_MS) },
    },
    orderBy: { sentAt: 'desc' },
  });
  // What the notice covered: documents reaching the limit up to 45 days after it was sent.
  const announced = notice
    ? new Date(
        Math.min(
          retentionLimit.getTime(),
          notice.sentAt.getTime() -
            (now.getTime() - retentionLimit.getTime()) +
            NOTICE_WINDOW_DAYS * DAY_MS,
        ),
      )
    : null;

  const doomed = await db.document.findMany({
    where: {
      OR: [
        ...(announced ? [{ createdAt: { lt: announced } }] : []),
        { deletedAt: { lt: new Date(now.getTime() - GRACE_DAYS * DAY_MS) } },
      ],
    },
    select: { id: true, fileId: true },
    take: 1000, // ponytail: 1000 a day per tenant is plenty; the rest goes tomorrow
  });
  const graceLimit = new Date(now.getTime() - GRACE_DAYS * DAY_MS);
  const permanent = await db.permanentDocument.findMany({
    where: { deletedAt: { lt: graceLimit } },
    select: { id: true, fileId: true },
    take: 1000,
  });
  await db.permanentDocument.deleteMany({ where: { id: { in: permanent.map((d) => d.id) } } });
  // Files nothing points at any more: replaced receipts, PDFs of rolled-back invoices.
  const orphans = await db.storedFile.findMany({
    where: {
      createdAt: { lt: graceLimit },
      status: { not: 'PENDING' },
      document: { is: null },
      permanentDocument: { is: null },
      obligationReceipt: { is: null },
      messageAttachment: { is: null },
      delivery: { is: null },
      deliveryCertificate: { is: null },
      invoicePdf: { is: null },
    },
    select: { id: true },
    take: 1000,
  });
  await deleteFiles(tenantId, [...permanent.map((d) => d.fileId), ...orphans.map((f) => f.id)]);

  if (doomed.length === 0) return 0;

  await db.document.deleteMany({ where: { id: { in: doomed.map((d) => d.id) } } });
  await deleteFiles(
    tenantId,
    doomed.map((d) => d.fileId),
  );
  await recordAudit({
    tenantId,
    action: 'data.retention_purge',
    entity: 'Document',
    diff: { documents: doomed.length, retentionYears: years },
  });
  return doomed.length;
}

export async function setRetentionYears(user: SessionUser, years: number): Promise<void> {
  assertCan(user, 'tenantSettings.manage');
  if (!Number.isInteger(years) || years < 4 || years > 15) {
    // Four years is the tax statute of limitations: below that the gestoría could not answer an inspection.
    throw new AppError('VALIDATION', 'Indica un número de años entre 4 y 15.');
  }
  const tenantId = requireTenantId(user);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { settings: { ...(tenant.settings as object), retentionYears: years } },
  });
  const before =
    (tenant.settings as { retentionYears?: number } | null)?.retentionYears ??
    DEFAULT_RETENTION_YEARS;
  if (years < before) {
    // A shorter period dooms documents no notice has announced: the clock starts again.
    await tenantDb(tenantId).reminderLog.deleteMany({
      where: { kind: 'RETENTION_NOTICE', entityId: tenantId },
    });
  }
  await recordAudit({
    tenantId,
    actor: user,
    action: 'tenantSettings.retention',
    entity: 'Tenant',
    entityId: tenantId,
    diff: { retentionYears: years },
  });
}

// ─────────────────────────── The whole tenant ───────────────────────────

/**
 * Offboarding (§4): the portal closes now, a full export is emailed to the admin, and everything is
 * physically deleted in 30 days. `confirmation` must be the tenant's slug, typed by hand.
 */
export async function cancelTenant(user: SessionUser, confirmation: string): Promise<Date> {
  assertCan(user, 'tenant.cancel');
  const tenantId = requireTenantId(user);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  if (confirmation.trim().toLowerCase() !== tenant.slug) {
    throw new AppError('VALIDATION', `Escribe "${tenant.slug}" para confirmar la baja.`);
  }

  const now = new Date();
  const purgeAfter = graceEnd(now);
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { status: 'CANCELLED', cancelledAt: now, purgeAfter },
  });
  const created = await prisma.dataExport.create({
    data: { tenantId, clientId: null, requestedById: user.id },
  });
  await enqueue(QUEUES.scheduled, 'export', { exportId: created.id }, `export_${created.id}`);
  await prisma.userSession.updateMany({
    where: { tenantId, revokedAt: null },
    data: { revokedAt: now },
  });
  await recordAudit({
    tenantId,
    actor: user,
    action: 'tenant.cancel',
    entity: 'Tenant',
    entityId: tenantId,
    diff: { purgeAfter: purgeAfter.toISOString() },
  });
  return purgeAfter;
}

/**
 * Undoes a cancellation during its 30 days of grace (a gestoría that changed its mind, or a
 * cancellation by mistake). Platform support does it: nobody of the tenant can log in any more.
 * Sessions stay revoked and the export already emailed stays valid until it expires.
 */
export async function reactivateTenant(user: SessionUser, tenantId: string): Promise<void> {
  assertCan(user, 'platform.tenant.suspend');
  const { count } = await prisma.tenant.updateMany({
    where: { id: tenantId, status: 'CANCELLED', purgeAfter: { gt: new Date() } },
    data: { status: 'ACTIVE', cancelledAt: null, purgeAfter: null },
  });
  if (count === 0) {
    throw new AppError('CONFLICT', 'Esa gestoría no está de baja o ya se ha borrado.');
  }
  await recordAudit({
    tenantId: null,
    actor: user,
    action: 'platform.tenant.reactivate',
    entity: 'Tenant',
    entityId: tenantId,
  });
  await recordAudit({
    tenantId,
    actor: user,
    action: 'tenant.reactivated',
    entity: 'Tenant',
    entityId: tenantId,
  });
}

/** Tenant-owned tables, children before parents, straight from the Prisma model graph. */
export function tenantTablesInDeletionOrder(): string[] {
  const models = Prisma.dmmf.datamodel.models.filter((model) =>
    model.fields.some((field) => field.name === 'tenantId'),
  );
  const parentsOf = new Map(
    models.map((model) => [
      model.name,
      new Set(
        model.fields
          .filter((field) => field.relationFromFields?.length && field.type !== model.name)
          .map((field) => field.type),
      ),
    ]),
  );
  const ordered: string[] = [];
  const pending = new Set(models.map((model) => model.name));
  while (pending.size > 0) {
    // Deletable now: nobody still pending points at it.
    const free = [...pending].filter((name) =>
      [...pending].every((other) => other === name || !parentsOf.get(other)!.has(name)),
    );
    if (free.length === 0) throw new Error('cycle between tenant tables: purge order undefined');
    for (const name of free) {
      pending.delete(name);
      ordered.push(models.find((model) => model.name === name)!.dbName ?? name);
    }
  }
  return ordered;
}

/**
 * Removes a tenant from bucket and database: bucket first (an orphan row is harmless, an orphan
 * file is a leak), then every row, the audit log included, and the tenant itself.
 * No checks here: callers are `purgeTenant` (cancelled + grace over) and the demo reset.
 */
export async function deleteTenantData(tenantId: string): Promise<void> {
  await deletePrefix(`${tenantId}/`);
  await prisma.$transaction(async (tx) => {
    // The append-only trigger of audit_logs lets DELETE through only under this flag (ADR 0008).
    await tx.$executeRaw`SELECT set_config('app.audit_purge', 'on', true)`;
    for (const table of tenantTablesInDeletionOrder()) {
      await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "tenantId" = $1`, tenantId);
    }
    await tx.verificationToken.deleteMany({
      where: { identifier: { startsWith: `${tenantId}:` } },
    });
    await tx.tenant.delete({ where: { id: tenantId } });
  });
}

/** Physical deletion of a cancelled tenant once its 30 days of grace are over (§4). */
export async function purgeTenant(tenantId: string, now: Date = new Date()): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant || tenant.status !== 'CANCELLED' || !tenant.purgeAfter || tenant.purgeAfter > now) {
    throw new AppError('CONFLICT', 'Esa gestoría no está pendiente de borrado.');
  }
  await deleteTenantData(tenantId);
  // The only trace left: that a tenant with this id existed and was purged.
  await recordAudit({
    tenantId: null,
    action: 'tenant.purged',
    entity: 'Tenant',
    entityId: tenantId,
  });
}

// ─────────────────────────── Daily sweep ───────────────────────────

export type GdprSweepSummary = {
  clients: number;
  tenants: number;
  documents: number;
  exports: number;
};

/** Runs with the daily cleanup. Every step is idempotent: what is gone is no longer selected. */
export async function runGdprSweep(now: Date = new Date()): Promise<GdprSweepSummary> {
  const clients = await prisma.client.findMany({
    where: { purgeAfter: { lte: now }, tenant: { status: { not: 'CANCELLED' } } },
    select: { id: true, tenantId: true },
  });
  for (const client of clients) await purgeClient(client.tenantId, client.id);

  const tenants = await prisma.tenant.findMany({
    where: { status: 'CANCELLED', purgeAfter: { lte: now } },
    select: { id: true },
  });
  for (const tenant of tenants) await purgeTenant(tenant.id, now);

  let documents = 0;
  const active = await prisma.tenant.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });
  for (const tenant of active) {
    await sendRetentionNotice(tenant.id, now);
    documents += await purgeOldDocuments(tenant.id, now);
  }

  const expired = await prisma.dataExport.findMany({
    where: { status: 'READY', expiresAt: { lte: now } },
  });
  for (const item of expired) {
    if (item.storageKey) await deleteObject(item.storageKey).catch(() => {});
    await prisma.dataExport.update({
      where: { id: item.id },
      data: { status: 'EXPIRED', storageKey: null, downloadTokenHash: null },
    });
  }

  return { clients: clients.length, tenants: tenants.length, documents, exports: expired.length };
}
