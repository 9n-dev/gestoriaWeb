import { describe, expect, it } from 'vitest';
import { makePdf, PdfDocument, textWidth, wrapText } from './pdf';

const text = (pdf: Uint8Array) => Buffer.from(pdf).toString('latin1');

describe('pdf writer', () => {
  it('measures ASCII exactly with the Helvetica metrics, so right-aligned amounts line up', () => {
    expect(textWidth('1.234,56', 10)).toBeCloseTo((556 * 6 + 278 * 2) / 100, 5);
    expect(textWidth('TOTAL', 12, 'bold')).toBeCloseTo(
      ((611 + 778 + 611 + 722 + 611) * 12) / 1000,
      5,
    );
    // Accents cost what the base letter costs.
    expect(textWidth('Núñez', 10)).toBeCloseTo(textWidth('Nunez', 10), 5);
  });

  it('writes the euro sign and typographic dashes in WinAnsi instead of "?"', () => {
    const page = new PdfDocument();
    page.addPage().text(10, 10, '120,00 € — (pagado)');
    const out = text(page.build());
    expect(out).toContain('120,00 \x80 \x97 \\(pagado\\)');
    expect(out).not.toContain('?');
  });

  it('wraps on words and keeps an over-long word whole', () => {
    expect(wrapText('uno dos tres cuatro', textWidth('uno dos', 10) + 1, 10)).toEqual([
      'uno dos',
      'tres',
      'cuatro',
    ]);
    expect(wrapText('Supercalifragilístico', 10, 10)).toEqual(['Supercalifragilístico']);
  });

  it('builds a valid multi-page file: page tree, xref offsets and one stream per page', () => {
    const out = text(makePdf(Array.from({ length: 100 }, (_, i) => `Línea ${i}`)));
    expect(out).toContain('/Count 3');
    expect(out.match(/\/Type \/Page /g)).toHaveLength(3);
    const xref = Number(/startxref\n(\d+)/.exec(out)![1]);
    expect(out.slice(xref, xref + 4)).toBe('xref');
    // Every xref entry points at the object it says.
    [...out.matchAll(/^(\d{10}) 00000 n /gm)].forEach(([, offset], index) =>
      expect(out.slice(Number(offset)).startsWith(`${index + 1} 0 obj`)).toBe(true),
    );
  });
});
