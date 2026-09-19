import { prisma, tenantDb } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { recordAudit } from '@/modules/audit/service';
import { assertCan, can, requireTenantId, type SessionUser } from '@/modules/auth/permissions';

const HOUR_MS = 3_600_000;
const MAX_HOURS = 72;

/**
 * Support mode (§3): the tenant admin opens a read-only window for the platform's support team.
 * It always expires, can be closed early, and opening, closing and every use are audited.
 */
export async function grantSupportAccess(
  user: SessionUser,
  input: { hours: number; reason: string },
) {
  assertCan(user, 'support.grant');
  const tenantId = requireTenantId(user);
  if (!Number.isInteger(input.hours) || input.hours < 1 || input.hours > MAX_HOURS) {
    throw new AppError('VALIDATION', `Indica una duración entre 1 y ${MAX_HOURS} horas.`);
  }
  const reason = input.reason.trim().slice(0, 500);
  if (!reason) throw new AppError('VALIDATION', 'Explica brevemente para qué necesitas a soporte.');

  const grant = await tenantDb(tenantId).supportAccessGrant.create({
    data: {
      tenantId,
      grantedById: user.id,
      reason,
      expiresAt: new Date(Date.now() + input.hours * HOUR_MS),
    },
  });
  await recordAudit({
    tenantId,
    actor: user,
    action: 'support.grant',
    entity: 'SupportAccessGrant',
    entityId: grant.id,
    diff: { hours: input.hours, reason },
  });
  return grant;
}

export async function revokeSupportAccess(user: SessionUser, grantId: string): Promise<void> {
  assertCan(user, 'support.revoke');
  const tenantId = requireTenantId(user);
  const { count } = await tenantDb(tenantId).supportAccessGrant.updateMany({
    where: { id: grantId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) throw new AppError('NOT_FOUND', 'Ese acceso ya estaba cerrado.');
  await recordAudit({
    tenantId,
    actor: user,
    action: 'support.revoke',
    entity: 'SupportAccessGrant',
    entityId: grantId,
  });
}

export function listSupportGrants(user: SessionUser) {
  assertCan(user, 'support.grant');
  return tenantDb(requireTenantId(user)).supportAccessGrant.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { grantedBy: { select: { name: true } } },
  });
}

/**
 * What support sees of a tenant while a grant is open: figures and the client list, never files
 * nor internal notes. Goes through `can()` like everybody else, and leaves an audit entry in the
 * tenant's own log so the admin can see when support looked.
 */
export async function supportOverview(user: SessionUser, tenantId: string) {
  if (user.role !== 'SUPERADMIN' || !can(user, 'client.read', { tenantId })) {
    throw new AppError('FORBIDDEN', 'Esa gestoría no ha abierto el modo soporte.');
  }
  const db = tenantDb(tenantId);
  const [tenant, clients, counts, failedEmails] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { name: true, slug: true, status: true, customDomain: true, createdAt: true },
    }),
    db.client.findMany({
      where: { deletedAt: null },
      select: { id: true, legalName: true, status: true, createdAt: true },
      orderBy: { legalName: 'asc' },
      take: 200,
    }),
    Promise.all([
      db.user.count(),
      db.document.count({ where: { deletedAt: null } }),
      db.storedFile.count({ where: { status: 'INFECTED' } }),
      db.document.count({ where: { extractionStatus: 'FAILED' } }),
    ]),
    db.emailLog.count({ where: { status: 'FAILED' } }),
  ]);
  await recordAudit({
    tenantId,
    actor: user,
    action: 'support.view',
    entity: 'Tenant',
    entityId: tenantId,
  });
  const [users, documents, infectedFiles, failedExtractions] = counts;
  return { tenant, clients, users, documents, infectedFiles, failedExtractions, failedEmails };
}
