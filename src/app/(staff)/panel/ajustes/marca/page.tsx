import { TenantLogo } from '@/components/tenant-logo';
import { requireArea } from '@/modules/auth/area';
import { getCurrentTenant } from '@/modules/tenants/current';
import { parseBranding } from '@/modules/tenants/schema';
import { BrandingForm } from '../forms';

export default async function BrandingPage() {
  await requireArea('area.staff');
  const tenant = await getCurrentTenant();
  const branding = parseBranding(tenant?.branding);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Marca</h1>
      <div className="flex items-center gap-3 text-sm text-fg-muted">
        Así se ve ahora: <TenantLogo tenant={tenant} />
      </div>
      <BrandingForm
        primaryColor={branding.primaryColor ?? '#1d4ed8'}
        accentColor={branding.accentColor ?? '#0f766e'}
        senderName={branding.senderName ?? ''}
      />
    </div>
  );
}
