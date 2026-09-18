import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/modules/auth/permissions';
import { resetDb } from '@tests/setup/db';
import { createTenant } from '@tests/setup/factories';
import { listAudit, recordAudit } from './service';

const sessionUser = (tenantId: string, role: SessionUser['role']): SessionUser => ({
  id: `user-${role}`,
  tenantId,
  role,
  status: 'ACTIVE',
  clientIds: [],
  supportTenantIds: [],
});

describe('audit log', () => {
  let a: string;
  let b: string;

  beforeEach(async () => {
    await resetDb();
    a = (await createTenant()).id;
    b = (await createTenant()).id;
  });

  it('records who did what, from where', async () => {
    await recordAudit({
      tenantId: a,
      actor: sessionUser(a, 'MANAGER'),
      action: 'document.download',
      entity: 'Document',
      entityId: 'doc-1',
      ip: '203.0.113.7',
      userAgent: 'vitest',
      diff: { status: ['RECEIVED', 'BOOKED'] },
    });

    const row = await prisma.auditLog.findFirstOrThrow();
    expect(row).toMatchObject({
      tenantId: a,
      actorId: 'user-MANAGER',
      actorRole: 'MANAGER',
      action: 'document.download',
      entity: 'Document',
      entityId: 'doc-1',
      ip: '203.0.113.7',
    });
  });

  it('is append-only at database level', async () => {
    await recordAudit({ tenantId: a, action: 'auth.login', entity: 'User' });

    await expect(prisma.$executeRaw`UPDATE audit_logs SET action = 'tampered'`).rejects.toThrow(
      /append-only/,
    );
    await expect(prisma.$executeRaw`DELETE FROM audit_logs`).rejects.toThrow(/append-only/);
    expect(await prisma.auditLog.count()).toBe(1);
  });

  it('can only be purged with the transaction-local flag of the purge service', async () => {
    await recordAudit({ tenantId: a, action: 'auth.login', entity: 'User' });

    await prisma.$transaction([
      prisma.$executeRaw`SET LOCAL app.audit_purge = 'on'`,
      prisma.$executeRaw`DELETE FROM audit_logs WHERE "tenantId" = ${a}`,
    ]);
    expect(await prisma.auditLog.count()).toBe(0);

    // The flag does not outlive the transaction.
    await recordAudit({ tenantId: a, action: 'auth.login', entity: 'User' });
    await expect(prisma.$executeRaw`DELETE FROM audit_logs`).rejects.toThrow(/append-only/);
  });

  it("lists only the entries of the admin's tenant", async () => {
    await recordAudit({ tenantId: a, action: 'auth.login', entity: 'User', entityId: 'in-a' });
    await recordAudit({ tenantId: b, action: 'auth.login', entity: 'User', entityId: 'in-b' });

    const rows = await listAudit(sessionUser(a, 'TENANT_ADMIN'));
    expect(rows.map((r) => r.entityId)).toEqual(['in-a']);
  });

  it('is readable by TENANT_ADMIN only', async () => {
    for (const role of ['CLIENT_USER', 'MANAGER', 'SUPERVISOR'] as const) {
      await expect(listAudit(sessionUser(a, role))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });
});
