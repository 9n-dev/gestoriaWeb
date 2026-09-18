import Link from 'next/link';
import { CLIENT_STATUS } from '@/lib/labels';
import { requireArea } from '@/modules/auth/area';
import { can } from '@/modules/auth/permissions';
import { listClientsFor } from '@/modules/clients/service';

const linkButton =
  'inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium border border-border hover:bg-surface-muted';

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireArea('area.staff');
  const query = ((await searchParams).q ?? '').trim().toLowerCase();
  const clients = (await listClientsFor(user)).filter(
    (client) => !query || `${client.legalName} ${client.taxId}`.toLowerCase().includes(query),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Clientes</h1>
        <div className="flex gap-2">
          {can(user, 'client.import') && (
            <Link href="/panel/clientes/importar" className={linkButton}>
              Importar CSV
            </Link>
          )}
          {can(user, 'client.create') && (
            <Link
              href="/panel/clientes/nuevo"
              className={`${linkButton} border-0 bg-primary text-primary-fg`}
            >
              Nuevo cliente
            </Link>
          )}
        </div>
      </div>

      <form role="search" className="flex gap-2">
        <label htmlFor="q" className="sr-only">
          Buscar por nombre o NIF
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={query}
          placeholder="Buscar por nombre o NIF"
          className="min-h-11 w-full max-w-sm rounded-md border border-border bg-surface px-3"
        />
      </form>

      {clients.length === 0 ? (
        <p className="text-fg-muted">
          {query ? 'Ningún cliente coincide con la búsqueda.' : 'Todavía no hay clientes.'}
        </p>
      ) : (
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">Clientes que puedes gestionar</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-2 pr-4 font-medium">
                Razón social
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                NIF
              </th>
              <th scope="col" className="py-2 font-medium">
                Estado
              </th>
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.id} className="border-b border-border">
                <td className="py-2 pr-4">
                  <Link
                    href={`/panel/clientes/${client.id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {client.legalName}
                  </Link>
                </td>
                <td className="py-2 pr-4">{client.taxId}</td>
                <td className="py-2">{CLIENT_STATUS[client.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
