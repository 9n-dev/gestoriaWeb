import { makePdf } from '@/lib/pdf';
import { formatEuros } from '@/lib/money';
import type { InvoiceTotals } from './totals';

export type Party = { name: string; taxId: string; address: string };
export type InvoicePdfInput = {
  fullNumber: string;
  issueDate: string;
  dueDate: string;
  rectifies?: string | null;
  issuer: Party;
  recipient: Party;
  totals: InvoiceTotals;
  paymentMethod: string;
  qrData: string;
  hash: string;
};

const date = (iso: string) => iso.split('-').reverse().join('/');

/**
 * Invoice with the content Spanish law requires (RD 1619/2012 art. 6): number and series, dates,
 * both parties with NIF and address, description, base, rate and VAT per rate, withholding, total.
 * Plain text layout for now (lib/pdf); a designed template is tech debt, the content is complete.
 */
export function invoicePdf(input: InvoicePdfInput): Uint8Array {
  const { totals } = input;
  return makePdf([
    input.rectifies ? `FACTURA RECTIFICATIVA ${input.fullNumber}` : `FACTURA ${input.fullNumber}`,
    ...(input.rectifies ? [`Rectifica la factura ${input.rectifies}`] : []),
    `Fecha de expedición: ${date(input.issueDate)}    Vencimiento: ${date(input.dueDate)}`,
    '',
    `EMISOR: ${input.issuer.name} · NIF ${input.issuer.taxId}`,
    input.issuer.address,
    '',
    `CLIENTE: ${input.recipient.name} · NIF ${input.recipient.taxId}`,
    input.recipient.address,
    '',
    'CONCEPTOS',
    ...totals.lines.map(
      (line) =>
        `${line.description.slice(0, 48)}  ${line.quantity} x ${formatEuros(line.unitPrice)} = ${formatEuros(line.amount)}`,
    ),
    '',
    ...totals.vatBreakdown.map(
      (row) =>
        `Base imponible ${formatEuros(row.base)} · IVA ${row.rate} %: ${formatEuros(row.vat)}`,
    ),
    ...(totals.irpfAmount ? [`Retención IRPF: -${formatEuros(totals.irpfAmount)}`] : []),
    `TOTAL: ${formatEuros(totals.total)}`,
    '',
    `Forma de pago: ${input.paymentMethod}`,
    '',
    `Huella: ${input.hash.slice(0, 32)}`,
    input.hash.slice(32),
    'Verificación:',
    ...(input.qrData.match(/.{1,86}/g) ?? []),
  ]);
}
