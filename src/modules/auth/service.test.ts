import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant, createUser, linkClientUser } from '@tests/setup/factories';
import { hashPassword } from './password';
import {
  completeLogin,
  consumeMagicLink,
  loadSessionUser,
  requestMagicLink,
  revokeAllSessions,
  revokeSession,
  verifyPasswordLogin,
} from './service';

const meta = { ip: '203.0.113.7', userAgent: 'vitest' };
let passwordHash: string;

describe('auth service', () => {
  let a: string;
  let b: string;

  beforeEach(async () => {
    await resetDb();
    passwordHash ??= await hashPassword('demo1234', { cost: 10 });
    a = (await createTenant()).id;
    b = (await createTenant()).id;
  });

  describe('password login', () => {
    it('accepts the right password, case-insensitive on email', async () => {
      const user = await createUser(a, 'MANAGER', { email: 'gestor@demo.es', passwordHash });
      const result = await verifyPasswordLogin(a, ' Gestor@Demo.es ', 'demo1234', meta);
      expect(result.id).toBe(user.id);
    });

    it('answers with the same error for unknown user, wrong password and disabled user', async () => {
      await createUser(a, 'MANAGER', { email: 'gestor@demo.es', passwordHash });
      await createUser(a, 'MANAGER', { email: 'baja@demo.es', passwordHash, status: 'DISABLED' });

      const attempts = [
        ['nadie@demo.es', 'demo1234'],
        ['gestor@demo.es', 'wrong'],
        ['baja@demo.es', 'demo1234'],
      ] as const;
      for (const [email, password] of attempts) {
        await expect(verifyPasswordLogin(a, email, password, meta)).rejects.toMatchObject({
          code: 'UNAUTHENTICATED',
          userMessage: 'Correo o contraseña incorrectos.',
        });
      }
    });

    it('keeps tenants apart: same email, different tenant, different account', async () => {
      const hashB = await hashPassword('other-pass', { cost: 10 });
      const inA = await createUser(a, 'CLIENT_USER', { email: 'ana@demo.es', passwordHash });
      const inB = await createUser(b, 'CLIENT_USER', { email: 'ana@demo.es', passwordHash: hashB });

      expect((await verifyPasswordLogin(a, 'ana@demo.es', 'demo1234', meta)).id).toBe(inA.id);
      expect((await verifyPasswordLogin(b, 'ana@demo.es', 'other-pass', meta)).id).toBe(inB.id);
      await expect(verifyPasswordLogin(b, 'ana@demo.es', 'demo1234', meta)).rejects.toThrow();
    });

    it('does not let tenant users in through the platform host, nor superadmins through a tenant', async () => {
      await createUser(a, 'TENANT_ADMIN', { email: 'admin@demo.es', passwordHash });
      await createUser(null, 'SUPERADMIN', { email: 'root@platform.test', passwordHash });

      await expect(verifyPasswordLogin(null, 'admin@demo.es', 'demo1234', meta)).rejects.toThrow();
      await expect(
        verifyPasswordLogin(a, 'root@platform.test', 'demo1234', meta),
      ).rejects.toThrow();
      await expect(
        verifyPasswordLogin(null, 'root@platform.test', 'demo1234', meta),
      ).resolves.toBeTruthy();
    });

    it('locks the account for 15 minutes after 5 failures', async () => {
      const user = await createUser(a, 'MANAGER', { email: 'gestor@demo.es', passwordHash });
      for (let i = 0; i < 5; i++) {
        await expect(verifyPasswordLogin(a, 'gestor@demo.es', 'wrong', meta)).rejects.toThrow();
      }

      const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      const minutes = (locked.lockedUntil!.getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(14);
      expect(minutes).toBeLessThanOrEqual(15);

      // The right password does not help while locked.
      await expect(
        verifyPasswordLogin(a, 'gestor@demo.es', 'demo1234', meta),
      ).rejects.toMatchObject({
        userMessage: expect.stringMatching(/bloqueada/),
      });

      await prisma.user.update({
        where: { id: user.id },
        data: { lockedUntil: new Date(Date.now() - 1000) },
      });
      await expect(
        verifyPasswordLogin(a, 'gestor@demo.es', 'demo1234', meta),
      ).resolves.toBeTruthy();
    });

    it('audits failed attempts', async () => {
      const user = await createUser(a, 'MANAGER', { email: 'gestor@demo.es', passwordHash });
      await expect(verifyPasswordLogin(a, 'gestor@demo.es', 'wrong', meta)).rejects.toThrow();
      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'auth.login_failed' },
      });
      expect(entry).toMatchObject({ tenantId: a, entityId: user.id, ip: meta.ip });
    });
  });

  describe('sessions', () => {
    it('completeLogin resets counters, stamps the login, audits it and opens a session', async () => {
      const user = await createUser(a, 'MANAGER', { failedLoginCount: 3 });
      const session = await completeLogin(user, 'password', meta);

      const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(fresh.failedLoginCount).toBe(0);
      expect(fresh.lastLoginAt).not.toBeNull();
      expect(
        await prisma.auditLog.count({ where: { action: 'auth.login', entityId: user.id } }),
      ).toBe(1);
      expect(session).toMatchObject({ userId: user.id, tenantId: a, ip: meta.ip });
    });

    it('expires after 12 hours for staff and 30 days for clients', async () => {
      const hours = async (role: 'MANAGER' | 'TENANT_ADMIN' | 'CLIENT_USER') => {
        const session = await completeLogin(await createUser(a, role), 'password', meta);
        return Math.round((session.expiresAt.getTime() - Date.now()) / 3_600_000);
      };
      expect(await hours('MANAGER')).toBe(12);
      expect(await hours('TENANT_ADMIN')).toBe(12);
      expect(await hours('CLIENT_USER')).toBe(30 * 24);
    });

    it('loads the session user with its clients', async () => {
      const user = await createUser(a, 'CLIENT_USER');
      const client = await createClient(a);
      await linkClientUser(a, client.id, user.id);
      const session = await completeLogin(user, 'password', meta);

      expect(await loadSessionUser(session.id, a)).toEqual({
        id: user.id,
        tenantId: a,
        role: 'CLIENT_USER',
        status: 'ACTIVE',
        clientIds: [client.id],
        supportTenantIds: [],
        name: user.name,
        email: user.email,
        sessionId: session.id,
        twoFactor: 'ok',
        totpEnabled: false,
      });
    });

    it('rejects revoked, expired, foreign-tenant and disabled-user sessions', async () => {
      const user = await createUser(a, 'MANAGER');
      const open = () => completeLogin(user, 'password', meta);

      const revoked = await open();
      await revokeSession(revoked.id);
      expect(await loadSessionUser(revoked.id, a)).toBeNull();

      const expired = await open();
      await prisma.userSession.update({
        where: { id: expired.id },
        data: { expiresAt: new Date(0) },
      });
      expect(await loadSessionUser(expired.id, a)).toBeNull();

      const valid = await open();
      expect(await loadSessionUser(valid.id, b)).toBeNull();
      expect(await loadSessionUser('missing', a)).toBeNull();

      const other = await open();
      await revokeAllSessions(user.id);
      expect(await loadSessionUser(valid.id, a)).toBeNull();
      expect(await loadSessionUser(other.id, a)).toBeNull();

      const last = await open();
      await prisma.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });
      expect(await loadSessionUser(last.id, a)).toBeNull();
    });

    it('gives superadmins the tenants with an active support grant', async () => {
      const root = await createUser(null, 'SUPERADMIN');
      const admin = await createUser(a, 'TENANT_ADMIN');
      const adminB = await createUser(b, 'TENANT_ADMIN');
      await prisma.supportAccessGrant.createMany({
        data: [
          { tenantId: a, grantedById: admin.id, expiresAt: new Date(Date.now() + 3_600_000) },
          { tenantId: b, grantedById: adminB.id, expiresAt: new Date(Date.now() - 1000) },
        ],
      });
      const session = await completeLogin(root, 'password', meta);
      expect((await loadSessionUser(session.id, null))?.supportTenantIds).toEqual([a]);
    });
  });

  describe('magic link', () => {
    const lastLink = async () => {
      const email = await prisma.emailLog.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
      const token = /token=([\w-]+)/.exec(email.bodyText ?? '')?.[1];
      return { email, token: token! };
    };

    it('emails a single-use link and activates invited users', async () => {
      vi.spyOn(console, 'info').mockImplementation(() => {});
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: a } });
      const user = await createUser(a, 'CLIENT_USER', {
        email: 'cliente@demo.es',
        status: 'INVITED',
      });

      await requestMagicLink(tenant, 'Cliente@demo.es', 'https://perez.app.test');
      const { email, token } = await lastLink();
      expect(email).toMatchObject({
        tenantId: a,
        toAddress: 'cliente@demo.es',
        status: 'LOGGED_ONLY',
      });
      expect(email.bodyText).toContain('https://perez.app.test/acceso/enlace?token=');

      // Only the hash is stored.
      expect(await prisma.verificationToken.count({ where: { token } })).toBe(0);

      const loggedIn = await consumeMagicLink(a, token);
      expect(loggedIn).toMatchObject({ id: user.id, status: 'ACTIVE' });
      expect(loggedIn.emailVerifiedAt).not.toBeNull();

      await expect(consumeMagicLink(a, token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('sends nothing for unknown or disabled users, without revealing it', async () => {
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: a } });
      await createUser(a, 'CLIENT_USER', { email: 'baja@demo.es', status: 'DISABLED' });
      await expect(requestMagicLink(tenant, 'nadie@demo.es', 'https://x')).resolves.toBeUndefined();
      await expect(requestMagicLink(tenant, 'baja@demo.es', 'https://x')).resolves.toBeUndefined();
      expect(await prisma.emailLog.count()).toBe(0);
    });

    it('rejects expired links and links used on another tenant', async () => {
      vi.spyOn(console, 'info').mockImplementation(() => {});
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: a } });
      await createUser(a, 'CLIENT_USER', { email: 'cliente@demo.es' });
      await createUser(b, 'CLIENT_USER', { email: 'cliente@demo.es' });

      await requestMagicLink(tenant, 'cliente@demo.es', 'https://x');
      await expect(consumeMagicLink(b, (await lastLink()).token)).rejects.toThrow();

      await requestMagicLink(tenant, 'cliente@demo.es', 'https://x');
      await prisma.verificationToken.updateMany({ data: { expires: new Date(0) } });
      await expect(consumeMagicLink(a, (await lastLink()).token)).rejects.toThrow();
    });
  });
});
