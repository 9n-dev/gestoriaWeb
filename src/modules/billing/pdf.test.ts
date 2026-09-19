import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { invoicePdf, type InvoicePdfInput } from './pdf';
import { computeTotals } from './totals';

const base: Omit<InvoicePdfInput, 'totals' | 'fullNumber'> = {
  issueDate: '2026-09-19',
  dueDate: '2026-10-04',
  issuer: {
    name: 'Gestoría Pérez, S.L.',
    taxId: 'B12345674',
    address: 'Calle Mayor 12 28013 Madrid',
  },
  recipient: { name: 'Marta Ibáñez', taxId: '00000014Z', address: 'Avenida 45 41001 Sevilla' },
  paymentMethod: 'Transferencia',
  qrData: 'https://verifica.example/qr?nif=B12345674&num=A-2026-00012&importe=187.55',
  hash: 'a'.repeat(64),
  brandColor: '#ff0000',
};
const totals = computeTotals([
  { description: 'Cuota mensual', quantity: 1, unitPrice: 120, vatRate: 21, irpfRate: 15 },
  { description: 'Alta de trabajador', quantity: 2, unitPrice: 17.5, vatRate: 10, irpfRate: 0 },
]);
const render = (input: Partial<InvoicePdfInput> = {}) =>
  Buffer.from(invoicePdf({ ...base, fullNumber: 'A-2026-00012', totals, ...input })).toString(
    'latin1',
  );
const strings = (pdf: string) => [...pdf.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1]);

describe('invoice pdf', () => {
  it('carries everything RD 1619/2012 art. 6 asks for', () => {
    const shown = strings(render());
    for (const expected of [
      'FACTURA',
      'A-2026-00012',
      '19/09/2026',
      '04/10/2026',
      'Gestor\xeda P\xe9rez, S.L.',
      'NIF B12345674',
      'Calle Mayor 12 28013 Madrid',
      'Marta Ib\xe1\xf1ez',
      'NIF 00000014Z',
      'Avenida 45 41001 Sevilla',
      'Cuota mensual',
      'Alta de trabajador',
      'Base imponible \\(IVA 21 %\\)',
      'IVA 21 %',
      'Base imponible \\(IVA 10 %\\)',
      'IVA 10 %',
      'Retenci\xf3n IRPF 15 %',
      '-18,00\xa0\x80',
      'TOTAL',
      '165,70\xa0\x80',
      'Forma de pago: Transferencia',
    ]) {
      expect(shown, expected).toContain(expected);
    }
  });

  it('marks a rectifying invoice and names the one it corrects', () => {
    const shown = strings(render({ fullNumber: 'R-2026-00001', rectifies: 'A-2026-00007' }));
    expect(shown).toEqual(
      expect.arrayContaining(['FACTURA RECTIFICATIVA', 'Rectifica la factura', 'A-2026-00007']),
    );
  });

  it('draws the verification QR module for module, and uses the tenant colour', () => {
    const pdf = render();
    const { modules } = QRCode.create(base.qrData, { errorCorrectionLevel: 'M' });
    const cell = 68 / modules.size;
    // Black rectangles are the QR (nothing else on the page is pure black and filled).
    const drawn = new Set<string>();
    for (const [, x, y, width] of pdf.matchAll(
      /0\.000 0\.000 0\.000 rg ([\d.]+) ([\d.]+) ([\d.]+) [\d.]+ re f/g,
    )) {
      const col = Math.round((Number(x) - (595 - 48 - 68)) / cell);
      const top = 842 - Number(y) - cell; // PDF y is the bottom edge
      const firstRow = Math.round(top / cell);
      const runLength = Math.round(Number(width) / cell);
      for (let i = 0; i < runLength; i++) drawn.add(`${firstRow}:${col + i}`);
    }
    const rows = [...drawn].map((key) => Number(key.split(':')[0]));
    const origin = Math.min(...rows);
    let dark = 0;
    for (let row = 0; row < modules.size; row++) {
      for (let col = 0; col < modules.size; col++) {
        if (modules.get(row, col)) dark++;
        expect(drawn.has(`${row + origin}:${col}`), `${row}:${col}`).toBe(
          Boolean(modules.get(row, col)),
        );
      }
    }
    expect(drawn.size).toBe(dark);
    expect(pdf).toContain('1.000 0.000 0.000 rg'); // brandColor #ff0000
  });

  it('flows 50 lines over several pages, repeating the table header and numbering the pages', () => {
    const many = computeTotals(
      Array.from({ length: 50 }, (_, i) => ({
        description: `Servicio ${i + 1}`,
        quantity: 1,
        unitPrice: 10,
        vatRate: 21,
        irpfRate: 0,
      })),
    );
    const pdf = render({ totals: many });
    const shown = strings(pdf);
    const pages = pdf.match(/\/Type \/Page /g)!.length;
    expect(pages).toBeGreaterThan(1);
    // Every page with rows repeats the header; a last page may hold only the totals.
    const headers = shown.filter((s) => s === 'CONCEPTO').length;
    expect(headers).toBeGreaterThanOrEqual(2);
    expect(headers).toBeLessThanOrEqual(pages);
    expect(shown).toContain(`A-2026-00012 \xb7 P\xe1gina ${pages} de ${pages}`);
    expect(shown.filter((s) => /^Servicio \d+$/.test(s!))).toHaveLength(50);
    expect(shown.filter((s) => s === 'TOTAL')).toHaveLength(1);
  });
});
