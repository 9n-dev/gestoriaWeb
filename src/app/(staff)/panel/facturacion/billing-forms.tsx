'use client';

import { cancelInvoiceAction, createInvoiceAction, markPaidAction } from '@/app/actions/billing';
import { Field } from '@/components/ui/field';
import { ActionForm, SelectField, SubmitButton } from '@/components/ui/form';

export function NewInvoiceForm({ clients }: { clients: Array<{ id: string; name: string }> }) {
  return (
    <ActionForm action={createInvoiceAction} className="flex max-w-3xl flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Cliente" name="clientId" required>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Forma de pago" name="paymentMethod" defaultValue="BANK_TRANSFER">
          <option value="BANK_TRANSFER">Transferencia</option>
          <option value="CARD">Tarjeta</option>
          <option value="SEPA_DEBIT">Domiciliación SEPA</option>
        </SelectField>
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <Field label={`Concepto ${i + 1}`} name={`description${i}`} required={i === 0} />
          <Field
            label="Importe (€)"
            name={`unitPrice${i}`}
            id={`unitPrice${i}`}
            inputMode="decimal"
            required={i === 0}
          />
        </div>
      ))}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="% IVA" name="vatRate" inputMode="decimal" defaultValue="21" />
        <Field label="% retención IRPF" name="irpfRate" inputMode="decimal" defaultValue="0" />
      </div>
      <SubmitButton pendingLabel="Emitiendo…">Emitir factura</SubmitButton>
    </ActionForm>
  );
}

export function InvoiceButtons({ id, status }: { id: string; status: string }) {
  if (status !== 'ISSUED' && status !== 'OVERDUE') return null;
  return (
    <div className="flex flex-wrap gap-1">
      <ActionForm action={markPaidAction.bind(null, id)}>
        <SubmitButton variant="ghost" pendingLabel="…">
          Cobrada
        </SubmitButton>
      </ActionForm>
      <ActionForm action={cancelInvoiceAction.bind(null, id)}>
        <SubmitButton variant="ghost" pendingLabel="…">
          Anular
        </SubmitButton>
      </ActionForm>
    </div>
  );
}
