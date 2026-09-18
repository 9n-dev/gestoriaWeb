import { prisma } from '@/lib/db';
import { env } from '@/env';

export type HostTarget =
  { kind: 'platform' } | { kind: 'slug'; slug: string } | { kind: 'custom'; domain: string };

/** Only what pages need. Settings, tokens and legal data never travel with the request tenant. */
const currentTenantSelect = { id: true, name: true, slug: true } as const;
export type CurrentTenant = { id: string; name: string; slug: string };

const hostname = (host: string) => host.toLowerCase().replace(/:\d+$/, '');

/** Pure: classifies a Host header against the platform's base domain. */
export function parseHost(host: string, appDomain: string): HostTarget {
  const name = hostname(host);
  const base = hostname(appDomain);
  if (name === base) return { kind: 'platform' };

  if (name.endsWith(`.${base}`)) {
    const slug = name.slice(0, -base.length - 1);
    if (!slug.includes('.')) return { kind: 'slug', slug };
  }
  return { kind: 'custom', domain: name };
}

/**
 * Host → tenant. Pending, suspended and cancelled tenants do not resolve, and a custom domain
 * only counts once its TXT record has been verified.
 * `defaultSlug` serves one tenant on the bare platform host: a development convenience.
 */
export async function resolveTenant(
  host: string,
  { defaultSlug = env.DEFAULT_TENANT_SLUG }: { defaultSlug?: string } = {},
): Promise<CurrentTenant | null> {
  const target = parseHost(host, env.APP_DOMAIN);

  if (target.kind === 'custom') {
    return prisma.tenant.findFirst({
      where: {
        customDomain: target.domain,
        customDomainVerifiedAt: { not: null },
        status: 'ACTIVE',
      },
    });
  }

  const slug = target.kind === 'slug' ? target.slug : defaultSlug;
  if (!slug) return null;
  return prisma.tenant.findFirst({
    where: { slug, status: 'ACTIVE' },
    select: currentTenantSelect,
  });
}

/** Public origin of a tenant: its verified custom domain, or its subdomain of the platform. */
export function tenantBaseUrl(tenant: {
  slug: string;
  customDomain?: string | null;
  customDomainVerifiedAt?: Date | null;
}): string {
  if (tenant.customDomain && tenant.customDomainVerifiedAt) return `https://${tenant.customDomain}`;
  const protocol = hostname(env.APP_DOMAIN) === 'localhost' ? 'http' : 'https';
  return `${protocol}://${tenant.slug}.${env.APP_DOMAIN}`;
}
