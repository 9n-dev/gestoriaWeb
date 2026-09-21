import type { User } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createTenant, createUser } from '@tests/setup/factories';
import { resetDb } from '@tests/setup/db';
import { sessionUserFor } from '@tests/setup/session';
import type { SessionUser } from '../permissions';
import { loadSessionUser } from '../service';
import { listSessions, revokeOtherSessions, revokeSession } from '../sessions';
import {
  confirmEnrolment,
  disableTwoFactor,
  resetTwoFactor,
  startEnrolment,
  verifyChallenge,
} from './service';
import { totpAt } from './totp';

const toSessionUser = (account: User): SessionUser => ({
  id: account.id,
  tenantId: account.tenantId,
  role: account.role,
  status: 'ACTIVE',
  clientIds: [],
  supportTenantIds: [],
});

const openSession = (userId: string, tenantId: string) =>
  prisma.userSession.create({
    data: { userId, tenantId, expiresAt: new Date(Date.now() + 3_600_000) },
  });

async function enrolled(role: 'MANAGER' | 'CLIENT_USER' = 'MANAGER') {
  const tenant = await createTenant();
  const account = await createUser(tenant.id, role);
  const user = toSessionUser(account);
  const session = await openSession(account.id, tenant.id);
  const { secret } = await startEnrolment(user);
  const recoveryCodes = await confirmEnrolment(user, session.id, totpAt(secret, Date.now()));
  return { tenant, account, user, session, secret, recoveryCodes };
}

describe('two-factor authentication', () => {
  beforeEach(resetDb);

  it('forces staff to enrol and leaves clients alone', async () => {
    const tenant = await createTenant();
    const manager = await createUser(tenant.id, 'MANAGER');
    const client = await createUser(tenant.id, 'CLIENT_USER');
    const managerSession = await openSession(manager.id, tenant.id);
    const clientSession = await openSession(client.id, tenant.id);

    expect((await loadSessionUser(managerSession.id, tenant.id))?.twoFactor).toBe('enrol');
    expect((await loadSessionUser(clientSession.id, tenant.id))?.twoFactor).toBe('ok');
  });

  it('enrols with a valid code, stores the secret encrypted and only hashes of the recovery codes', async () => {
    const { account, session, secret, recoveryCodes, tenant } = await enrolled();
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: account.id } });

    expect(stored.totpEnabledAt).not.toBeNull();
    expect(stored.totpSecret).not.toContain(secret);
    expect(recoveryCodes).toHaveLength(10);
    expect(stored.recoveryCodeHashes).toHaveLength(10);
    expect(stored.recoveryCodeHashes).not.toContain(recoveryCodes[0]);
    // The session that enrolled is verified; a new one has to pass the challenge.
    expect((await loadSessionUser(session.id, tenant.id))?.twoFactor).toBe('ok');
    const next = await openSession(account.id, tenant.id);
    expect((await loadSessionUser(next.id, tenant.id))?.twoFactor).toBe('challenge');
  });

  it('rejects a wrong enrolment code and keeps showing the same secret', async () => {
    const tenant = await createTenant();
    const account = await createUser(tenant.id, 'MANAGER');
    const user = toSessionUser(account);
    const session = await openSession(account.id, tenant.id);
    const first = await startEnrolment(user);

    await expect(confirmEnrolment(user, session.id, '000000')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect((await startEnrolment(user)).secret).toBe(first.secret);
  });

  it('passes the challenge with a fresh TOTP code, and a code never works twice', async () => {
    const { account, tenant, user, secret } = await enrolled();
    const session = await openSession(account.id, tenant.id);

    // The code that activated 2FA belongs to a step that is already spent.
    await expect(
      verifyChallenge(user, session.id, totpAt(secret, Date.now())),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    // The next step (accepted as clock drift) is fresh...
    const next = totpAt(secret, Date.now() + 30_000);
    await verifyChallenge(user, session.id, next);
    expect((await loadSessionUser(session.id, tenant.id))?.twoFactor).toBe('ok');

    // ...once. Whoever watched it being typed cannot open another session with it, nor with an older one.
    const spy = await openSession(account.id, tenant.id);
    await expect(verifyChallenge(user, spy.id, next)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(
      verifyChallenge(user, spy.id, totpAt(secret, Date.now() - 30_000)),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect((await loadSessionUser(spy.id, tenant.id))?.twoFactor).toBe('challenge');
  });

  it('accepts a recovery code exactly once', async () => {
    const { account, tenant, user, recoveryCodes } = await enrolled();
    const code = recoveryCodes[0] ?? '';
    const session = await openSession(account.id, tenant.id);
    await verifyChallenge(user, session.id, code.toLowerCase());
    expect((await loadSessionUser(session.id, tenant.id))?.twoFactor).toBe('ok');

    const another = await openSession(account.id, tenant.id);
    await expect(verifyChallenge(user, another.id, code)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('locks the account after five wrong codes', async () => {
    const { account, tenant, user, secret } = await enrolled();
    const session = await openSession(account.id, tenant.id);
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(verifyChallenge(user, session.id, '000000')).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    }
    await expect(
      verifyChallenge(user, session.id, totpAt(secret, Date.now())),
    ).rejects.toMatchObject({ userMessage: expect.stringContaining('bloqueada') });
  });

  it('lets a client turn it off, never a member of staff', async () => {
    const staff = await enrolled('MANAGER');
    await expect(
      disableTwoFactor(staff.user, totpAt(staff.secret, Date.now())),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const client = await enrolled('CLIENT_USER');
    await disableTwoFactor(client.user, totpAt(client.secret, Date.now()));
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: client.account.id } });
    expect(stored).toMatchObject({ totpSecret: null, totpEnabledAt: null, recoveryCodeHashes: [] });
  });

  it('lets the tenant admin reset it, only inside the own tenant', async () => {
    const { account, tenant, session } = await enrolled();
    const admin = await sessionUserFor(tenant.id, 'TENANT_ADMIN');
    const outsider = await createTenant();
    const otherAdmin = await sessionUserFor(outsider.id, 'TENANT_ADMIN');

    await expect(resetTwoFactor(otherAdmin, account.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await resetTwoFactor(admin, account.id);
    expect(await loadSessionUser(session.id, tenant.id)).toBeNull();
    const fresh = await openSession(account.id, tenant.id);
    expect((await loadSessionUser(fresh.id, tenant.id))?.twoFactor).toBe('enrol');
  });
});

describe('session management', () => {
  beforeEach(resetDb);

  it('lists own open sessions and revokes one or all the others', async () => {
    const tenant = await createTenant();
    const account = await createUser(tenant.id, 'CLIENT_USER');
    const stranger = await createUser(tenant.id, 'CLIENT_USER');
    const user = toSessionUser(account);
    const [current, second, third] = await Promise.all([
      openSession(account.id, tenant.id),
      openSession(account.id, tenant.id),
      openSession(account.id, tenant.id),
    ]);
    const foreign = await openSession(stranger.id, tenant.id);

    expect(await listSessions(user)).toHaveLength(3);
    await expect(revokeSession(user, foreign.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await revokeSession(user, second.id);
    expect(await loadSessionUser(second.id, tenant.id)).toBeNull();

    expect(await revokeOtherSessions(user, current.id)).toBe(1);
    expect(await loadSessionUser(third.id, tenant.id)).toBeNull();
    expect(await loadSessionUser(current.id, tenant.id)).not.toBeNull();
    expect(await loadSessionUser(foreign.id, tenant.id)).not.toBeNull();
  });
});
