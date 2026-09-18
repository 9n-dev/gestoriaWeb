import { requireArea } from '@/modules/auth/area';
import { listClientsFor } from '@/modules/clients/service';

export default async function StaffHomePage() {
  const user = await requireArea('area.staff');
  const clients = await listClientsFor(user);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Clientes</h1>
      {clients.length === 0 ? (
        <p className="text-fg-muted">Todavía no tienes clientes asignados.</p>
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
                <td className="py-2 pr-4">{client.legalName}</td>
                <td className="py-2 pr-4">{client.taxId}</td>
                <td className="py-2">{STATUS_LABEL[client.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const STATUS_LABEL = { ACTIVE: 'Activo', INACTIVE: 'Inactivo', DELINQUENT: 'Moroso' } as const;
