/**
 * Minimal RFC 4180 reader: quoted fields, escaped quotes, line breaks inside quotes, CRLF/LF,
 * UTF-8 BOM. The separator (";" — what Spanish Excel writes — or ",") is detected from the header.
 */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, '');
  const header = input.slice(0, input.search(/\r?\n|$/));
  const separator = header.split(';').length >= header.split(',').length ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === separator) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field !== '' || row.length > 0) rows.push([...row, field]);

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

/** Quotes a value when needed, and neutralizes spreadsheet formulas (CSV injection). */
export function csvCell(value: string, separator = ';'): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return safe.includes('"') || safe.includes(separator) || /[\r\n]/.test(safe)
    ? `"${safe.replace(/"/g, '""')}"`
    : safe;
}

export const toCsv = (rows: string[][], separator = ';'): string =>
  '﻿' +
  rows.map((row) => row.map((cell) => csvCell(cell, separator)).join(separator)).join('\r\n') +
  '\r\n';
