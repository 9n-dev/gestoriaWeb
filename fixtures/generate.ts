/**
 * Regenerates the synthetic invoices used by the extraction acceptance test (§6.4) and their
 * expected values: `npx tsx fixtures/generate.ts`. No real data: suppliers and tax ids are made up
 * (the tax ids do carry valid control characters).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { invoicePdf, invoiceTotals, type DemoInvoice } from '../prisma/seed-files';

const INVOICES: DemoInvoice[] = [
  {
    supplierName: 'Energía Levante, S.L.',
    supplierTaxId: 'B96000112',
    invoiceNumber: 'EL-2026-071842',
    invoiceDate: '2026-07-31',
    taxBase: 86.4,
    vatRate: 21,
  },
  {
    supplierName: 'Telecom Mediterráneo, S.L.',
    supplierTaxId: 'B96000229',
    invoiceNumber: 'TM-7731920',
    invoiceDate: '2026-07-28',
    taxBase: 41.32,
    vatRate: 21,
  },
  {
    supplierName: 'Papelería Ruzafa, S.L.',
    supplierTaxId: 'B96000336',
    invoiceNumber: '2026/1093',
    invoiceDate: '2026-09-10',
    taxBase: 58.6,
    vatRate: 21,
  },
  {
    supplierName: 'Imprenta Turia, S.L.',
    supplierTaxId: 'B96000443',
    invoiceNumber: 'F26-0418',
    invoiceDate: '2026-08-21',
    taxBase: 320,
    vatRate: 21,
  },
  {
    supplierName: 'Horno Sant Blai, S.L.',
    supplierTaxId: 'B46000345',
    invoiceNumber: 'A-000981',
    invoiceDate: '2026-06-02',
    taxBase: 18.5,
    vatRate: 4,
  },
  {
    supplierName: 'Restaurante La Lonja, S.L.',
    supplierTaxId: 'B96000559',
    invoiceNumber: 'T-44021',
    invoiceDate: '2026-05-17',
    taxBase: 72.73,
    vatRate: 10,
  },
  {
    supplierName: 'Seguros Albufera, S.A.',
    supplierTaxId: 'A96000666',
    invoiceNumber: 'POL-2026-5582',
    invoiceDate: '2026-01-15',
    taxBase: 412,
    vatRate: 0,
  },
  {
    supplierName: 'Coworking Benimaclet, S.L.',
    supplierTaxId: 'B96000773',
    invoiceNumber: 'CW-2026-09-017',
    invoiceDate: '2026-09-01',
    taxBase: 180,
    vatRate: 21,
  },
  {
    supplierName: 'Informática Cabanyal, S.L.',
    supplierTaxId: 'B96000880',
    invoiceNumber: 'INF/26/00231',
    invoiceDate: '2026-03-30',
    taxBase: 1249.17,
    vatRate: 21,
  },
  {
    supplierName: 'Transportes Saler, S.L.',
    supplierTaxId: 'B96000997',
    invoiceNumber: '000412',
    invoiceDate: '2026-12-29',
    taxBase: 2350.5,
    vatRate: 21,
  },
];

mkdirSync(new URL('./invoices/', import.meta.url), { recursive: true });
const expected = INVOICES.map((invoice, index) => {
  const file = `invoice-${String(index + 1).padStart(2, '0')}.pdf`;
  writeFileSync(
    new URL(`./invoices/${file}`, import.meta.url),
    invoicePdf(invoice, 'Marta Soler Vidal'),
  );
  return {
    file,
    date: invoice.invoiceDate,
    total: invoiceTotals(invoice).total,
    supplierTaxId: invoice.supplierTaxId,
    invoiceNumber: invoice.invoiceNumber,
  };
});
writeFileSync(
  new URL('./invoices/expected.json', import.meta.url),
  `${JSON.stringify(expected, null, 2)}\n`,
);
console.info(`${expected.length} invoices written to fixtures/invoices/`);
