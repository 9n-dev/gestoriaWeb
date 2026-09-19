import { zip } from './zip';

export type Cell = string | number | null;

/** XML 1.0 forbids control characters other than tab, line feed and carriage return. */
const printable = (text: string) =>
  [...text]
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 || code === 9 || code === 10 || code === 13;
    })
    .join('');

const escapeXml = (text: string) =>
  printable(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const column = (index: number): string =>
  index < 26
    ? String.fromCharCode(65 + index)
    : column(Math.floor(index / 26) - 1) + String.fromCharCode(65 + (index % 26));

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const TYPES = 'application/vnd.openxmlformats-officedocument.spreadsheetml';

/**
 * Minimal single-sheet XLSX writer: inline strings and numbers, bold header row. Numbers stay
 * numbers, so the accounting program (and Excel) can add them up whatever the locale.
 */
export function xlsx(sheetName: string, rows: Cell[][]): Uint8Array {
  const sheetRows = rows
    .map((cells, r) => {
      const style = r === 0 ? ' s="1"' : '';
      const xml = cells
        .map((cell, c) => {
          const ref = `${column(c)}${r + 1}`;
          if (cell === null || cell === '') return '';
          if (typeof cell === 'number') return `<c r="${ref}"${style}><v>${cell}</v></c>`;
          return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${xml}</row>`;
    })
    .join('');

  return zip([
    {
      path: '[Content_Types].xml',
      data: `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${TYPES}.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${TYPES}.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="${TYPES}.styles+xml"/></Types>`,
    },
    {
      path: '_rels/.rels',
      data: `${HEAD}<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      path: 'xl/workbook.xml',
      data: `${HEAD}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet name="${escapeXml(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      path: 'xl/_rels/workbook.xml.rels',
      data: `${HEAD}<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      path: 'xl/styles.xml',
      data: `${HEAD}<styleSheet xmlns="${MAIN}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`,
    },
    {
      path: 'xl/worksheets/sheet1.xml',
      data: `${HEAD}<worksheet xmlns="${MAIN}"><sheetData>${sheetRows}</sheetData></worksheet>`,
    },
  ]);
}
