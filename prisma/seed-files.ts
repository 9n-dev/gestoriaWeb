/**
 * Synthetic files for the demo (§7: no real data). A minimal, valid one-page PDF built by hand,
 * so the seed needs no PDF library.
 */
export function makePdf(lines: string[]): Uint8Array {
  const escape = (text: string) =>
    // Standard PDF fonts are Latin-1: accents survive, anything else becomes "?".
    [...text]
      .map((char) => (char.charCodeAt(0) > 255 ? '?' : char))
      .join('')
      .replace(/[\\()]/g, '\\$&');
  const content = [
    'BT',
    '/F1 12 Tf',
    '72 770 Td',
    '16 TL',
    ...lines.map((line) => `(${escape(line)}) Tj T*`),
    'ET',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, index) => {
    const offset = Buffer.byteLength(pdf, 'latin1');
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

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
