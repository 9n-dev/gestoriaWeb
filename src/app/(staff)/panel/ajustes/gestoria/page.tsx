import { requireArea } from '@/modules/auth/area';
import { getOwnTenant, hasSampleData } from '@/modules/tenants/service';
import { SampleDataForm, TenantProfileForm } from '../forms';

export default async function TenantProfilePage() {
  const tenant = await getOwnTenant(await requireArea('area.staff'));
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Datos de la gestoría</h1>
        <TenantProfileForm tenant={tenant} />
      </section>
      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-lg font-semibold">Datos de ejemplo</h2>
        <p className="text-sm text-fg-muted">
          Clientes ficticios, marcados como «Ejemplo», para probar el portal. Se borran con un clic.
        </p>
        <SampleDataForm hasSampleData={await hasSampleData(tenant.id)} />
      </section>
    </div>
  );
}
