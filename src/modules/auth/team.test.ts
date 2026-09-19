import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant, createUser, linkClientUser } from '@tests/setup/factories';
import { sessionUserFor } from '@tests/setup/session';
import { inviteClientUser } from './invitations';
import type { SessionUser } from './permissions';
import { completeLogin, loadSessionUser } from './service';
import { disableStaffMember, enableStaffMember, removeClientUser, setStaffRole } from './team';

const meta = { ip: null, userAgent: 'vitest' };

describe('team management', () => {
  let tenantId: string;
  let admin: SessionUser;

  beforeEach(async () => {
    await resetDb();
    tenantId = (await createTenant()).id;
    admin = await sessionUserFor(tenantId, 'TENANT_ADMIN');
  });

  it('changes a role, logs the person out and audits it', async () => {
    const manager = await createUser(tenantId, 'MANAGER');
    const session = await completeLogin(manager, 'password', meta);

    await setStaffRole(admin, manager.id, 'SUPERVISOR');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: manager.id } })).role).toBe(
      'SUPERVISOR',
    );
    expect(await loadSessionUser(session.id, tenantId)).toBeNull();
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'user.role_changed' },
    });
    expect(entry.diff).toEqual({ before: 'MANAGER', after: 'SUPERVISOR' });

    await expect(setStaffRole(admin, manager.id, 'SUPERADMIN')).rejects.toThrow();
    await expect(setStaffRole(admin, manager.id, 'CLIENT_USER')).rejects.toThrow();
  });

  it('never lets admins change themselves, nor anybody but an admin change others', async () => {
    const manager = await createUser(tenantId, 'MANAGER');
    await expect(setStaffRole(admin, admin.id, 'MANAGER')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(disableStaffMember(admin, admin.id)).rejects.toMatchObject({ code: 'VALIDATION' });
    const supervisor = await sessionUserFor(tenantId, 'SUPERVISOR');
    await expect(disableStaffMember(supervisor, manager.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('cannot reach people of another tenant, nor client users', async () => {
    const foreign = await createUser((await createTenant()).id, 'MANAGER');
    const clientUser = await createUser(tenantId, 'CLIENT_USER');
    await expect(disableStaffMember(admin, foreign.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(setStaffRole(admin, clientUser.id, 'MANAGER')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('disabling asks who inherits the clients, moves them, and blocks the login', async () => {
    const leaving = await createUser(tenantId, 'MANAGER');
    const staying = await createUser(tenantId, 'MANAGER');
    const gone = await createUser(tenantId, 'MANAGER', { status: 'DISABLED' });
    const client = await createClient(tenantId, { assignedManagerId: leaving.id });
    const session = await completeLogin(leaving, 'password', meta);

    await expect(disableStaffMember(admin, leaving.id)).rejects.toMatchObject({
      userMessage: expect.stringContaining('1 cliente asignado'),
    });
    await expect(disableStaffMember(admin, leaving.id, gone.id)).rejects.toMatchObject({
      code: 'VALIDATION',
    });

    expect(await disableStaffMember(admin, leaving.id, staying.id)).toEqual({ reassigned: 1 });
    expect(
      (await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).assignedManagerId,
    ).toBe(staying.id);
    expect(await loadSessionUser(session.id, tenantId)).toBeNull();

    await enableStaffMember(admin, leaving.id);
    // Never verified an email in this test: back to "invited", not silently active.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: leaving.id } })).status).toBe(
      'INVITED',
    );
  });

  it('removes a person from a client; with no clients left the account is disabled until re-invited', async () => {
    const manager = await sessionUserFor(tenantId, 'MANAGER');
    const first = await createClient(tenantId, { assignedManagerId: manager.id });
    const second = await createClient(tenantId, { assignedManagerId: manager.id });
    const foreignClient = await createClient(tenantId);
    const person = await createUser(tenantId, 'CLIENT_USER', {
      email: 'ana@cliente.test',
      emailVerifiedAt: new Date(),
    });
    await linkClientUser(tenantId, first.id, person.id);
    await linkClientUser(tenantId, second.id, person.id);
    const status = async () =>
      (await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).status;

    // A manager only touches the clients assigned to them.
    await expect(removeClientUser(manager, foreignClient.id, person.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    await removeClientUser(manager, first.id, person.id);
    expect(await status()).toBe('ACTIVE');
    await removeClientUser(manager, second.id, person.id);
    expect(await status()).toBe('DISABLED');
    await expect(removeClientUser(manager, second.id, person.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    await inviteClientUser(manager, first.id, { email: 'ana@cliente.test', name: 'Ana' });
    expect(await status()).toBe('ACTIVE');
  });
});
