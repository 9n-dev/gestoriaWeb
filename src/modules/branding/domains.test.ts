import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/modules/auth/permissions';
import { resolveTenant } from '@/modules/tenants/resolve';
import { resetDb } from '@tests/setup/db';
import { createTenant } from '@tests/setup/factories';
import { sessionUserFor } from '@tests/setup/session';
import {
  getSendingDomain,
  removeCustomDomain,
  requestCustomDomain,
  requestSendingDomain,
  verifyCustomDomain,
} from './domains';
import type { EmailDomainProvider } from './providers';

describe('custom domain', () => {
  let admin: SessionUser;
  const provider = { add: vi.fn(), remove: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDb();
    admin = await sessionUserFor((await createTenant()).id, 'TENANT_ADMIN');
  });

  it('shows the DNS records, and the domain does not resolve until the TXT record proves ownership', async () => {
    const status = await requestCustomDomain(admin, ' Clientes.GestoriaPerez.es ');
    expect(status).toMatchObject({ domain: 'clientes.gestoriaperez.es', verified: false });
    const txt = status!.records.find((r) => r.type === 'TXT')!;
    expect(txt.name).toBe('_portal-verify.clientes.gestoriaperez.es');
    expect(status!.records.find((r) => r.type === 'CNAME')!.value).toBe('cname.vercel-dns.com');
    expect(await resolveTenant('clientes.gestoriaperez.es')).toBeNull();

    await expect(
      verifyCustomDomain(admin, async () => [['otra-cosa']], provider),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      verifyCustomDomain(admin, async () => Promise.reject(new Error('ENOTFOUND')), provider),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(provider.add).not.toHaveBeenCalled();

    // TXT values may arrive split in chunks.
    const half = Math.floor(txt.value.length / 2);
    await verifyCustomDomain(
      admin,
      async () => [[txt.value.slice(0, half), txt.value.slice(half)]],
      provider,
    );
    expect(provider.add).toHaveBeenCalledWith('clientes.gestoriaperez.es');
    expect((await resolveTenant('clientes.gestoriaperez.es'))?.id).toBe(admin.tenantId);
  });

  it('rejects malformed domains, the platform domain and domains taken by another tenant', async () => {
    for (const bad of ['no es un dominio', 'http://x.es', 'perez.app.test', 'a']) {
      await expect(requestCustomDomain(admin, bad), bad).rejects.toThrow();
    }
    await requestCustomDomain(admin, 'clientes.gestoriaperez.es');
    const other = await sessionUserFor((await createTenant()).id, 'TENANT_ADMIN');
    await expect(requestCustomDomain(other, 'clientes.gestoriaperez.es')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('only the tenant admin manages it; removing detaches it', async () => {
    const supervisor = await sessionUserFor(admin.tenantId, 'SUPERVISOR');
    await expect(requestCustomDomain(supervisor, 'clientes.x.es')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const status = await requestCustomDomain(admin, 'clientes.x.es');
    await verifyCustomDomain(admin, async () => [[status!.records[0]!.value]], provider);
    await removeCustomDomain(admin, provider);
    expect(provider.remove).toHaveBeenCalledWith('clientes.x.es');
    expect(await resolveTenant('clientes.x.es')).toBeNull();
  });
});

describe('sending domain', () => {
  it('shows SPF, DKIM and DMARC with their status and records when it becomes verified', async () => {
    await resetDb();
    const admin = await sessionUserFor((await createTenant()).id, 'TENANT_ADMIN');
    let status = 'pending';
    const provider: EmailDomainProvider = {
      create: async () => ({ id: 'dom_1', status, records: [] }),
      get: async () => ({
        status,
        records: [
          {
            type: 'TXT',
            name: 'resend._domainkey.gestoriaperez.es',
            value: 'p=…',
            purpose: 'DKIM',
            status,
          },
        ],
      }),
      remove: vi.fn(),
    };

    await requestSendingDomain(admin, 'gestoriaperez.es', provider);
    let view = await getSendingDomain(admin, async () => [], provider);
    expect(view).toMatchObject({ domain: 'gestoriaperez.es', verified: false });
    expect(view!.records.map((r) => [r.purpose, r.status])).toEqual([
      ['DKIM', 'pending'],
      ['DMARC', 'pending'],
    ]);

    status = 'verified';
    view = await getSendingDomain(admin, async () => [['v=DMARC1; p=quarantine;']], provider);
    expect(view!.verified).toBe(true);
    expect(view!.records.at(-1)).toMatchObject({ purpose: 'DMARC', status: 'verified' });
    expect(
      (await prisma.tenant.findUniqueOrThrow({ where: { id: admin.tenantId! } }))
        .sendingDomainVerifiedAt,
    ).not.toBeNull();
  });
});
