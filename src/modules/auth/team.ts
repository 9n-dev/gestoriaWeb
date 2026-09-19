import type { Role } from '@prisma/client';
import { z } from 'zod';
import { prisma, tenantDb } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { recordAudit } from '@/modules/audit/service';
import { loadForStaff, resourceOf } from '@/modules/clients/service';
import { assertCan, requireTenantId, type SessionUser } from './permissions';

const STAFF_ROLES = ['MANAGER', 'SUPERVISOR', 'TENANT_ADMIN'] as const satisfies readonly Role[];
const staffRoleSchema = z.enum(STAFF_ROLES, { message: 'Elige un rol válido.' });

const notFound = () => new AppError('NOT_FOUND', 'No encontramos a esa persona en el equipo.');

/**
 * A colleague of the admin's own tenant. Admins never edit themselves here: whoever is making the
 * change stays an active admin, so a tenant can never be left without one.
 */
async function loadColleague(admin: SessionUser, userId: string) {
  assertCan(admin, 'user.manage');
  if (userId === admin.id) {
    throw new AppError(
      'VALIDATION',
      'No puedes cambiar tu propio acceso. Pídeselo a otro administrador.',
    );
  }
  const colleague = await tenantDb(requireTenantId(admin)).user.findFirst({
    where: { id: userId, role: { in: [...STAFF_ROLES] } },
  });
  if (!colleague) throw notFound();
  return colleague;
}

const revokeSessions = (userId: string) =>
  prisma.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

/** Permissions are read from the database on every request, but a fresh login makes the change visible. */
export async function setStaffRole(
  admin: SessionUser,
  userId: string,
  role: string,
): Promise<void> {
  const colleague = await loadColleague(admin, userId);
  const next = staffRoleSchema.parse(role);
  if (next === colleague.role) return;

  await tenantDb(colleague.tenantId!).user.update({ where: { id: userId }, data: { role: next } });
  await revokeSessions(userId);
  await recordAudit({
    tenantId: colleague.tenantId,
    actor: admin,
    action: 'user.role_changed',
    entity: 'User',
    entityId: userId,
    diff: { before: colleague.role, after: next },
  });
}

/**
 * "Dar de baja": the account stops working at once, but the row stays — documents, messages and
 * the audit log keep saying who did what. Their clients must go to somebody else first.
 */
export async function disableStaffMember(
  admin: SessionUser,
  userId: string,
  reassignToId?: string,
): Promise<{ reassigned: number }> {
  const colleague = await loadColleague(admin, userId);
  const db = tenantDb(colleague.tenantId!);

  const assigned = await db.client.count({ where: { assignedManagerId: userId, deletedAt: null } });
  if (assigned > 0) {
    const heir =
      reassignToId && reassignToId !== userId
        ? await db.user.findFirst({
            where: {
              id: reassignToId,
              role: { in: [...STAFF_ROLES] },
              status: { not: 'DISABLED' },
            },
          })
        : null;
    if (!heir) {
      throw new AppError(
        'VALIDATION',
        `Tiene ${assigned} ${assigned === 1 ? 'cliente asignado' : 'clientes asignados'}. Elige a quién pasan.`,
      );
    }
    await db.client.updateMany({
      where: { assignedManagerId: userId },
      data: { assignedManagerId: heir.id },
    });
  }

  await db.user.update({ where: { id: userId }, data: { status: 'DISABLED' } });
  await revokeSessions(userId);
  await recordAudit({
    tenantId: colleague.tenantId,
    actor: admin,
    action: 'user.disabled',
    entity: 'User',
    entityId: userId,
    diff: { reassignedClients: assigned, reassignedTo: assigned > 0 ? reassignToId : null },
  });
  return { reassigned: assigned };
}

/** Back to where they were: active if they had ever logged in, invited otherwise. */
export async function enableStaffMember(admin: SessionUser, userId: string): Promise<void> {
  const colleague = await loadColleague(admin, userId);
  if (colleague.status !== 'DISABLED') return;
  await tenantDb(colleague.tenantId!).user.update({
    where: { id: userId },
    data: {
      status: colleague.emailVerifiedAt ? 'ACTIVE' : 'INVITED',
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  await recordAudit({
    tenantId: colleague.tenantId,
    actor: admin,
    action: 'user.enabled',
    entity: 'User',
    entityId: userId,
  });
}

/**
 * Takes a person's access to one client away. Somebody left with no client at all is disabled and
 * logged out; inviting them again (to any client) brings the account back.
 */
export async function removeClientUser(
  user: SessionUser,
  clientId: string,
  userId: string,
): Promise<void> {
  const client = await loadForStaff(user, clientId);
  assertCan(user, 'client.removeUser', resourceOf(client));
  const db = tenantDb(client.tenantId);

  const { count } = await db.clientUser.deleteMany({ where: { clientId, userId } });
  if (count === 0)
    throw new AppError('NOT_FOUND', 'Esa persona ya no tiene acceso a este cliente.');

  const remaining = await db.clientUser.count({ where: { userId } });
  if (remaining === 0) {
    await db.user.updateMany({
      where: { id: userId, role: 'CLIENT_USER' },
      data: { status: 'DISABLED' },
    });
  }
  // Sessions carry the list of clients: close them either way so the change is immediate.
  await revokeSessions(userId);
  await recordAudit({
    tenantId: client.tenantId,
    actor: user,
    action: 'client.user_removed',
    entity: 'Client',
    entityId: clientId,
    diff: { userId, accountDisabled: remaining === 0 },
  });
}
