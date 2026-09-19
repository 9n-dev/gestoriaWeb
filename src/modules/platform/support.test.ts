import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { completeLogin, loadSessionUser } from '@/modules/auth/service';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant, createUser } from '@tests/setup/factories';
import { sessionUserFor } from '@tests/setup/session';
import { grantSupportAccess, revokeSupportAccess, supportOverview } from './support';

const meta = { ip: null, userAgent: 'vitest' };

describe('support mode', () => {
  beforeEach(resetDb);

  it('opens a read-only window that the superadmin session picks up, and closes it again', async () => {
    const tenant = await createTenant();
    await createClient(tenant.id, { legalName: 'Cliente Visible SL' });
    const admin = await sessionUserFor(tenant.id, 'TENANT_ADMIN');
    const root = await createUser(null, 'SUPERADMIN');
    const session = await completeLogin(root, 'password', meta);
    await prisma.userSession.update({
      where: { id: session.id },
      data: { twoFactorVerifiedAt: new Date() },
    });
    const support = async () => (await loadSessionUser(session.id, null))!;

    await expect(supportOverview(await support(), tenant.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const grant = await grantSupportAccess(admin, { hours: 2, reason: 'No llegan los correos' });
    const overview = await supportOverview(await support(), tenant.id);
    expect(overview.clients.map((client) => client.legalName)).toEqual(['Cliente Visible SL']);
    expect(overview.clients[0]).not.toHaveProperty('internalNotes');

    await revokeSupportAccess(admin, grant.id);
    await expect(supportOverview(await support(), tenant.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const actions = (await prisma.auditLog.findMany({ where: { tenantId: tenant.id } })).map(
      (entry) => entry.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining(['support.grant', 'support.view', 'support.revoke']),
    );
  });

  it('expires on its own, and only the tenant admin may open it', async () => {
    const tenant = await createTenant();
    const admin = await sessionUserFor(tenant.id, 'TENANT_ADMIN');
    const manager = await sessionUserFor(tenant.id, 'MANAGER');
    await expect(grantSupportAccess(manager, { hours: 1, reason: 'x' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(grantSupportAccess(admin, { hours: 500, reason: 'x' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });

    const grant = await grantSupportAccess(admin, { hours: 1, reason: 'Revisión' });
    await prisma.supportAccessGrant.update({
      where: { id: grant.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const root = await sessionUserFor(null, 'SUPERADMIN');
    await expect(supportOverview(root, tenant.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
