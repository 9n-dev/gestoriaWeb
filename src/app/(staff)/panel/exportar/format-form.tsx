'use client';

import { saveExportFormatAction } from '../ajustes/actions';
import { ActionForm, SubmitButton } from '@/components/ui/form';

export function ExportFormatForm({
  columns,
  selected,
  decimalSeparator,
  onlyBooked,
}: {
  columns: Array<{ key: string; label: string }>;
  selected: string[];
  decimalSeparator: string;
  onlyBooked: boolean;
}) {
  return (
    <ActionForm action={saveExportFormatAction} className="flex flex-col gap-4 text-sm">
      <fieldset className="grid gap-2 sm:grid-cols-3">
        <legend className="mb-2 font-medium">Columnas</legend>
        {columns.map((column) => (
          <label key={column.key} className="flex items-center gap-2">
            <input
              type="checkbox"
              name="columns"
              value={column.key}
              defaultChecked={selected.includes(column.key)}
              className="size-4"
            />
            {column.label}
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-2 font-medium">Separador decimal (CSV)</legend>
        {[',', '.'].map((separator) => (
          <label key={separator} className="flex items-center gap-2">
            <input
              type="radio"
              name="decimalSeparator"
              value={separator}
              defaultChecked={decimalSeparator === separator}
              className="size-4"
            />
            {separator === ',' ? 'Coma (1210,50)' : 'Punto (1210.50)'}
          </label>
        ))}
      </fieldset>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="onlyBooked" defaultChecked={onlyBooked} className="size-4" />
        Exportar solo los documentos contabilizados
      </label>
      <SubmitButton variant="secondary">Guardar formato</SubmitButton>
    </ActionForm>
  );
}
