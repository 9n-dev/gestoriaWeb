import { createHash, randomBytes } from 'node:crypto';
import type { User, UserSession } from '@prisma/client';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { AppError } from '@/lib/errors';
import type { RequestMeta } from '@/lib/request';
import { recordAudit } from '@/modules/audit/service';
import { hashPassword, verifyPassword } from './password';
import type { SessionUser } from './permissions';
import { emailSchema } from './schema';

const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60_000;
const MAGIC_LINK_MS = 15 * 60_000;
const STAFF_SESSION_MS = 12 * 3_600_000;
const CLIENT_SESSION_MS = 30 * 24 * 3_600_000;
const LAST_SEEN_THROTTLE_MS = 10 * 60_000;

export type LoginMethod = 'password' | 'magic-link';
export type AuthenticatedUser = SessionUser & { name: string; email: string };

const invalidCredentials = (detail: string) =>
  new AppError('UNAUTHENTICATED', 'Correo o contraseña incorrectos.', detail);
const invalidLink = (detail: string) =>
  new AppError(
    'UNAUTHENTICATED',
    'El enlace no es válido o ha caducado. Solicita uno nuevo.',
    detail,
  );

// Verified against when the account does not exist, so response time does not reveal it.
let dummyHash: Promise<string> | undefined;

/**
 * `tenantId` comes from the request host (null = platform host, superadmins only), which is what
 * keeps the same email in two tenants apart (ADR 0001).
 */
export async function verifyPasswordLogin(
  tenantId: string | null,
  rawEmail: string,
  password: string,
  meta: RequestMeta,
): Promise<User> {
  const email = emailSchema.parse(rawEmail);
  const user = await prisma.user.findFirst({ where: { tenantId, email } });

  if (!user?.passwordHash || user.status === 'DISABLED') {
    await verifyPassword(password, await (dummyHash ??= hashPassword('dummy')));
    throw invalidCredentials(`no usable account for ${email} in tenant ${tenantId}`);
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(
      'UNAUTHENTICATED',
      'Cuenta bloqueada temporalmente por demasiados intentos. Inténtalo de nuevo en 15 minutos.',
      `user ${user.id} locked until ${user.lockedUntil.toISOString()}`,
    );
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    const { failedLoginCount } = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
    });
    if (failedLoginCount >= MAX_FAILED_LOGINS) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MS) },
      });
    }
    await recordAudit({
      tenantId,
      actor: user,
      action: 'auth.login_failed',
      entity: 'User',
      entityId: user.id,
      ...meta,
    });
    throw invalidCredentials(`wrong password for user ${user.id}`);
  }

  return user;
}

/** Common tail of every login method: reset counters, stamp, audit, open the session. */
export async function completeLogin(
  user: User,
  method: LoginMethod,
  meta: RequestMeta,
): Promise<UserSession> {
  const lifetime = user.role === 'CLIENT_USER' ? CLIENT_SESSION_MS : STAFF_SESSION_MS;
  const [, session] = await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    }),
    prisma.userSession.create({
      data: {
        userId: user.id,
        tenantId: user.tenantId,
        expiresAt: new Date(Date.now() + lifetime),
        ...meta,
      },
    }),
  ]);
  await recordAudit({
    tenantId: user.tenantId,
    actor: user,
    action: 'auth.login',
    entity: 'User',
    entityId: user.id,
    diff: { method },
    ...meta,
  });
  return session;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.userSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * The authoritative session check (ADR 0002): the JWT only carries `sessionId`.
 * `tenantId` is the tenant of the current host; a session is never valid on another tenant.
 */
export async function loadSessionUser(
  sessionId: string,
  tenantId: string | null,
): Promise<AuthenticatedUser | null> {
  const now = new Date();
  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    include: { user: { include: { clientLinks: { select: { clientId: true } } } } },
  });
  if (!session || session.revokedAt || session.expiresAt <= now) return null;

  const { user } = session;
  if (user.status !== 'ACTIVE' || user.tenantId !== tenantId) return null;

  const grants =
    user.role === 'SUPERADMIN'
      ? await prisma.supportAccessGrant.findMany({
          where: { revokedAt: null, expiresAt: { gt: now } },
          select: { tenantId: true },
        })
      : [];

  if (now.getTime() - session.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
    await prisma.userSession.update({ where: { id: session.id }, data: { lastSeenAt: now } });
  }

  return {
    id: user.id,
    tenantId: user.tenantId,
    role: user.role,
    status: user.status,
    clientIds: user.clientLinks.map((link) => link.clientId),
    supportTenantIds: [...new Set(grants.map((grant) => grant.tenantId))],
    name: user.name,
    email: user.email,
  };
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const tokenIdentifier = (tenantId: string | null, email: string) =>
  `${tenantId ?? 'platform'}:${email}`;

/** Always resolves: whether the account exists is never revealed to the requester. */
export async function requestMagicLink(
  tenant: { id: string; name: string } | null,
  rawEmail: string,
  baseUrl: string,
): Promise<void> {
  const email = emailSchema.parse(rawEmail);
  const tenantId = tenant?.id ?? null;
  const user = await prisma.user.findFirst({
    where: { tenantId, email, status: { not: 'DISABLED' } },
  });
  if (!user) return;

  const token = randomBytes(32).toString('base64url');
  await prisma.verificationToken.create({
    data: {
      identifier: tokenIdentifier(tenantId, email),
      token: sha256(token),
      expires: new Date(Date.now() + MAGIC_LINK_MS),
    },
  });

  const link = `${baseUrl}/acceso/enlace?token=${token}`;
  await sendEmail({
    tenantId,
    to: email,
    templateKey: 'auth.magic_link',
    subject: `Tu enlace de acceso a ${tenant?.name ?? 'la plataforma'}`,
    text: [
      `Hola, ${user.name}:`,
      '',
      'Usa este enlace para entrar. Caduca en 15 minutos y solo funciona una vez.',
      '',
      link,
      '',
      'Si no lo has pedido tú, puedes ignorar este mensaje.',
    ].join('\n'),
  });
}

export async function consumeMagicLink(tenantId: string | null, token: string): Promise<User> {
  // Deleting first makes the token single-use even under concurrent requests.
  const record = await prisma.verificationToken
    .delete({ where: { token: sha256(token) } })
    .catch(() => null);
  if (!record || record.expires <= new Date()) throw invalidLink('unknown or expired token');

  const prefix = `${tenantId ?? 'platform'}:`;
  if (!record.identifier.startsWith(prefix)) throw invalidLink('token issued for another tenant');

  const email = record.identifier.slice(prefix.length);
  const user = await prisma.user.findFirst({
    where: { tenantId, email, status: { not: 'DISABLED' } },
  });
  if (!user) throw invalidLink(`no usable account for ${email}`);

  return prisma.user.update({
    where: { id: user.id },
    data: { status: 'ACTIVE', emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
  });
}
