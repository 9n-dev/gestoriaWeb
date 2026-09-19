import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant, linkClientUser } from '@tests/setup/factories';
import { sessionUserFor } from '@tests/setup/session';
import { acceptAgreements, pendingAgreements } from './dpa';

const meta = { ip: '203.0.113.9', userAgent: 'vitest' };

describe('data processing agreements', () => {
  beforeEach(resetDb);

  it('asks the tenant admin once and records who, when, from where and what', async () => {
    const tenant = await createTenant({ name: 'Gestoría Pérez' });
    const admin = await sessionUserFor(tenant.id, 'TENANT_ADMIN');

    const [agreement] = await pendingAgreements(admin);
    expect(agreement).toMatchObject({ documentType: 'DPA_TENANT', clientId: null });
    expect(agreement?.text).toContain('Gestoría Pérez');

    expect(await acceptAgreements(admin, meta)).toBe(1);
    expect(await pendingAgreements(admin)).toEqual([]);
    const stored = await prisma.legalAcceptance.findFirstOrThrow({ where: { userId: admin.id } });
    expect(stored).toMatchObject({ ip: meta.ip, userAgent: meta.userAgent, tenantId: tenant.id });
    expect(stored.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await prisma.auditLog.count({ where: { action: 'legal.accept' } })).toBe(1);
  });

  it('asks a client user once per client they represent, and staff never', async () => {
    const tenant = await createTenant();
    const first = await createClient(tenant.id);
    const second = await createClient(tenant.id);
    const user = await sessionUserFor(tenant.id, 'CLIENT_USER', { clientIds: [first.id] });
    await linkClientUser(tenant.id, first.id, user.id);

    expect(await pendingAgreements(await sessionUserFor(tenant.id, 'MANAGER'))).toEqual([]);
    expect(await acceptAgreements(user, meta)).toBe(1);

    const withSecond = { ...user, clientIds: [first.id, second.id] };
    const pending = await pendingAgreements(withSecond);
    expect(pending.map((agreement) => agreement.clientId)).toEqual([second.id]);
    expect(pending[0]?.text).toContain(second.legalName);
  });
});
