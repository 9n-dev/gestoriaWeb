import type { AuditLog, Prisma } from '@prisma/client';
import { prisma, tenantDb } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { assertCan, type SessionUser } from '@/modules/auth/permissions';
import { auditFiltersSchema, type AuditFilters } from './schema';

export type AuditEntry = {
  /** null for platform-level events. */
  tenantId: string | null;
  /** null or omitted for system and worker actions. */
  actor?: Pick<SessionUser, 'id' | 'role'> | null;
  /** Dotted verb, e.g. "document.download", "auth.login", "support.enable". */
  action: string;
  entity: string;
  entityId?: string;
  diff?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
};

/** Insert-only by design: this module exposes no update or delete (ADR 0008). */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  await prisma.auditLog.create({
    data: {
      tenantId: entry.tenantId,
      actorId: entry.actor?.id,
      actorRole: entry.actor?.role,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      diff: entry.diff,
      ip: entry.ip,
      userAgent: entry.userAgent,
    },
  });
}

export async function listAudit(
  user: SessionUser,
  filters: AuditFilters = {},
): Promise<AuditLog[]> {
  assertCan(user, 'audit.read');
  if (!user.tenantId)
    throw new AppError('FORBIDDEN', 'No tienes permiso para realizar esta acción.');

  const { take, cursor, ...where } = auditFiltersSchema.parse(filters);
  return tenantDb(user.tenantId).auditLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
}
