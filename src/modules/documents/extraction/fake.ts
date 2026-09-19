import type { DocumentExtractor, Extraction } from './types';

const number = (text: string | undefined) =>
  text === undefined ? null : Number(text.replace(/\./g, '').replace(',', '.'));

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
      taxBase: number(find(/Base imponible:\s*([\d.,]+)/)),
      vatRate: number(find(/IVA\s+([\d.,]+)\s*%/)),
      vatAmount: number(find(/IVA\s+[\d.,]+\s*%:\s*([\d.,]+)/)),
      total: number(find(/TOTAL:\s*([\d.,]+)/)),
      currency: 'EUR',
      confidence: 0,
    };
    const found = Object.values(extraction).filter((value) => value !== null).length - 2; // minus currency, confidence
    extraction.confidence = Math.round((found / 8) * 100) / 100;
    return { extraction: found >= 3 ? extraction : null, raw: { text }, usage };
  },
};
