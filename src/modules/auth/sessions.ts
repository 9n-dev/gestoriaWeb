import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { recordAudit } from '@/modules/audit/service';
import { assertCan, type SessionUser } from './permissions';

const own = (user: SessionUser) =>
  assertCan(user, 'account.revokeSessions', {
    tenantId: user.tenantId ?? '',
    ownerUserId: user.id,
  });

/** Open sessions of the user, newest activity first. */
export function listSessions(user: SessionUser) {
  own(user);
  return prisma.userSession.findMany({
    where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true },
  });
}

export async function revokeSession(user: SessionUser, sessionId: string): Promise<void> {
  own(user);
  const { count } = await prisma.userSession.updateMany({
    where: { id: sessionId, userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) throw new AppError('NOT_FOUND', 'Esa sesión ya no está abierta.');
  await recordAudit({
    tenantId: user.tenantId,
    actor: user,
    action: 'auth.session_revoked',
    entity: 'UserSession',
    entityId: sessionId,
  });
}

/** "Cerrar las demás sesiones": everything but the one making the request. */
export async function revokeOtherSessions(
  user: SessionUser,
  currentSessionId: string,
): Promise<number> {
  own(user);
  const { count } = await prisma.userSession.updateMany({
    where: { userId: user.id, revokedAt: null, NOT: { id: currentSessionId } },
    data: { revokedAt: new Date() },
  });
  await recordAudit({
    tenantId: user.tenantId,
    actor: user,
    action: 'auth.sessions_revoked',
    entity: 'User',
    entityId: user.id,
    diff: { count },
  });
  return count;
}
