import { randomBytes } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { env } from '@/env';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { recordAudit } from '@/modules/audit/service';
import { assertCan, requireTenantId, type SessionUser } from '@/modules/auth/permissions';
import {
  getDomainProvider,
  getEmailDomainProvider,
  type DnsRecord,
  type DomainProvider,
  type EmailDomainProvider,
} from './providers';

export type TxtResolver = (hostname: string) => Promise<string[][]>;

const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/,
    'Escribe un dominio válido, por ejemplo clientes.tugestoria.es.',
  )
  .refine(
    (domain) => !domain.endsWith(env.APP_DOMAIN.replace(/:\d+$/, '')),
    'Ese dominio pertenece a la plataforma.',
  );

const txtValues = async (resolver: TxtResolver, hostname: string): Promise<string[]> =>
  (await resolver(hostname).catch(() => [])).map((chunks) => chunks.join(''));

const manage = (user: SessionUser) => {
  assertCan(user, 'domain.manage');
  return requireTenantId(user);
};

// ─────────────────────────── Custom domain of the portal ───────────────────────────

export type CustomDomainStatus = { domain: string; verified: boolean; records: DnsRecord[] } | null;

const portalRecords = (domain: string, token: string): DnsRecord[] => [
  {
    type: 'TXT',
    name: `_portal-verify.${domain}`,
    value: token,
    purpose: 'Verificación de propiedad',
  },
  {
    type: 'CNAME',
    name: domain,
    value: env.PLATFORM_CNAME_TARGET,
    purpose: 'Apunta el dominio al portal (el certificado SSL se emite solo)',
  },
];

export async function getCustomDomain(user: SessionUser): Promise<CustomDomainStatus> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: manage(user) } });
  if (!tenant.customDomain || !tenant.customDomainToken) return null;
  return {
    domain: tenant.customDomain,
    verified: Boolean(tenant.customDomainVerifiedAt),
    records: portalRecords(tenant.customDomain, tenant.customDomainToken),
  };
}

/** Step 1: reserve the domain and show the DNS records. It does not resolve to the tenant until verified. */
export async function requestCustomDomain(
  user: SessionUser,
  rawDomain: string,
): Promise<CustomDomainStatus> {
  const tenantId = manage(user);
  const domain = domainSchema.parse(rawDomain);
  try {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        customDomain: domain,
        customDomainToken: `portal-verify=${randomBytes(16).toString('hex')}`,
        customDomainVerifiedAt: null,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError('CONFLICT', 'Ese dominio ya está en uso en otro portal.');
    }
    throw error;
  }
  await recordAudit({
    tenantId,
    actor: user,
    action: 'domain.request',
    entity: 'Tenant',
    entityId: tenantId,
    diff: { domain },
  });
  return getCustomDomain(user);
}

/** Step 2: the TXT record proves ownership; only then is the domain attached to the deployment. */
export async function verifyCustomDomain(
  user: SessionUser,
  resolver: TxtResolver = resolveTxt,
  provider: DomainProvider = getDomainProvider(),
): Promise<void> {
  const tenantId = manage(user);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  if (!tenant.customDomain || !tenant.customDomainToken)
    throw new AppError('CONFLICT', 'Primero indica tu dominio.');
  if (tenant.customDomainVerifiedAt) return;

  const values = await txtValues(resolver, `_portal-verify.${tenant.customDomain}`);
  if (!values.includes(tenant.customDomainToken)) {
    throw new AppError(
      'VALIDATION',
      'Todavía no vemos el registro TXT. Los cambios de DNS pueden tardar hasta 24 horas: vuelve a comprobarlo más tarde.',
    );
  }
  await provider.add(tenant.customDomain);
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { customDomainVerifiedAt: new Date() },
  });
  await recordAudit({
    tenantId,
    actor: user,
    action: 'domain.verify',
    entity: 'Tenant',
    entityId: tenantId,
    diff: { domain: tenant.customDomain },
  });
}

export async function removeCustomDomain(
  user: SessionUser,
  provider: DomainProvider = getDomainProvider(),
): Promise<void> {
  const tenantId = manage(user);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  if (tenant.customDomain && tenant.customDomainVerifiedAt)
    await provider.remove(tenant.customDomain);
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { customDomain: null, customDomainToken: null, customDomainVerifiedAt: null },
  });
  await recordAudit({
    tenantId,
    actor: user,
    action: 'domain.remove',
    entity: 'Tenant',
    entityId: tenantId,
    diff: { domain: tenant.customDomain },
  });
}

// ─────────────────────────── Sending domain of the emails ───────────────────────────

export type SendingDomainStatus = {
  domain: string;
  verified: boolean;
  records: DnsRecord[];
} | null;

const dmarcRecord = (domain: string, present: boolean): DnsRecord => ({
  type: 'TXT',
  name: `_dmarc.${domain}`,
  value: 'v=DMARC1; p=none;',
  purpose: 'DMARC',
  status: present ? 'verified' : 'pending',
});

/** SPF and DKIM come from the email provider; DMARC is checked by us with a DNS lookup. */
export async function getSendingDomain(
  user: SessionUser,
  resolver: TxtResolver = resolveTxt,
  provider: EmailDomainProvider = getEmailDomainProvider(),
): Promise<SendingDomainStatus> {
  const tenantId = manage(user);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  if (!tenant.sendingDomain || !tenant.sendingDomainProviderId) return null;

  const { status, records } = await provider.get(tenant.sendingDomainProviderId);
  const hasDmarc = (await txtValues(resolver, `_dmarc.${tenant.sendingDomain}`)).some((value) =>
    value.startsWith('v=DMARC1'),
  );
  const verified = status === 'verified';
  if (verified !== Boolean(tenant.sendingDomainVerifiedAt)) {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { sendingDomainVerifiedAt: verified ? new Date() : null },
    });
    await recordAudit({
      tenantId,
      actor: user,
      action: verified ? 'emailDomain.verified' : 'emailDomain.unverified',
      entity: 'Tenant',
      entityId: tenantId,
    });
  }
  return {
    domain: tenant.sendingDomain,
    verified,
    records: [...records, dmarcRecord(tenant.sendingDomain, hasDmarc)],
  };
}

export async function requestSendingDomain(
  user: SessionUser,
  rawDomain: string,
  provider: EmailDomainProvider = getEmailDomainProvider(),
): Promise<void> {
  const tenantId = manage(user);
  const domain = domainSchema.parse(rawDomain);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  if (tenant.sendingDomainProviderId)
    await provider.remove(tenant.sendingDomainProviderId).catch(() => null);
  const created = await provider.create(domain);
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      sendingDomain: domain,
      sendingDomainProviderId: created.id,
      sendingDomainVerifiedAt: null,
    },
  });
  await recordAudit({
    tenantId,
    actor: user,
    action: 'emailDomain.request',
    entity: 'Tenant',
    entityId: tenantId,
    diff: { domain },
  });
}

export async function removeSendingDomain(
  user: SessionUser,
  provider: EmailDomainProvider = getEmailDomainProvider(),
): Promise<void> {
  const tenantId = manage(user);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  if (tenant.sendingDomainProviderId)
    await provider.remove(tenant.sendingDomainProviderId).catch(() => null);
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { sendingDomain: null, sendingDomainProviderId: null, sendingDomainVerifiedAt: null },
  });
  await recordAudit({
    tenantId,
    actor: user,
    action: 'emailDomain.remove',
    entity: 'Tenant',
    entityId: tenantId,
  });
}
