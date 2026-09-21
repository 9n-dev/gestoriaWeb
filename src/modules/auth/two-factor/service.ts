import { createHash } from 'node:crypto';
import { env } from '@/env';
import { prisma } from '@/lib/db';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { AppError } from '@/lib/errors';
import { recordAudit } from '@/modules/audit/service';
import { assertCan, type SessionUser } from '../permissions';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  matchTotpStep,
  otpauthUri,
  verifyTotp,
} from './totp';

const PURPOSE = 'totp';
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60_000;
const STAFF_ROLES = ['MANAGER', 'SUPERVISOR', 'TENANT_ADMIN', 'SUPERADMIN'];

export type TwoFactorState = 'ok' | 'enrol' | 'challenge';

const hashCode = (code: string) =>
  createHash('sha256').update(code.toUpperCase().replace(/[\s-]/g, '')).digest('hex');

/**
 * §4: TOTP is mandatory for staff and superadmins, optional for clients.
 * Demo environments hold no real data and must be explorable with the published demo users, so
 * enforcement (not the feature) is switched off when DEMO_MODE is on.
 */
export function twoFactorState(
  user: { role: string; totpEnabledAt: Date | null },
  session: { twoFactorVerifiedAt: Date | null },
): TwoFactorState {
  if (user.totpEnabledAt) return session.twoFactorVerifiedAt ? 'ok' : 'challenge';
  return STAFF_ROLES.includes(user.role) && !env.DEMO_MODE ? 'enrol' : 'ok';
}

const self = (user: SessionUser) =>
  assertCan(user, 'account.manage2fa', { tenantId: user.tenantId ?? '', ownerUserId: user.id });

/** Step 1: a fresh secret, stored encrypted and not yet active. Returns what the authenticator app needs. */
export async function startEnrolment(user: SessionUser): Promise<{ secret: string; uri: string }> {
  self(user);
  const account = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    include: { tenant: { select: { name: true } } },
  });
  if (account.totpEnabledAt)
    throw new AppError('CONFLICT', 'Ya tienes la verificación en dos pasos activada.');
  // A reload of the enrolment page must show the same QR, not invalidate the one just scanned.
  const secret = account.totpSecret
    ? decryptSecret(account.totpSecret, PURPOSE)
    : generateTotpSecret();
  if (!account.totpSecret) {
    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: encryptSecret(secret, PURPOSE) },
    });
  }
  return {
    secret,
    uri: otpauthUri(secret, account.email, account.tenant?.name ?? 'Portal de clientes'),
  };
}

/** Step 2: the first valid code activates 2FA, verifies this session and yields the recovery codes, once. */
export async function confirmEnrolment(
  user: SessionUser,
  sessionId: string,
  code: string,
): Promise<string[]> {
  self(user);
  const account = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (account.totpEnabledAt || !account.totpSecret)
    throw new AppError('CONFLICT', 'Empieza de nuevo la activación.');
  const step = matchTotpStep(decryptSecret(account.totpSecret, PURPOSE), code);
  if (step === null) {
    throw new AppError(
      'VALIDATION',
      'El código no es correcto. Comprueba la hora de tu móvil y vuelve a intentarlo.',
    );
  }
  const recoveryCodes = generateRecoveryCodes();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        totpEnabledAt: new Date(),
        totpLastStep: step,
        recoveryCodeHashes: recoveryCodes.map(hashCode),
      },
    }),
    prisma.userSession.updateMany({
      where: { id: sessionId, userId: user.id },
      data: { twoFactorVerifiedAt: new Date() },
    }),
  ]);
  await recordAudit({
    tenantId: user.tenantId,
    actor: user,
    action: 'auth.2fa_enabled',
    entity: 'User',
    entityId: user.id,
  });
  return recoveryCodes;
}

/**
 * The challenge after the password: a TOTP code or a recovery code (single use). Wrong codes count
 * towards the same lockout as wrong passwords (5 attempts, 15 minutes).
 */
export async function verifyChallenge(
  user: { id: string; tenantId: string | null; role: SessionUser['role'] },
  sessionId: string,
  code: string,
): Promise<void> {
  const account = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!account.totpEnabledAt || !account.totpSecret)
    throw new AppError('CONFLICT', 'No tienes la verificación en dos pasos activada.');
  if (account.lockedUntil && account.lockedUntil > new Date()) {
    throw new AppError(
      'UNAUTHENTICATED',
      'Cuenta bloqueada temporalmente por demasiados intentos. Inténtalo de nuevo en 15 minutos.',
    );
  }

  const recoveryHash = hashCode(code);
  const usedRecovery = account.recoveryCodeHashes.includes(recoveryHash);
  // A code opens one session, once: the step is claimed atomically, so a code somebody saw over
  // the shoulder (or replayed inside its 30 seconds) is as good as a wrong one.
  const step = usedRecovery
    ? null
    : matchTotpStep(decryptSecret(account.totpSecret, PURPOSE), code);
  const fresh =
    step !== null &&
    (
      await prisma.user.updateMany({
        where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
        data: { totpLastStep: step },
      })
    ).count === 1;
  if (!usedRecovery && !fresh) {
    const { failedLoginCount } = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
    });
    if (failedLoginCount >= MAX_FAILED) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MS) },
      });
    }
    await recordAudit({
      tenantId: user.tenantId,
      actor: user,
      action: 'auth.2fa_failed',
      entity: 'User',
      entityId: user.id,
    });
    throw new AppError('UNAUTHENTICATED', 'El código no es correcto.');
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        ...(usedRecovery
          ? {
              recoveryCodeHashes: account.recoveryCodeHashes.filter(
                (hash) => hash !== recoveryHash,
              ),
            }
          : {}),
      },
    }),
    prisma.userSession.updateMany({
      where: { id: sessionId, userId: user.id },
      data: { twoFactorVerifiedAt: new Date() },
    }),
  ]);
  await recordAudit({
    tenantId: user.tenantId,
    actor: user,
    action: usedRecovery ? 'auth.2fa_recovery_used' : 'auth.2fa_verified',
    entity: 'User',
    entityId: user.id,
  });
}

/** Clients may turn it off again (with a valid code). Staff cannot: for them it is mandatory. */
export async function disableTwoFactor(user: SessionUser, code: string): Promise<void> {
  self(user);
  if (STAFF_ROLES.includes(user.role))
    throw new AppError(
      'FORBIDDEN',
      'La verificación en dos pasos es obligatoria para el equipo de la gestoría.',
    );
  const account = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!account.totpSecret || !verifyTotp(decryptSecret(account.totpSecret, PURPOSE), code))
    throw new AppError('VALIDATION', 'El código no es correcto.');
  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodeHashes: [] },
  });
  await recordAudit({
    tenantId: user.tenantId,
    actor: user,
    action: 'auth.2fa_disabled',
    entity: 'User',
    entityId: user.id,
  });
}

/** Lost phone and lost recovery codes: the tenant admin resets it and the person enrols again at next login. */
export async function resetTwoFactor(admin: SessionUser, userId: string): Promise<void> {
  assertCan(admin, 'user.manage');
  const { count } = await prisma.user.updateMany({
    where: { id: userId, tenantId: admin.tenantId ?? '__none__' },
    data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodeHashes: [] },
  });
  if (count === 0) throw new AppError('NOT_FOUND', 'No encontramos ese usuario.');
  await prisma.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await recordAudit({
    tenantId: admin.tenantId,
    actor: admin,
    action: 'auth.2fa_reset',
    entity: 'User',
    entityId: userId,
  });
}
