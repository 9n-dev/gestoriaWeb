'use client';

import { useRef, useState } from 'react';
import { cancelInvoiceAction, createInvoiceAction, markPaidAction } from '@/app/actions/billing';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ActionForm, SelectField, SubmitButton } from '@/components/ui/form';
import { formatEuros } from '@/lib/money';
import { computeTotals } from '@/modules/billing/totals';

const MAX_LINES = 50;
const toNumber = (text: string) => Number(text.replace(/\./g, '').replace(',', '.')) || 0;

type DraftLine = {
  key: number;
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
  irpfRate: string;
};
const emptyLine = (key: number): DraftLine => ({
  key,
  description: '',
  quantity: '1',
  unitPrice: '',
  vatRate: '21',
  irpfRate: '0',
});

/** Manual invoice: as many lines as needed (§6.11), each with its own VAT and withholding, and the total as you type. */
export function NewInvoiceForm({ clients }: { clients: Array<{ id: string; name: string }> }) {
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(0)]);
  const nextKey = useRef(1);
  const change = (key: number, field: keyof DraftLine, value: string) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, [field]: value } : line)),
    );

  const totals = computeTotals(
    lines
      .filter((line) => line.unitPrice !== '')
      .map((line) => ({
        description: line.description,
        quantity: toNumber(line.quantity),
        unitPrice: toNumber(line.unitPrice),
        vatRate: toNumber(line.vatRate),
        irpfRate: toNumber(line.irpfRate),
      })),
  );

  return (
    <ActionForm action={createInvoiceAction} className="flex max-w-4xl flex-col gap-4">
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

      <ol className="flex flex-col gap-3">
        {lines.map((line, index) => (
          <li key={line.key} className="rounded-md border border-border p-3">
            <fieldset className="grid gap-3 sm:grid-cols-[1fr_5.5rem_8rem_6.5rem_6.5rem_auto] sm:items-end">
              <legend className="sr-only">Concepto {index + 1}</legend>
              <Field
                label={`Concepto ${index + 1}`}
                name="description"
                id={`description-${line.key}`}
                value={line.description}
                onChange={(event) => change(line.key, 'description', event.target.value)}
                required
              />
              <Field
                label="Cantidad"
                name="quantity"
                id={`quantity-${line.key}`}
                inputMode="decimal"
                value={line.quantity}
                onChange={(event) => change(line.key, 'quantity', event.target.value)}
                required
              />
              <Field
                label="Precio (€)"
                name="unitPrice"
                id={`unitPrice-${line.key}`}
                inputMode="decimal"
                value={line.unitPrice}
                onChange={(event) => change(line.key, 'unitPrice', event.target.value)}
                required
              />
              <SelectField
                label="IVA"
                name="vatRate"
                id={`vatRate-${line.key}`}
                value={line.vatRate}
                onChange={(event) => change(line.key, 'vatRate', event.target.value)}
              >
                <option value="21">21 %</option>
                <option value="10">10 %</option>
                <option value="4">4 %</option>
                <option value="0">0 % (exento o suplido)</option>
              </SelectField>
              <Field
                label="% IRPF"
                name="irpfRate"
                id={`irpfRate-${line.key}`}
                inputMode="decimal"
                value={line.irpfRate}
                onChange={(event) => change(line.key, 'irpfRate', event.target.value)}
              />
              <Button
                type="button"
                variant="ghost"
                disabled={lines.length === 1}
                onClick={() =>
                  setLines((current) => current.filter((other) => other.key !== line.key))
                }
              >
                Quitar<span className="sr-only"> el concepto {index + 1}</span>
              </Button>
            </fieldset>
          </li>
        ))}
      </ol>
      <Button
        type="button"
        variant="secondary"
        className="self-start"
        disabled={lines.length >= MAX_LINES}
        onClick={() => setLines((current) => [...current, emptyLine(nextKey.current++)])}
      >
        Añadir concepto
      </Button>

      <dl
        aria-live="polite"
        className="grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 self-end text-sm"
      >
        <dt className="text-fg-muted">Base imponible</dt>
        <dd className="text-right">{formatEuros(totals.subtotal)}</dd>
        <dt className="text-fg-muted">IVA</dt>
        <dd className="text-right">{formatEuros(totals.vatAmount)}</dd>
        {totals.irpfAmount > 0 && (
          <>
            <dt className="text-fg-muted">Retención IRPF</dt>
            <dd className="text-right">-{formatEuros(totals.irpfAmount)}</dd>
          </>
        )}
        <dt className="font-semibold">Total</dt>
        <dd className="text-right font-semibold">{formatEuros(totals.total)}</dd>
      </dl>
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
