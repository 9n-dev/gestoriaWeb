import { requireArea } from '@/modules/auth/area';
import { getBillingSettings } from '@/modules/billing/settings';
import { BillingSettingsForm } from './form';

export default async function BillingSettingsPage() {
  const settings = await getBillingSettings(await requireArea('area.staff'));
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Facturación</h1>
      <p className="max-w-prose text-sm text-fg-muted">
        Cómo facturas a tus clientes: cuándo vencen las facturas, cuándo se reclaman y con qué serie
        se numeran. Las cuotas de cada cliente se configuran en su ficha.
      </p>
      <BillingSettingsForm settings={settings} />
    </div>
  );
}
