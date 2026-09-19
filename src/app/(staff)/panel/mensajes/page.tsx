import { ThreadList, THREAD_TYPE } from '@/components/messaging/thread-list';
import { requireArea } from '@/modules/auth/area';
import { listThreads, threadFiltersSchema } from '@/modules/messaging/service';

const select = 'min-h-9 rounded-md border border-border bg-surface px-2 font-normal';
const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) || undefined;

export default async function StaffThreadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireArea('area.staff');
  const params = await searchParams;
  const parsed = threadFiltersSchema.safeParse({
    type: first(params.tipo),
    status: first(params.estado) ?? 'OPEN',
    clientId: first(params.cliente),
    unreadOnly: first(params.sinleer) === '1',
  });
  const filters = parsed.success ? parsed.data : threadFiltersSchema.parse({ status: 'OPEN' });
  const threads = await listThreads(user, filters);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Mensajes</h1>
      <form method="get" className="flex flex-wrap items-end gap-x-4 gap-y-2 text-sm">
        <label className="flex flex-col gap-1 font-medium">
          Tipo
          <select name="tipo" defaultValue={filters.type ?? ''} className={select}>
            <option value="">Todos</option>
            {Object.entries(THREAD_TYPE).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 font-medium">
          Estado
          <select name="estado" defaultValue={filters.status ?? ''} className={select}>
            <option value="OPEN">Abiertas</option>
            <option value="CLOSED">Cerradas</option>
          </select>
        </label>
        <label className="flex min-h-9 items-center gap-2">
          <input
            type="checkbox"
            name="sinleer"
            value="1"
            defaultChecked={filters.unreadOnly}
            className="size-4"
          />{' '}
          Solo sin leer
        </label>
        <button
          type="submit"
          className="inline-flex min-h-9 items-center rounded-md border border-border px-3 hover:bg-surface-muted"
        >
          Filtrar
        </button>
      </form>
      <ThreadList threads={threads} basePath="/panel/mensajes" showClient />
      <p className="text-sm text-fg-muted">
        Para abrir una conversación nueva, ve a la ficha del cliente.
      </p>
    </div>
  );
}
