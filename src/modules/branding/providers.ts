import { env } from '@/env';

export type DnsRecord = {
  type: 'TXT' | 'CNAME' | 'MX';
  name: string;
  value: string;
  purpose: string;
  status?: string;
};

/** Attaches a verified custom domain to the deployment, which issues its TLS certificate (§6.12). */
export interface DomainProvider {
  add(domain: string): Promise<void>;
  remove(domain: string): Promise<void>;
}

/** Sending domain of the tenant's emails: DKIM/SPF records and their verification status. */
export interface EmailDomainProvider {
  create(domain: string): Promise<{ id: string; status: string; records: DnsRecord[] }>;
  get(id: string): Promise<{ status: string; records: DnsRecord[] }>;
  remove(id: string): Promise<void>;
}

async function call(url: string, token: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!response.ok)
    throw new Error(`${new URL(url).host} responded ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

const vercel = (token: string, projectId: string): DomainProvider => ({
  add: async (domain) =>
    void (await call(`https://api.vercel.com/v10/projects/${projectId}/domains`, token, {
      method: 'POST',
      body: JSON.stringify({ name: domain }),
    })),
  remove: async (domain) =>
    void (await call(`https://api.vercel.com/v9/projects/${projectId}/domains/${domain}`, token, {
      method: 'DELETE',
    })),
});

const fakeDomains: DomainProvider = {
  add: async (domain) => console.info(`[domains:dev] would attach ${domain} to the deployment`),
  remove: async (domain) => console.info(`[domains:dev] would detach ${domain}`),
};

export const getDomainProvider = (): DomainProvider =>
  env.VERCEL_TOKEN && env.VERCEL_PROJECT_ID
    ? vercel(env.VERCEL_TOKEN, env.VERCEL_PROJECT_ID)
    : fakeDomains;

type ResendDomain = {
  id: string;
  status: string;
  records?: Array<{ record: string; name: string; type: string; value: string; status?: string }>;
};

const fromResend = (domain: ResendDomain) => ({
  id: domain.id,
  status: domain.status,
  records: (domain.records ?? []).map((r) => ({
    type: r.type as DnsRecord['type'],
    name: r.name,
    value: r.value,
    purpose: r.record,
    status: r.status,
  })),
});

const resend = (apiKey: string): EmailDomainProvider => ({
  create: async (name) =>
    fromResend(
      (await call('https://api.resend.com/domains', apiKey, {
        method: 'POST',
        body: JSON.stringify({ name }),
      })) as ResendDomain,
    ),
  get: async (id) => {
    // Asking for verification is what makes Resend re-check the DNS records.
    await call(`https://api.resend.com/domains/${id}/verify`, apiKey, { method: 'POST' }).catch(
      () => null,
    );
    return fromResend((await call(`https://api.resend.com/domains/${id}`, apiKey)) as ResendDomain);
  },
  remove: async (id) =>
    void (await call(`https://api.resend.com/domains/${id}`, apiKey, { method: 'DELETE' })),
});

/** Development fake: plausible records, verified on the first check. */
const fakeEmailDomains: EmailDomainProvider = {
  create: async (domain) => ({
    id: `fake-${domain}`,
    status: 'pending',
    records: fakeRecords(domain, 'pending'),
  }),
  get: async (id) => ({
    status: 'verified',
    records: fakeRecords(id.replace(/^fake-/, ''), 'verified'),
  }),
  remove: async () => {},
};
const fakeRecords = (domain: string, status: string): DnsRecord[] => [
  {
    type: 'MX',
    name: `send.${domain}`,
    value: 'feedback-smtp.eu-west-1.amazonses.com',
    purpose: 'SPF',
    status,
  },
  {
    type: 'TXT',
    name: `send.${domain}`,
    value: 'v=spf1 include:amazonses.com ~all',
    purpose: 'SPF',
    status,
  },
  {
    type: 'TXT',
    name: `resend._domainkey.${domain}`,
    value: 'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ(demo)',
    purpose: 'DKIM',
    status,
  },
];

export const getEmailDomainProvider = (): EmailDomainProvider =>
  env.RESEND_API_KEY ? resend(env.RESEND_API_KEY) : fakeEmailDomains;
