import { requireArea } from '@/modules/auth/area';
import { notFound } from 'next/navigation';
import { can } from '@/modules/auth/permissions';
import { ImportForm } from './import-form';
import { ImportInstructions } from './import-instructions';

export default async function ImportClientsPage() {
  if (!can(await requireArea('area.staff'), 'client.import')) notFound();
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Importar clientes</h1>
      <ImportInstructions />
      <ImportForm />
    </div>
  );
}
