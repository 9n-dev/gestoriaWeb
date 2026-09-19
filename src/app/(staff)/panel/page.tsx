import Link from 'next/link';
import { requireArea } from '@/modules/auth/area';
import { getDashboard } from '@/modules/checklists/dashboard';

function Stat({
  href,
  value,
  label,
  alert,
}: {
  href: string;
  value: string | number;
  label: string;
  alert?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-md border border-border p-4 hover:bg-surface-muted"
    >
      <span className={`text-3xl font-semibold ${alert ? 'text-danger' : ''}`}>{value}</span>
      <span className="text-sm text-fg-muted">{label}</span>
    </Link>
  );
}

export default async function DashboardPage() {
  const user = await requireArea('area.staff');
  const stats = await getDashboard(user);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Hola, {user.name.split(' ')[0]}</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          href="/panel/semaforo?estado=RED"
          value={stats.redClients}
          label="clientes en rojo"
          alert={stats.redClients > 0}
        />
        <Stat
          href="/panel/bandeja"
          value={stats.documentsToProcess}
          label="documentos por procesar"
        />
        <Stat
          href="/panel/plazos?dias=7"
          value={stats.deadlinesThisWeek}
          label="presentaciones esta semana"
        />
        <Stat
          href="/panel/bandeja?estado=BOOKED&orden=newest"
          value={
            stats.averageProcessingHours === null
              ? '—'
              : `${String(stats.averageProcessingHours).replace('.', ',')} h`
          }
          label="tiempo medio de procesado (30 días)"
        />
      </div>

      {stats.loadPerManager && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Carga por gestor</h2>
          <table className="w-full max-w-xl border-collapse text-left text-sm">
            <caption className="sr-only">Clientes y documentos pendientes de cada gestor</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Gestor
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Clientes
                </th>
                <th scope="col" className="py-2 font-medium">
                  Documentos por procesar
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.loadPerManager.map((row) => (
                <tr key={row.managerName} className="border-b border-border">
                  <td className="py-2 pr-4">{row.managerName}</td>
                  <td className="py-2 pr-4">{row.clients}</td>
                  <td className="py-2">{row.documentsToProcess}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
