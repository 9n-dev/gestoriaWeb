import Link from 'next/link';
import { AppHeader } from '@/components/app-header';
import { requireArea } from '@/modules/auth/area';
import { listFailedJobs } from '@/modules/platform/jobs';
import { RetryAllButton, RetryButton } from './retry-button';

export const dynamic = 'force-dynamic';

const dateTime = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Madrid',
});

export default async function FailedJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ pagina?: string }>;
}) {
  const user = await requireArea('area.platform');
  const { jobs, total, page, pages } = await listFailedJobs(
    user,
    Number((await searchParams).pagina),
  );
  return (
    <>
      <AppHeader
        tenant={null}
        userName={user.name}
        nav={[
          { href: '/plataforma', label: 'Gestorías' },
          { href: '/plataforma/jobs', label: 'Jobs fallidos' },
        ]}
      />
      <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
        <h1 className="text-2xl font-semibold">Jobs fallidos</h1>
        <p className="text-sm text-fg-muted">
          Trabajos que agotaron sus reintentos. Solo se muestran identificadores, nunca datos de
          clientes.{' '}
          <Link href="/plataforma" className="underline">
            Volver a gestorías
          </Link>
        </p>
        {total > 1 && <RetryAllButton total={total} />}
        {jobs.length === 0 ? (
          <p>No hay jobs fallidos.</p>
        ) : (
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Jobs que agotaron sus reintentos</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Cola / job
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Falló
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Intentos
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Motivo
                </th>
                <th scope="col" className="py-2 font-medium">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={`${job.queue}/${job.id}`} className="border-b border-border align-top">
                  <td className="py-2 pr-4">
                    {job.queue} / {job.name}
                    <br />
                    <code className="text-xs text-fg-muted">{JSON.stringify(job.data)}</code>
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {job.failedAt ? dateTime.format(new Date(job.failedAt)) : '—'}
                  </td>
                  <td className="py-2 pr-4">{job.attempts}</td>
                  <td className="py-2 pr-4">{job.reason}</td>
                  <td className="py-2">
                    <RetryButton queue={job.queue} jobId={job.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {pages > 1 && (
          <nav aria-label="Páginas de jobs" className="flex items-center gap-4 text-sm">
            {page > 1 && (
              <Link href={`/plataforma/jobs?pagina=${page - 1}`} className="underline" rel="prev">
                Anterior
              </Link>
            )}
            <span className="text-fg-muted">
              Página {page} de {pages} · {total} jobs
            </span>
            {page < pages && (
              <Link href={`/plataforma/jobs?pagina=${page + 1}`} className="underline" rel="next">
                Siguiente
              </Link>
            )}
          </nav>
        )}
      </main>
    </>
  );
}
