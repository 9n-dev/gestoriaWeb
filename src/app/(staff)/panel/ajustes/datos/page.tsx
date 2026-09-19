import { notFound } from 'next/navigation';
import { formatDateTime, formatLongDate } from '@/lib/dates';
import { requireArea } from '@/modules/auth/area';
import { can } from '@/modules/auth/permissions';
import { listClientsFor } from '@/modules/clients/service';
import { DEFAULT_RETENTION_YEARS, listPendingErasures } from '@/modules/gdpr/erasure';
import { listExports } from '@/modules/gdpr/export';
import { getOwnTenant } from '@/modules/tenants/service';
import {
  CancelErasureForm,
  CancelTenantForm,
  ClientDataForm,
  ExportTenantForm,
  RetentionForm,
} from './forms';

const EXPORT_STATUS = {
  PENDING: 'En cola',
  PROCESSING: 'Preparándose',
  READY: 'Lista',
  FAILED: 'Ha fallado',
  EXPIRED: 'Caducada',
} as const;

export default async function DataPage() {
  const user = await requireArea('area.staff');
  if (!can(user, 'data.exportTenant')) notFound();
  const [tenant, clients, exports, erasures] = await Promise.all([
    getOwnTenant(user),
    listClientsFor(user),
    listExports(user),
    listPendingErasures(user),
  ]);
  const years =
    (tenant.settings as { retentionYears?: number } | null)?.retentionYears ??
    DEFAULT_RETENTION_YEARS;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Datos y privacidad</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Exportar</h2>
        <p className="max-w-prose text-sm text-fg-muted">
          Un ZIP con todos los datos en CSV y los archivos. Se prepara en segundo plano y te llega
          un enlace por correo; también puedes descargarlo aquí durante 7 días.
        </p>
        <ExportTenantForm />
        {exports.length > 0 && (
          <table className="w-full max-w-3xl border-collapse text-left text-sm">
            <caption className="sr-only">Exportaciones recientes</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Solicitada
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Contenido
                </th>
                <th scope="col" className="py-2 font-medium">
                  Estado
                </th>
              </tr>
            </thead>
            <tbody>
              {exports.map((item) => (
                <tr key={item.id} className="border-b border-border">
                  <td className="py-2 pr-4">{formatDateTime(item.createdAt)}</td>
                  <td className="py-2 pr-4">{item.client?.legalName ?? 'Toda la gestoría'}</td>
                  <td className="py-2">
                    {item.status === 'READY' && item.expiresAt && item.expiresAt > new Date() ? (
                      <a href={`/api/exports/${item.id}`} className="underline">
                        Descargar
                      </a>
                    ) : (
                      EXPORT_STATUS[item.status]
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-lg font-semibold">Derechos de acceso y supresión de un cliente</h2>
        <p className="max-w-prose text-sm text-fg-muted">
          Si un cliente te pide sus datos o que los borres, hazlo desde aquí. La supresión tiene 30
          días de margen por si fue un error.
        </p>
        <ClientDataForm clients={clients.map(({ id, legalName }) => ({ id, legalName }))} />
        {erasures.length > 0 && (
          <ul className="flex max-w-3xl flex-col divide-y divide-border">
            {erasures.map((client) => (
              <li
                key={client.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span>
                  {client.legalName} · se borrará el{' '}
                  {client.purgeAfter && formatLongDate(client.purgeAfter)}
                </span>
                <CancelErasureForm clientId={client.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-lg font-semibold">Retención de documentos</h2>
        <p className="max-w-prose text-sm text-fg-muted">
          Pasado este plazo, los documentos de los clientes se borran automáticamente. Las facturas
          que emites no se ven afectadas.
        </p>
        <RetentionForm years={years} />
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-lg font-semibold">Dar de baja la gestoría</h2>
        <p className="max-w-prose text-sm text-fg-muted">
          El portal se cierra en el momento para todo el mundo. Te enviamos por correo una
          exportación completa y a los 30 días borramos definitivamente todos los datos y archivos.
        </p>
        <CancelTenantForm slug={tenant.slug} />
      </section>
    </div>
  );
}
