import { makePdf } from '../src/lib/pdf';

export { makePdf };

/**
 * Synthetic files for the demo (§7: no real data). A minimal, valid one-page PDF built by hand,
 * so the seed needs no PDF library.
 */
export type DemoInvoice = {
  supplierName: string;
  supplierTaxId: string;
  invoiceNumber: string;
  invoiceDate: string;
  taxBase: number;
  vatRate: number;
  /** A second rate on the same document (a restaurant bill): base and rate of the other part. */
  alsoAt?: { rate: number; taxBase: number };
};

const round = (value: number) => Math.round(value * 100) / 100;
export const vatLines = (invoice: DemoInvoice) =>
  [
    { rate: invoice.vatRate, base: invoice.taxBase },
    ...(invoice.alsoAt ? [{ rate: invoice.alsoAt.rate, base: invoice.alsoAt.taxBase }] : []),
  ].map((line) => ({ ...line, vat: round((line.base * line.rate) / 100) }));
export const invoiceTotals = (invoice: DemoInvoice) => {
  const lines = vatLines(invoice);
  const taxBase = round(lines.reduce((sum, line) => sum + line.base, 0));
  const vatAmount = round(lines.reduce((sum, line) => sum + line.vat, 0));
  return { taxBase, vatAmount, total: round(taxBase + vatAmount) };
};

const euros = (value: number) => `${value.toFixed(2).replace('.', ',')} EUR`;

export function invoicePdf(invoice: DemoInvoice, customer: string): Uint8Array {
  const { vatAmount, total } = invoiceTotals(invoice);
  return makePdf([
    'FACTURA (documento de demostración, sin validez)',
    '',
    `Emisor: ${invoice.supplierName}`,
    `NIF: ${invoice.supplierTaxId}`,
    `Cliente: ${customer}`,
    '',
    `Número: ${invoice.invoiceNumber}`,
    `Fecha: ${invoice.invoiceDate.split('-').reverse().join('/')}`,
    '',
    ...(invoice.alsoAt
      ? vatLines(invoice).flatMap((line) => [
          `Base imponible al ${line.rate} %: ${euros(line.base)}`,
          `IVA ${line.rate} %: ${euros(line.vat)}`,
        ])
      : [
          `Base imponible: ${euros(invoice.taxBase)}`,
          `IVA ${invoice.vatRate} %: ${euros(vatAmount)}`,
        ]),
    `TOTAL: ${euros(total)}`,
  ]);
}
