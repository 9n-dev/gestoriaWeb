/**
 * Small PDF writer: A4 pages, the two standard Helvetica fonts, text (left, right or centred),
 * filled rectangles and lines, in a top-left coordinate system. Enough to lay out invoices and
 * certificates without a PDF library (ADR 0034). No images, no compression, no custom fonts.
 */
export const PAGE = { width: 595, height: 842 } as const;

export type PdfFont = 'regular' | 'bold';
export type TextOptions = {
  size?: number;
  font?: PdfFont;
  /** `#rrggbb` */
  color?: string;
  align?: 'left' | 'right' | 'center';
};

/** Characters of WinAnsiEncoding that live outside Latin-1 in Unicode. */
const WIN_ANSI: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  '„': 0x84,
  '…': 0x85,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '™': 0x99,
};

// Intl puts these between the amount and the € sign. Spelled by code: they are invisible in source.
const NBSP = String.fromCharCode(0xa0);
const NARROW_NBSP = String.fromCharCode(0x202f);

/** Unicode → WinAnsi bytes as a Latin-1 string, escaped for a PDF literal. Unknown characters become "?". */
function encode(text: string): string {
  return [...text]
    .map((char) => {
      const code = WIN_ANSI[char] ?? char.charCodeAt(0);
      // Narrow no-break space (Intl uses it in some locales) has no glyph: a plain NBSP does.
      if (char === NARROW_NBSP) return NBSP;
      return code > 255 ? '?' : String.fromCharCode(code);
    })
    .join('')
    .replace(/[\\()]/g, '\\$&');
}

// Helvetica advance widths (1/1000 em) for ASCII 32–126, from the Adobe core font metrics.
const REGULAR =
  '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584';
const BOLD =
  '278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584';
const WIDTHS: Record<PdfFont, number[]> = {
  regular: REGULAR.split(' ').map(Number),
  bold: BOLD.split(' ').map(Number),
};

function charWidth(char: string, font: PdfFont): number {
  const table = WIDTHS[font];
  const ascii = char.charCodeAt(0) - 32;
  if (ascii >= 0 && ascii < table.length) return table[ascii]!;
  if (char === NBSP || char === NARROW_NBSP) return table[0]!;
  if (char === '€') return 556;
  // Accented letters are as wide as their base letter; an accented "i" sits on the dotless one.
  const base = char.normalize('NFD').charAt(0);
  if (base === 'i' || base === 'ı') return 278;
  const index = base.charCodeAt(0) - 32;
  return index >= 0 && index < table.length && base !== char ? table[index]! : 556;
}

/** Width in points. Exact for ASCII (so right-aligned amounts line up), close enough for the rest. */
export const textWidth = (text: string, size: number, font: PdfFont = 'regular'): number =>
  ([...text].reduce((sum, char) => sum + charWidth(char, font), 0) * size) / 1000;

/** Greedy word wrap to a width in points. A single word longer than the line is kept whole. */
export function wrapText(text: string, maxWidth: number, size: number, font: PdfFont = 'regular') {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && textWidth(candidate, size, font) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

const rgb = (hex: string): string => {
  const value = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? '000000';
  return [0, 2, 4].map((i) => (parseInt(value.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
};

const n = (value: number) => value.toFixed(2);

export class PdfPage {
  readonly ops: string[] = [];

  /** `y` is the baseline, measured from the top of the page. */
  text(x: number, y: number, text: string, options: TextOptions = {}): this {
    const { size = 10, font = 'regular', color = '#000000', align = 'left' } = options;
    const width = align === 'left' ? 0 : textWidth(text, size, font);
    const left = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x;
    this.ops.push(
      `BT /${font === 'bold' ? 'F2' : 'F1'} ${size} Tf ${rgb(color)} rg ${n(left)} ${n(PAGE.height - y)} Td (${encode(text)}) Tj ET`,
    );
    return this;
  }

  /** Filled rectangle; `y` is its top edge. */
  rect(x: number, y: number, width: number, height: number, color: string): this {
    this.ops.push(
      `${rgb(color)} rg ${n(x)} ${n(PAGE.height - y - height)} ${n(width)} ${n(height)} re f`,
    );
    return this;
  }

  line(x1: number, y1: number, x2: number, y2: number, color = '#000000', width = 0.5): this {
    this.ops.push(
      `${rgb(color)} RG ${width} w ${n(x1)} ${n(PAGE.height - y1)} m ${n(x2)} ${n(PAGE.height - y2)} l S`,
    );
    return this;
  }
}

export class PdfDocument {
  private readonly pages: PdfPage[] = [];

  addPage(): PdfPage {
    const page = new PdfPage();
    this.pages.push(page);
    return page;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  build(): Uint8Array {
    const font = (name: string) =>
      `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`;
    // 1 catalog, 2 page tree, 3–4 fonts, then a page object and its content stream per page.
    const pageIds = this.pages.map((_, index) => 5 + index * 2);
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${this.pages.length} >>`,
      font('Helvetica'),
      font('Helvetica-Bold'),
      ...this.pages.flatMap((page, index) => {
        const content = page.ops.join('\n');
        return [
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Contents ${pageIds[index]! + 1} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`,
          `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
        ];
      }),
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
}

/** Plain lines of text, 12 pt, new page when one fills up: certificates and synthetic demo documents. */
export function makePdf(lines: string[]): Uint8Array {
  const document = new PdfDocument();
  const PER_PAGE = 44;
  for (let start = 0; start < Math.max(lines.length, 1); start += PER_PAGE) {
    const page = document.addPage();
    lines
      .slice(start, start + PER_PAGE)
      .forEach((line, index) => page.text(72, 72 + index * 16, line, { size: 12 }));
  }
  return document.build();
}
