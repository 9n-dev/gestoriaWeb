import { Uploader } from '@/components/uploader/uploader';
import { todayInMadrid } from '@/lib/dates';
import { recentQuarters } from '@/lib/periods';
import { requireArea } from '@/modules/auth/area';
import { listClientsFor } from '@/modules/clients/service';
import { listInboundAddresses } from '@/modules/documents/inbound/service';
import { getCurrentTenant } from '@/modules/tenants/current';

export default async function UploadPage() {
  const user = await requireArea('area.client');
  const [clients, tenant] = await Promise.all([listClientsFor(user), getCurrentTenant()]);
  // Only for the clients this user can see.
  const addresses = tenant
    ? await listInboundAddresses(
        tenant,
        clients.map((client) => client.id),
      )
    : [];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Subir documentos</h1>
      <Uploader
        clients={clients.map((client) => ({ id: client.id, name: client.legalName }))}
        periods={recentQuarters(todayInMadrid())}
      />
      {addresses.length > 0 && (
        <section className="rounded-md bg-surface-muted p-4 text-sm">
          <h2 className="font-semibold">También por correo</h2>
          <p className="mt-1 text-fg-muted">
            Reenvía tus facturas como adjunto a tu dirección personal:
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {addresses.map((client) => (
              <li key={client.clientId}>
                {addresses.length > 1 && (
                  <span className="text-fg-muted">{client.legalName}: </span>
                )}
                <code className="break-all">{client.address}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
