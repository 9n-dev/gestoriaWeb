import type { DocumentExtractor, Extraction } from './types';

const number = (text: string | undefined) =>
  text === undefined ? null : Number(text.replace(/\./g, '').replace(',', '.'));

/**
 * "Base imponible: x / IVA 21 %: y" for one rate; "Base imponible al 10 %: x / IVA 10 %: y" per rate
 * for several. Totals are the sums; the main rate is the one with the largest base.
 */
function amounts(
  text: string,
): Pick<Extraction, 'taxBase' | 'vatRate' | 'vatAmount' | 'vatBreakdown'> {
  const lines = [...text.matchAll(/Base imponible al ([\d.,]+)\s*%:\s*([\d.,]+)/g)].map((m) => {
    const rate = number(m[1])!;
    const vat = number(new RegExp(`IVA ${m[1]}\\s*%:\\s*([\\d.,]+)`).exec(text)?.[1]) ?? 0;
    return { rate, base: number(m[2])!, vat };
  });
  if (lines.length === 0) {
    const single = /Base imponible:\s*([\d.,]+)/.exec(text)?.[1];
    return {
      taxBase: number(single),
      vatRate: number(/IVA\s+([\d.,]+)\s*%/.exec(text)?.[1]),
      vatAmount: number(/IVA\s+[\d.,]+\s*%:\s*([\d.,]+)/.exec(text)?.[1]),
      vatBreakdown: null,
    };
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  const main = [...lines].sort((a, b) => b.base - a.base)[0]!;
  return {
    taxBase: round(lines.reduce((sum, line) => sum + line.base, 0)),
    vatRate: main.rate,
    vatAmount: round(lines.reduce((sum, line) => sum + line.vat, 0)),
    vatBreakdown: lines.length > 1 ? lines : null,
  };
}

/**
 * Development extractor: no network, no key. It reads the text of text-based PDFs (such as the
 * synthetic invoices of the seed and of `fixtures/`) and looks for Spanish invoice labels.
 * Photos and scanned PDFs have no text layer, so they come back empty and are processed by hand.
 */
export const fakeExtractor: DocumentExtractor = {
  async extract({ bytes, mimeType }) {
    const usage = { provider: 'fake', model: 'label-parser', inputTokens: 0, outputTokens: 0 };
    if (mimeType !== 'application/pdf')
      return { extraction: null, raw: { reason: 'no text layer' }, usage };

    const text = [
      ...Buffer.from(bytes)
        .toString('latin1')
        .matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g),
    ]
      .map((match) => match[1]!.replace(/\\([\\()])/g, '$1'))
      .join('\n');
    const find = (pattern: RegExp) => pattern.exec(text)?.[1]?.trim();
    const date = /Fecha:\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(text);

    const extraction: Extraction = {
      supplierName: find(/Emisor:\s*(.+)/) ?? null,
      supplierTaxId: find(/NIF:\s*([A-Z0-9]+)/) ?? null,
      invoiceNumber: find(/N[úu]mero:\s*(.+)/) ?? null,
      date: date ? `${date[3]}-${date[2]}-${date[1]}` : null,
      ...amounts(text),
      total: number(find(/TOTAL:\s*([\d.,]+)/)),
      currency: 'EUR',
      confidence: 0,
    };
    const found =
      Object.entries(extraction).filter(([key, value]) => value !== null && key !== 'vatBreakdown')
        .length - 2; // minus currency, confidence
    extraction.confidence = Math.round((found / 8) * 100) / 100;
    return { extraction: found >= 3 ? extraction : null, raw: { text }, usage };
  },
};
