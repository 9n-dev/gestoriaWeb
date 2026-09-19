import Link from 'next/link';
import { formatLongDate, isoDate } from '@/lib/dates';
import { periodLabel } from '@/lib/labels';
import { requireArea } from '@/modules/auth/area';
import { listClientsFor } from '@/modules/clients/service';
import { listDeliveries } from '@/modules/deliveries/service';

export default async function ClientDeliveriesPage() {
  const user = await requireArea('area.client');
  const clients = await listClientsFor(user);
  const deliveries = (
    await Promise.all(clients.map((client) => listDeliveries(user, client.id)))
  ).flat();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Documentos de tu gestoría</h1>
      {deliveries.length === 0 ? (
        <p className="text-fg-muted">Todavía no te hemos enviado ningún documento.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {deliveries.map((delivery) => (
            <li key={delivery.id}>
              <Link
                href={`/entregas/${delivery.id}`}
                className="block rounded-md border border-border p-3 text-sm hover:bg-surface-muted"
              >
                <span className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span className="font-medium">{delivery.title}</span>
                  {delivery.requiresSignature && (
                    <span
                      className={delivery.signedAt ? 'text-fg-muted' : 'font-medium text-danger'}
                    >
                      {delivery.signedAt ? 'Firmado' : 'Pendiente de tu conformidad'}
                    </span>
                  )}
                </span>
                <span className="text-fg-muted">
                  {formatLongDate(isoDate(delivery.visibleFrom))}
                  {delivery.period && ` · ${periodLabel(delivery.period)}`}
                  {clients.length > 1 && ` · ${delivery.client.legalName}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
