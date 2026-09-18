import { notFound } from 'next/navigation';
import { requireArea } from '@/modules/auth/area';
import { can } from '@/modules/auth/permissions';
import { loadForStaff, resourceOf } from '@/modules/clients/service';
import { updateClientAction } from '../../actions';
import { ClientForm } from '../../client-form';

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireArea('area.staff');
  const { id } = await params;
  const client = await loadForStaff(user, id).catch(() => notFound());
  if (!can(user, 'client.update', resourceOf(client))) notFound();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Editar {client.legalName}</h1>
      <ClientForm
        action={updateClientAction.bind(null, id)}
        client={client}
        submitLabel="Guardar cambios"
      />
    </div>
  );
}
