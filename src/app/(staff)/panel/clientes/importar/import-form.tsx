'use client';

import { ActionForm, SubmitButton } from '@/components/ui/form';
import type { ImportReport } from '@/modules/clients/import';
import { importClientsAction } from '../actions';

export function ImportForm() {
  return (
    <ActionForm
      action={importClientsAction}
      renderResult={(state) => {
        const report = state.data as ImportReport | undefined;
        if (!report?.rejected.length) return null;
        return (
          <table className="mt-3 w-full border-collapse text-left">
            <caption className="pb-2 text-left font-medium">Filas que no se han importado</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-1 pr-4 font-medium">
                  Fila
                </th>
                <th scope="col" className="py-1 pr-4 font-medium">
                  Cliente
                </th>
                <th scope="col" className="py-1 font-medium">
                  Motivo
                </th>
              </tr>
            </thead>
            <tbody>
              {report.rejected.map((row) => (
                <tr key={row.row} className="border-b border-border align-top">
                  <td className="py-1 pr-4">{row.row}</td>
                  <td className="py-1 pr-4">{row.legalName || '—'}</td>
                  <td className="py-1">{row.errors.join(' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="file" className="text-sm font-medium">
          Archivo Excel (.xlsx) o CSV
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
          className="text-sm"
        />
      </div>
      <SubmitButton pendingLabel="Importando…">Importar clientes</SubmitButton>
    </ActionForm>
  );
}
