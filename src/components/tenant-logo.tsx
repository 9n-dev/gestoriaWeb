import { parseBranding } from '@/modules/tenants/schema';
import type { CurrentTenant } from '@/modules/tenants/resolve';

/** Logo when the tenant has one, its name otherwise. */
export function TenantLogo({ tenant }: { tenant: CurrentTenant | null }) {
  if (!tenant) return <span className="font-semibold">Plataforma</span>;
  const { logoFileId } = parseBranding(tenant.branding);
  return logoFileId ? (
    // eslint-disable-next-line @next/next/no-img-element -- served by our own route, per tenant
    <img src={`/api/branding/logo?v=${logoFileId}`} alt={tenant.name} className="h-9 w-auto" />
  ) : (
    <span className="font-semibold">{tenant.name}</span>
  );
}
