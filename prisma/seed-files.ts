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
};

export const invoiceTotals = (invoice: DemoInvoice) => {
  const vatAmount = Math.round(invoice.taxBase * invoice.vatRate) / 100;
  return { vatAmount, total: Math.round((invoice.taxBase + vatAmount) * 100) / 100 };
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
    `Base imponible: ${euros(invoice.taxBase)}`,
    `IVA ${invoice.vatRate} %: ${euros(vatAmount)}`,
    `TOTAL: ${euros(total)}`,
  ]);
}
