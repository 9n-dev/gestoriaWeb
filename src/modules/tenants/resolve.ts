import type { Tenant } from '@prisma/client';
import { prisma } from '@/lib/db';
import { env } from '@/env';

export type HostTarget =
  { kind: 'platform' } | { kind: 'slug'; slug: string } | { kind: 'custom'; domain: string };

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
): Promise<Tenant | null> {
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
  return prisma.tenant.findFirst({ where: { slug, status: 'ACTIVE' } });
}
