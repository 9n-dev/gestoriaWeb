import Link from 'next/link';
import { LightBadge } from '@/components/light-badge';
import { formatLongDate, todayInMadrid } from '@/lib/dates';
import { relativeDays } from '@/lib/labels-obligations';
import { periodValue, recentMonths, recentQuarters } from '@/lib/periods';
import { requireArea } from '@/modules/auth/area';
import { can } from '@/modules/auth/permissions';
import { tenantOverview } from '@/modules/checklists/service';
import { listAssignableManagers } from '@/modules/clients/service';
import { overviewParams } from './params';

const select = 'min-h-9 rounded-md border border-border bg-surface px-2 font-normal';
const chip =
  'inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-surface-muted';

export default async function TrafficLightPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireArea('area.staff');
  const params = await searchParams;
  const { period, filters } = overviewParams(params);
  const today = todayInMadrid();
  const [rows, managers] = await Promise.all([
    tenantOverview(user, period, filters, today),
    can(user, 'dashboard.viewGlobal') ? listAssignableManagers(user) : [],
  ]);
  const query = new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) =>
      typeof value === 'string' && value ? [[key, value]] : [],
    ),
  );
  const sortLink = (sort: string) =>
    `?${new URLSearchParams({ ...Object.fromEntries(query), orden: sort })}`;
  const counts = { RED: 0, AMBER: 0, GREEN: 0 };
  rows.forEach((row) => counts[row.light]++);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Semáforo de documentación</h1>
        <a href={`/panel/semaforo/exportar?${query}`} download className={chip}>
          Exportar CSV
        </a>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-x-4 gap-y-2 text-sm">
        <label className="flex flex-col gap-1 font-medium">
          Periodo
          <select name="periodo" defaultValue={periodValue(period)} className={select}>
            <optgroup label="Trimestres">
              {recentQuarters(today, 6).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Meses (clientes con IVA mensual)">
              {recentMonths(today, 6).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
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
        <label className="flex flex-col gap-1 font-medium">
          Estado
          <select name="estado" defaultValue={filters.light ?? ''} className={select}>
            <option value="">Todos</option>
            <option value="RED">Rojo</option>
            <option value="AMBER">Ámbar</option>
            <option value="GREEN">Verde</option>
          </select>
        </label>
        <input type="hidden" name="orden" value={filters.sort} />
        <button type="submit" className={chip}>
          Filtrar
        </button>
      </form>

      <p className="flex flex-wrap gap-x-5 text-sm">
        <LightBadge light="RED" text={`${counts.RED} en rojo`} />
        <LightBadge light="AMBER" text={`${counts.AMBER} en ámbar`} />
        <LightBadge light="GREEN" text={`${counts.GREEN} en verde`} />
      </p>

      {rows.length === 0 ? (
        <p className="text-fg-muted">
          Ningún cliente tiene lista de documentación para este periodo con estos filtros.
        </p>
      ) : (
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">
            Estado de la documentación por cliente. Las cabeceras ordenan la tabla.
          </caption>
          <thead>
            <tr className="border-b border-border">
              {(
                [
                  ['light', 'Estado'],
                  ['client', 'Cliente'],
                  ['manager', 'Gestor'],
                  ['deadline', 'Fecha límite'],
                ] as const
              ).map(([sort, label]) => (
                <th
                  key={sort}
                  scope="col"
                  aria-sort={filters.sort === sort ? 'ascending' : undefined}
                  className="py-2 pr-4 font-medium"
                >
                  <Link href={sortLink(sort)} className="underline-offset-2 hover:underline">
                    {label}
                    {filters.sort === sort && ' ↑'}
                  </Link>
                </th>
              ))}
              <th scope="col" className="py-2 font-medium">
                Pendiente
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.clientId} className="border-b border-border align-top">
                <td className="py-2 pr-4">
                  <LightBadge light={row.light} />
                </td>
                <td className="py-2 pr-4">
                  <Link
                    href={`/panel/clientes/${row.clientId}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {row.legalName}
                  </Link>
                  {row.closed && <span className="text-fg-muted"> · cerrada</span>}
                </td>
                <td className="py-2 pr-4">{row.managerName ?? '—'}</td>
                <td className="py-2 pr-4 whitespace-nowrap">
                  {formatLongDate(row.deadline)}{' '}
                  <span className="text-fg-muted">({relativeDays(today, row.deadline)})</span>
                </td>
                <td className="py-2">{row.missing.length ? row.missing.join(', ') : 'Nada'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
