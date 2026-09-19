import { todayInMadrid } from '@/lib/dates';
import { recentQuarters } from '@/lib/periods';
import { requireArea } from '@/modules/auth/area';
import { can } from '@/modules/auth/permissions';
import { listClientsFor } from '@/modules/clients/service';
import { EXPORT_COLUMNS, getExportFormat } from '@/modules/documents/export';
import { ExportFormatForm } from './format-form';

const select = 'min-h-11 rounded-md border border-border bg-surface px-3';

export default async function ExportPage() {
  const user = await requireArea('area.staff');
  const [clients, format] = await Promise.all([
    listClientsFor(user),
    getExportFormat(user.tenantId!),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Exportar a contabilidad</h1>
        <p className="max-w-2xl text-sm text-fg-muted">
          Descarga los documentos de un periodo con sus datos para importarlos en tu programa
          contable.
        </p>
        {/* A plain GET form: the browser downloads the file, no JavaScript needed. */}
        <form
          method="get"
          action="/panel/exportar/descargar"
          className="flex flex-wrap items-end gap-4 text-sm"
        >
          <label className="flex flex-col gap-1.5 font-medium">
            Periodo
            <select name="periodo" className={select}>
              {recentQuarters(todayInMadrid(), 8).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 font-medium">
            Cliente
            <select name="cliente" className={select}>
              <option value="">Todos los que gestiono</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.legalName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 font-medium">
            Formato
            <select name="formato" className={select}>
              <option value="xlsx">Excel (.xlsx)</option>
              <option value="csv">CSV</option>
            </select>
          </label>
          <button
            type="submit"
            className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 font-medium text-primary-fg"
          >
            Descargar
          </button>
        </form>
      </section>

      {can(user, 'tenantSettings.manage') && (
        <section className="flex flex-col gap-4 border-t border-border pt-6">
          <h2 className="text-lg font-semibold">Formato de la exportación</h2>
          <ExportFormatForm
            columns={Object.entries(EXPORT_COLUMNS).map(([key, column]) => ({
              key,
              label: column.label,
            }))}
            selected={format.columns}
            decimalSeparator={format.decimalSeparator}
            onlyBooked={format.onlyBooked}
          />
        </section>
      )}
    </div>
  );
}
