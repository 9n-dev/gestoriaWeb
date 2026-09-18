import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant } from '@tests/setup/factories';
import { sessionUserFor } from '@tests/setup/session';
import type { SessionUser } from './permissions';
import {
  inviteClientsInBulk,
  inviteClientUser,
  inviteStaff,
  resendInvitation,
  setOwnPassword,
} from './invitations';
import { consumeMagicLink, verifyPasswordLogin } from './service';

const lastToken = async () => {
  const email = await prisma.emailLog.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  return /token=([\w-]+)/.exec(email.bodyText ?? '')![1]!;
};

describe('invitations', () => {
  let tenantId: string;
  let admin: SessionUser;
  let manager: SessionUser;

  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    await resetDb();
    tenantId = (await createTenant({ slug: 'perez' })).id;
    admin = await sessionUserFor(tenantId, 'TENANT_ADMIN');
    manager = await sessionUserFor(tenantId, 'MANAGER');
  });

  it('admin invites staff: INVITED user, email on the tenant host, link activates the account', async () => {
    const invited = await inviteStaff(admin, {
      email: 'Nueva@Demo.es',
      name: 'Nueva Gestora',
      role: 'MANAGER',
    });
    expect(invited).toMatchObject({
      email: 'nueva@demo.es',
      role: 'MANAGER',
      status: 'INVITED',
      tenantId,
    });

    const email = await prisma.emailLog.findFirstOrThrow();
    expect(email.bodyText).toContain('https://perez.app.test/acceso/enlace?token=');

    const active = await consumeMagicLink(tenantId, await lastToken());
    expect(active).toMatchObject({ id: invited.id, status: 'ACTIVE' });
  });

  it('only TENANT_ADMIN invites staff, only into staff roles, and never twice', async () => {
    const input = { email: 'x@demo.es', name: 'Equis', role: 'MANAGER' as const };
    await expect(inviteStaff(manager, input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    for (const role of ['SUPERADMIN', 'CLIENT_USER']) {
      await expect(inviteStaff(admin, { ...input, role: role as 'MANAGER' })).rejects.toThrow();
    }
    await inviteStaff(admin, input);
    await expect(inviteStaff(admin, input)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('invitation links last 7 days', async () => {
    await inviteStaff(admin, { email: 'x@demo.es', name: 'Equis', role: 'SUPERVISOR' });
    const token = await prisma.verificationToken.findFirstOrThrow();
    const days = (token.expires.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
  });

  it('managers invite users to their assigned clients only', async () => {
    const mine = await createClient(tenantId, { assignedManagerId: manager.id });
    const theirs = await createClient(tenantId);
    const input = { email: 'cliente@demo.es', name: 'Marta Soler' };

    const invited = await inviteClientUser(manager, mine.id, input);
    expect(invited).toMatchObject({ role: 'CLIENT_USER', status: 'INVITED' });
    expect(
      await prisma.clientUser.count({ where: { clientId: mine.id, userId: invited.id } }),
    ).toBe(1);
    await expect(inviteClientUser(manager, theirs.id, input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('links an existing client user to a second client instead of duplicating it', async () => {
    const first = await createClient(tenantId);
    const second = await createClient(tenantId);
    const input = { email: 'cliente@demo.es', name: 'Marta Soler' };
    const a = await inviteClientUser(admin, first.id, input);
    const b = await inviteClientUser(admin, second.id, input);
    expect(b.id).toBe(a.id);
    expect(await prisma.clientUser.count({ where: { userId: a.id } })).toBe(2);
  });

  it('refuses to turn a staff member into a client user', async () => {
    const client = await createClient(tenantId);
    const staff = await prisma.user.findUniqueOrThrow({ where: { id: manager.id } });
    await expect(
      inviteClientUser(admin, client.id, { email: staff.email, name: 'X Y' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('bulk invitation reports clients without email or with users already', async () => {
    const withEmail = await createClient(tenantId, { email: 'uno@example.com' });
    const noEmail = await createClient(tenantId, { legalName: 'Sin correo' });
    const already = await createClient(tenantId, {
      email: 'dos@example.com',
      legalName: 'Ya invitada',
    });
    await inviteClientUser(admin, already.id, { email: 'dos@example.com', name: 'Dos' });

    const report = await inviteClientsInBulk(admin, [withEmail.id, noEmail.id, already.id]);
    expect(report.invited).toBe(1);
    expect(report.skipped).toEqual([
      { legalName: 'Sin correo', reason: 'No tiene correo electrónico.' },
      { legalName: 'Ya invitada', reason: 'Ya tiene usuarios.' },
    ]);
  });

  it('resends pending invitations, within the same permission limits', async () => {
    const client = await createClient(tenantId);
    const invited = await inviteClientUser(admin, client.id, {
      email: 'c@example.com',
      name: 'Cliente',
    });
    await expect(resendInvitation(manager, invited.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await resendInvitation(admin, invited.id);
    expect(await prisma.emailLog.count({ where: { toAddress: 'c@example.com' } })).toBe(2);

    await consumeMagicLink(tenantId, await lastToken());
    await expect(resendInvitation(admin, invited.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('an invited user can set a password and then log in with it', async () => {
    const client = await createClient(tenantId);
    const invited = await inviteClientUser(admin, client.id, {
      email: 'c@example.com',
      name: 'Cliente',
    });
    await consumeMagicLink(tenantId, await lastToken());
    const session: SessionUser = {
      ...admin,
      id: invited.id,
      role: 'CLIENT_USER',
      clientIds: [client.id],
    };

    await expect(setOwnPassword(session, 'corta')).rejects.toThrow(/al menos 8/);
    await setOwnPassword(session, 'una-clave-larga');
    const meta = { ip: null, userAgent: null };
    await expect(
      verifyPasswordLogin(tenantId, 'c@example.com', 'una-clave-larga', meta),
    ).resolves.toMatchObject({
      id: invited.id,
    });
  });
});
