import Link from 'next/link';
import { requireArea } from '@/modules/auth/area';
import { listClientsFor } from '@/modules/clients/service';

export default async function ClientHomePage() {
  const user = await requireArea('area.client');
  const clients = await listClientsFor(user);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Hola, {user.name.split(' ')[0]}</h1>
      <Link
        href="/subir"
        className="flex min-h-20 items-center justify-center rounded-lg bg-primary px-6 text-lg font-semibold text-primary-fg"
      >
        Subir documentos
      </Link>
      <section aria-labelledby="clients-title" className="flex flex-col gap-2">
        <h2 id="clients-title" className="text-sm font-medium text-fg-muted">
          Gestionamos
        </h2>
        <ul className="flex flex-col gap-2">
          {clients.map((client) => (
            <li key={client.id} className="rounded-md border border-border p-4">
              <p className="font-medium">{client.legalName}</p>
              <p className="text-sm text-fg-muted">{client.taxId}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
