'use client';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ActionForm, SelectField, SubmitButton } from '@/components/ui/form';
import {
  cancelErasureAction,
  cancelTenantAction,
  clientDataAction,
  exportTenantAction,
  retentionAction,
} from './actions';

export function ExportTenantForm() {
  return (
    <ActionForm action={exportTenantAction}>
      <SubmitButton variant="secondary" pendingLabel="Preparando…">
        Exportar todos los datos
      </SubmitButton>
    </ActionForm>
  );
}

export function ClientDataForm({ clients }: { clients: Array<{ id: string; legalName: string }> }) {
  return (
    <ActionForm action={clientDataAction} className="flex max-w-xl flex-col gap-4">
      <SelectField label="Cliente" name="clientId" required>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.legalName}
          </option>
        ))}
      </SelectField>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="understood" className="mt-1 size-4" />
        <span>
          Solo para suprimir: entiendo que el cliente dejará de verse ahora y que a los 30 días se
          borrarán sus documentos, mensajes y entregas. Las facturas emitidas se conservan por
          obligación legal.
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="intent" value="export" variant="secondary">
          Exportar sus datos
        </Button>
        <Button type="submit" name="intent" value="erase" variant="secondary">
          Suprimir cliente
        </Button>
      </div>
    </ActionForm>
  );
}

export function CancelErasureForm({ clientId }: { clientId: string }) {
  return (
    <ActionForm action={cancelErasureAction.bind(null, clientId)} className="flex flex-col gap-1">
      <SubmitButton variant="secondary" pendingLabel="Recuperando…">
        Recuperar
      </SubmitButton>
    </ActionForm>
  );
}

export function RetentionForm({ years }: { years: number }) {
  return (
    <ActionForm action={retentionAction} className="flex max-w-xs flex-col gap-4">
      <Field
        label="Años que se conservan los documentos"
        name="years"
        type="number"
        min={4}
        max={15}
        defaultValue={years}
        required
      />
      <SubmitButton variant="secondary">Guardar</SubmitButton>
    </ActionForm>
  );
}

export function CancelTenantForm({ slug }: { slug: string }) {
  return (
    <ActionForm action={cancelTenantAction} className="flex max-w-md flex-col gap-4">
      <Field
        label={`Escribe «${slug}» para confirmar`}
        name="confirmation"
        autoComplete="off"
        required
      />
      <SubmitButton variant="secondary" pendingLabel="Dando de baja…">
        Dar de baja la gestoría
      </SubmitButton>
    </ActionForm>
  );
}
