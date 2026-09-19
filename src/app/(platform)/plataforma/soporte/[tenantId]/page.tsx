import Link from 'next/link';
import { AppHeader } from '@/components/app-header';
import { formatLongDate } from '@/lib/dates';
import { CLIENT_STATUS, TENANT_STATUS } from '@/lib/labels';
import { requireArea } from '@/modules/auth/area';
import { supportOverview } from '@/modules/platform/support';

/** Read-only look at a tenant that opened support mode. Every visit is written to their audit log. */
export default async function SupportPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const user = await requireArea('area.platform');
  const overview = await supportOverview(user, (await params).tenantId);
  const figures = [
    ['Usuarios', overview.users],
    ['Documentos', overview.documents],
    ['Archivos infectados', overview.infectedFiles],
    ['Extracciones fallidas', overview.failedExtractions],
    ['Correos fallidos', overview.failedEmails],
  ] as const;

  return (
    <>
      <AppHeader
        tenant={null}
        userName={user.name}
        nav={[{ href: '/plataforma', label: 'Gestorías' }]}
      />
      <main className="mx-auto flex max-w-5xl flex-col gap-6 p-4">
        <p className="text-sm">
          <Link href="/plataforma" className="underline">
            Volver
          </Link>
        </p>
        <div>
          <h1 className="text-2xl font-semibold">{overview.tenant.name}</h1>
          <p className="text-fg-muted">
            Modo soporte (solo lectura) · {TENANT_STATUS[overview.tenant.status]} · alta el{' '}
            {formatLongDate(overview.tenant.createdAt)}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {figures.map(([label, value]) => (
            <div key={label} className="rounded-md border border-border p-3">
              <dt className="text-sm text-fg-muted">{label}</dt>
              <dd className="text-xl font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        <table className="w-full border-collapse text-left text-sm">
          <caption className="pb-2 text-left text-lg font-semibold">Clientes</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-2 pr-4 font-medium">
                Nombre
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Estado
              </th>
              <th scope="col" className="py-2 font-medium">
                Alta
              </th>
            </tr>
          </thead>
          <tbody>
            {overview.clients.map((client) => (
              <tr key={client.id} className="border-b border-border">
                <td className="py-2 pr-4">{client.legalName}</td>
                <td className="py-2 pr-4">{CLIENT_STATUS[client.status]}</td>
                <td className="py-2">{formatLongDate(client.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </>
  );
}
