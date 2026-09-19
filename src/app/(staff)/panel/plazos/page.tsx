import Link from 'next/link';
import { formatLongDate, isoDate, todayInMadrid } from '@/lib/dates';
import { OBLIGATION_STATUS, periodLabel } from '@/lib/labels';
import { relativeDays } from '@/lib/labels-obligations';
import { requireArea } from '@/modules/auth/area';
import { can } from '@/modules/auth/permissions';
import { listAssignableManagers } from '@/modules/clients/service';
import { knownModels } from '@/modules/obligations/calendar';
import { listUpcomingObligations, upcomingFiltersSchema } from '@/modules/obligations/workflow';

const select = 'min-h-9 rounded-md border border-border bg-surface px-2 font-normal';
const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) || undefined;

export default async function FilingCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireArea('area.staff');
  const params = await searchParams;
  const parsed = upcomingFiltersSchema.safeParse({
    days: first(params.dias),
    managerId: first(params.gestor),
    status: first(params.estado),
    model: first(params.modelo),
  });
  const filters = parsed.success ? parsed.data : upcomingFiltersSchema.parse({});
  const today = todayInMadrid();
  const [obligations, managers] = await Promise.all([
    listUpcomingObligations(user, filters, today),
    can(user, 'dashboard.viewGlobal') ? listAssignableManagers(user) : [],
  ]);
  const byDate = Map.groupBy(obligations, (o) => isoDate(o.dueDate));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Calendario de presentaciones</h1>
      <form method="get" className="flex flex-wrap items-end gap-x-4 gap-y-2 text-sm">
        <label className="flex flex-col gap-1 font-medium">
          Horizonte
          <select name="dias" defaultValue={String(filters.days)} className={select}>
            <option value="7">7 días</option>
            <option value="30">30 días</option>
            <option value="90">90 días</option>
            <option value="366">Un año</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 font-medium">
          Modelo
          <select name="modelo" defaultValue={filters.model ?? ''} className={select}>
            <option value="">Todos</option>
            {knownModels().map((model) => (
              <option key={model}>{model}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 font-medium">
          Estado
          <select name="estado" defaultValue={filters.status ?? ''} className={select}>
            <option value="">Todos</option>
            {Object.entries(OBLIGATION_STATUS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {managers.length > 0 && (
          <label className="flex flex-col gap-1 font-medium">
            Gestor
            <select name="gestor" defaultValue={filters.managerId ?? ''} className={select}>
              <option value="">Todos</option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {manager.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="submit"
          className="inline-flex min-h-9 items-center rounded-md border border-border px-3 hover:bg-surface-muted"
        >
          Filtrar
        </button>
      </form>

      {obligations.length === 0 ? (
        <p className="text-fg-muted">No hay presentaciones en este horizonte.</p>
      ) : (
        [...byDate].map(([date, items]) => (
          <section key={date} aria-labelledby={`d-${date}`} className="flex flex-col gap-1">
            <h2
              id={`d-${date}`}
              className={`text-sm font-semibold ${date < today ? 'text-danger' : ''}`}
            >
              {formatLongDate(date)}{' '}
              <span className="font-normal text-fg-muted">· {relativeDays(today, date)}</span>
            </h2>
            <ul className="flex flex-col text-sm">
              {items.map((o) => (
                <li
                  key={o.id}
                  className="flex flex-wrap justify-between gap-x-4 border-b border-border py-1.5"
                >
                  <span>
                    <span className="font-medium">{o.model}</span> · {periodLabel(o.period)} ·{' '}
                    <Link
                      href={`/panel/clientes/${o.clientId}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {o.client.legalName}
                    </Link>
                  </span>
                  <span className="text-fg-muted">{OBLIGATION_STATUS[o.status]}</span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
