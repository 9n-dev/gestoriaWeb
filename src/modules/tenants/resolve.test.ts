import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '@tests/setup/db';
import { createTenant } from '@tests/setup/factories';
import { parseHost, requestHost, resolveTenant } from './resolve';

describe('parseHost', () => {
  it('recognises the platform host', () => {
    expect(parseHost('app.test', 'app.test')).toEqual({ kind: 'platform' });
    expect(parseHost('APP.test:3000', 'app.test:3000')).toEqual({ kind: 'platform' });
  });

  it('extracts the tenant slug from a subdomain, ignoring port and case', () => {
    expect(parseHost('Perez.app.test:3000', 'app.test')).toEqual({ kind: 'slug', slug: 'perez' });
    expect(parseHost('perez.localhost:3000', 'localhost:3000')).toEqual({
      kind: 'slug',
      slug: 'perez',
    });
  });

  it('treats nested subdomains and foreign hosts as custom domains', () => {
    expect(parseHost('a.b.app.test', 'app.test')).toEqual({
      kind: 'custom',
      domain: 'a.b.app.test',
    });
    expect(parseHost('clientes.gestoriaperez.es', 'app.test')).toEqual({
      kind: 'custom',
      domain: 'clientes.gestoriaperez.es',
    });
  });
});

describe('requestHost', () => {
  it('prefers the forwarded host (proxies, and Next.js rendering a server-action redirect)', () => {
    expect(
      requestHost(new Headers({ host: 'localhost:3000', 'x-forwarded-host': 'perez.app.test' })),
    ).toBe('perez.app.test');
    expect(
      requestHost(
        new Headers({ host: 'localhost:3000', 'x-forwarded-host': 'a.app.test, proxy.internal' }),
      ),
    ).toBe('a.app.test');
    expect(requestHost(new Headers({ host: 'perez.app.test' }))).toBe('perez.app.test');
    expect(requestHost(new Headers())).toBe('');
  });
});

describe('resolveTenant', () => {
  beforeEach(resetDb);

  it('finds an active tenant by slug subdomain', async () => {
    const tenant = await createTenant({ slug: 'perez' });
    expect((await resolveTenant('perez.app.test'))?.id).toBe(tenant.id);
    expect(await resolveTenant('nadie.app.test')).toBeNull();
  });

  it('finds a tenant by custom domain only once the domain is verified', async () => {
    const tenant = await createTenant({ customDomain: 'clientes.gestoriaperez.es' });
    expect(await resolveTenant('clientes.gestoriaperez.es')).toBeNull();

    await createTenant({ customDomain: 'clientes.otra.es', customDomainVerifiedAt: new Date() });
    expect(await resolveTenant('clientes.otra.es')).not.toBeNull();
    expect(tenant.customDomainVerifiedAt).toBeNull();
  });

  it('does not resolve suspended or cancelled tenants', async () => {
    await createTenant({ slug: 'suspendida', status: 'SUSPENDED' });
    await createTenant({ slug: 'baja', status: 'CANCELLED' });
    expect(await resolveTenant('suspendida.app.test')).toBeNull();
    expect(await resolveTenant('baja.app.test')).toBeNull();
  });

  it('resolves no tenant on the platform host', async () => {
    await createTenant({ slug: 'perez' });
    expect(await resolveTenant('app.test')).toBeNull();
  });

  it('falls back to the default tenant on the platform host when one is configured', async () => {
    const tenant = await createTenant({ slug: 'perez' });
    expect((await resolveTenant('app.test', { defaultSlug: 'perez' }))?.id).toBe(tenant.id);
  });
});
