import { formatLongDate, isoDate, todayInMadrid } from '@/lib/dates';
import { OBLIGATION_STATUS, periodLabel } from '@/lib/labels';
import { relativeDays, resultLabel } from '@/lib/labels-obligations';
import { formatEuros } from '@/lib/money';
import { requireArea } from '@/modules/auth/area';
import { listClientsFor } from '@/modules/clients/service';
import { modelName } from '@/modules/obligations/calendar';
import { listClientObligations } from '@/modules/obligations/workflow';

export default async function ClientDeadlinesPage() {
  const user = await requireArea('area.client');
  const today = todayInMadrid();
  const clients = await listClientsFor(user);
  const all = (
    await Promise.all(clients.map((client) => listClientObligations(user, client.id)))
  ).flat();
  const upcoming = all
    .filter((o) => o.status !== 'FILED')
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const filed = all
    .filter((o) => o.status === 'FILED')
    .sort((a, b) => (b.filedAt?.getTime() ?? 0) - (a.filedAt?.getTime() ?? 0));

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Próximos plazos</h1>
        {upcoming.length === 0 ? (
          <p className="text-fg-muted">No tienes plazos pendientes.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {upcoming.map((o) => (
              <li key={o.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <p className="font-medium">
                    Modelo {o.model} · {periodLabel(o.period)}
                  </p>
                  <p>
                    {formatLongDate(o.dueDate)}{' '}
                    <span className="text-fg-muted">
                      ({relativeDays(today, isoDate(o.dueDate))})
                    </span>
                  </p>
                </div>
                <p className="text-fg-muted">
                  {modelName(o.model)}
                  {clients.length > 1 && ` · ${o.client.legalName}`}
                </p>
                <p className="mt-1">
                  {OBLIGATION_STATUS[o.status]}
                  {o.estimatedAmount !== null &&
                    ` · Importe previsto: ${formatEuros(o.estimatedAmount)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {filed.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Presentados</h2>
          <ul className="flex flex-col gap-2">
            {filed.map((o) => (
              <li key={o.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <p className="font-medium">
                    Modelo {o.model} · {periodLabel(o.period)}
                  </p>
                  <p className="font-medium">{resultLabel(o)}</p>
                </div>
                <p className="text-fg-muted">
                  Presentado el {o.filedAt ? formatLongDate(isoDate(o.filedAt)) : ''}
                  {o.receiptFile &&
                    !o.receiptFile.deletedAt &&
                    o.receiptFile.status === 'CLEAN' && (
                      <>
                        {' · '}
                        <a href={`/api/files/${o.receiptFile.id}`} className="underline">
                          Descargar justificante
                        </a>
                      </>
                    )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
