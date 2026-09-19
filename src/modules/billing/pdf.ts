import QRCode from 'qrcode';
import { formatEuros } from '@/lib/money';
import { PAGE, PdfDocument, wrapText, type PdfPage } from '@/lib/pdf';
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
  /** Tenant's primary colour (white label). Falls back to the platform blue. */
  brandColor?: string | null;
};

const MARGIN = 48;
const RIGHT = PAGE.width - MARGIN;
const MUTED = '#52525b';
const RULE = '#d4d4d8';
const BAND = '#f4f4f5';
const ROW_BOTTOM = 770; // rows never go below this; the footer lives under it
const COLUMNS = { quantity: 360, unitPrice: 450, amount: RIGHT };

const date = (iso: string) => iso.split('-').reverse().join('/');
const quantity = (value: number) => value.toLocaleString('es-ES', { maximumFractionDigits: 2 });

/** The QR as vector squares (runs of dark modules merged per row): sharp at any zoom, no image. */
function drawQr(page: PdfPage, data: string, x: number, y: number, side: number): void {
  const { modules } = QRCode.create(data, { errorCorrectionLevel: 'M' });
  const cell = side / modules.size;
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (!modules.get(row, col)) continue;
      let run = 1;
      while (col + run < modules.size && modules.get(row, col + run)) run++;
      // A hair of overlap hides the seams some viewers draw between adjacent rectangles.
      page.rect(x + col * cell, y + row * cell, run * cell + 0.05, cell + 0.05, '#000000');
      col += run - 1;
    }
  }
}

function party(page: PdfPage, x: number, y: number, width: number, who: Party): number {
  let cursor = y;
  for (const line of wrapText(who.name, width, 11, 'bold')) {
    page.text(x, cursor, line, { size: 11, font: 'bold' });
    cursor += 14;
  }
  page.text(x, cursor, `NIF ${who.taxId}`, { size: 9, color: MUTED });
  cursor += 12;
  for (const line of wrapText(who.address, width, 9)) {
    page.text(x, cursor, line, { size: 9, color: MUTED });
    cursor += 12;
  }
  return cursor;
}

function tableHeader(page: PdfPage, y: number): number {
  page.rect(MARGIN, y, RIGHT - MARGIN, 20, BAND);
  const label = { size: 8, font: 'bold', color: MUTED } as const;
  page.text(MARGIN + 8, y + 13, 'CONCEPTO', label);
  page.text(COLUMNS.quantity, y + 13, 'CANTIDAD', { ...label, align: 'right' });
  page.text(COLUMNS.unitPrice, y + 13, 'PRECIO', { ...label, align: 'right' });
  page.text(COLUMNS.amount - 8, y + 13, 'IMPORTE', { ...label, align: 'right' });
  return y + 20;
}

/**
 * Invoice with the content Spanish law requires (RD 1619/2012 art. 6): number and series, dates,
 * both parties with NIF and address, description, base, rate and VAT per rate, withholding, total.
 * Carries the tenant's colour, the verification QR as a real code and the chained hash; long
 * invoices flow onto more pages with the table header repeated.
 */
export function invoicePdf(input: InvoicePdfInput): Uint8Array {
  const { totals } = input;
  const brand = input.brandColor ?? '#1d4ed8';
  const document = new PdfDocument();
  const pages: PdfPage[] = [];
  const newPage = () => {
    const page = document.addPage();
    page.rect(0, 0, PAGE.width, 8, brand);
    pages.push(page);
    return page;
  };

  // ── Header: who issues, what this is ──
  let page = newPage();
  const issuerBottom = party(page, MARGIN, 56, 250, input.issuer);
  page.text(RIGHT, 60, input.rectifies ? 'FACTURA RECTIFICATIVA' : 'FACTURA', {
    size: input.rectifies ? 15 : 20,
    font: 'bold',
    color: brand,
    align: 'right',
  });
  page.text(RIGHT, 78, input.fullNumber, { size: 12, font: 'bold', align: 'right' });
  const facts = [
    ...(input.rectifies ? [['Rectifica la factura', input.rectifies]] : []),
    ['Fecha de expedición', date(input.issueDate)],
    ['Vencimiento', date(input.dueDate)],
  ];
  facts.forEach(([label, value], index) => {
    page.text(RIGHT - 70, 96 + index * 13, label!, { size: 9, color: MUTED, align: 'right' });
    page.text(RIGHT, 96 + index * 13, value!, { size: 9, align: 'right' });
  });

  // ── Recipient on the left, verification code on the right ──
  const blockTop = Math.max(issuerBottom, 96 + facts.length * 13) + 24;
  page.text(MARGIN, blockTop, 'FACTURAR A', { size: 8, font: 'bold', color: MUTED });
  const recipientBottom = party(page, MARGIN, blockTop + 16, 300, input.recipient);
  const QR_SIDE = 68;
  drawQr(page, input.qrData, RIGHT - QR_SIDE, blockTop - 6, QR_SIDE);
  page.text(RIGHT - QR_SIDE - 10, blockTop + 4, 'Código de verificación', {
    size: 8,
    font: 'bold',
    color: MUTED,
    align: 'right',
  });
  ['Huella de la factura:', input.hash.slice(0, 32), input.hash.slice(32)].forEach((line, index) =>
    page.text(RIGHT - QR_SIDE - 10, blockTop + 18 + index * 10, line, {
      size: 7,
      color: MUTED,
      align: 'right',
    }),
  );

  // ── Lines ──
  let y = tableHeader(page, Math.max(recipientBottom, blockTop + QR_SIDE) + 20);
  for (const line of totals.lines) {
    const description = wrapText(line.description, COLUMNS.quantity - 70 - MARGIN, 10);
    const height = Math.max(description.length, 1) * 13 + 9;
    if (y + height > ROW_BOTTOM) {
      page = newPage();
      y = tableHeader(page, 40);
    }
    description.forEach((text, index) => page.text(MARGIN + 8, y + 15 + index * 13, text));
    page.text(COLUMNS.quantity, y + 15, quantity(line.quantity), { align: 'right' });
    page.text(COLUMNS.unitPrice, y + 15, formatEuros(line.unitPrice), { align: 'right' });
    page.text(COLUMNS.amount - 8, y + 15, formatEuros(line.amount), { align: 'right' });
    y += height;
    page.line(MARGIN, y, RIGHT, y, RULE);
  }

  const irpfRates = [...new Set(totals.lines.map((line) => line.irpfRate).filter(Boolean))];

  // ── Totals: kept together, on a new page if they do not fit ──
  const rows: Array<[string, string]> = [
    ...totals.vatBreakdown.flatMap((row): Array<[string, string]> => [
      [`Base imponible (IVA ${quantity(row.rate)} %)`, formatEuros(row.base)],
      [`IVA ${quantity(row.rate)} %`, formatEuros(row.vat)],
    ]),
    ...(totals.irpfAmount
      ? [
          [
            `Retención IRPF${irpfRates.length === 1 ? ` ${quantity(irpfRates[0]!)} %` : ''}`,
            `-${formatEuros(totals.irpfAmount)}`,
          ] as [string, string],
        ]
      : []),
  ];
  if (y + rows.length * 16 + 90 > ROW_BOTTOM) {
    page = newPage();
    y = 40;
  }
  y += 22;
  for (const [label, value] of rows) {
    page.text(COLUMNS.unitPrice, y, label, { color: MUTED, align: 'right' });
    page.text(COLUMNS.amount - 8, y, value, { align: 'right' });
    y += 16;
  }
  page.line(COLUMNS.quantity - 40, y - 4, RIGHT, y - 4, RULE);
  page.text(COLUMNS.unitPrice, y + 16, 'TOTAL', { size: 12, font: 'bold', align: 'right' });
  page.text(COLUMNS.amount - 8, y + 16, formatEuros(totals.total), {
    size: 13,
    font: 'bold',
    color: brand,
    align: 'right',
  });
  page.text(MARGIN, y + 16, `Forma de pago: ${input.paymentMethod}`, { size: 9, color: MUTED });
  page.text(MARGIN, y + 29, `Vencimiento: ${date(input.dueDate)}`, { size: 9, color: MUTED });

  // ── Footer on every page ──
  pages.forEach((each, index) => {
    each.line(MARGIN, 800, RIGHT, 800, RULE);
    each.text(MARGIN, 814, `${input.issuer.name} · NIF ${input.issuer.taxId}`, {
      size: 8,
      color: MUTED,
    });
    each.text(RIGHT, 814, `${input.fullNumber} · Página ${index + 1} de ${pages.length}`, {
      size: 8,
      color: MUTED,
      align: 'right',
    });
  });

  return document.build();
}
