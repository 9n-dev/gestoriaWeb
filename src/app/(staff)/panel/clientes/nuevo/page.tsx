import { requireArea } from '@/modules/auth/area';
import { notFound } from 'next/navigation';
import { can } from '@/modules/auth/permissions';
import { listAssignableManagers } from '@/modules/clients/service';
import { listTaxProfiles } from '@/modules/clients/tax-profiles/service';
import { createClientAction } from '../actions';
import { ClientForm } from '../client-form';

export default async function NewClientPage() {
  const user = await requireArea('area.staff');
  if (!can(user, 'client.create')) notFound();
  const [taxProfiles, managers] = await Promise.all([
    listTaxProfiles(user),
    can(user, 'client.assignManager') ? listAssignableManagers(user) : undefined,
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Nuevo cliente</h1>
      <ClientForm
        action={createClientAction}
        taxProfiles={taxProfiles}
        managers={managers}
        submitLabel="Crear cliente"
      />
    </div>
  );
}
