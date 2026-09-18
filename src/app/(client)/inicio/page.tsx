import { requireArea } from '@/modules/auth/area';
import { listClientsFor } from '@/modules/clients/service';

export default async function ClientHomePage() {
  const user = await requireArea('area.client');
  const clients = await listClientsFor(user);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Hola, {user.name}</h1>
      <ul className="flex flex-col gap-2">
        {clients.map((client) => (
          <li key={client.id} className="rounded-md border border-border p-4">
            <p className="font-medium">{client.legalName}</p>
            <p className="text-sm text-fg-muted">{client.taxId}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
