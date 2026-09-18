import { describe, expect, it } from 'vitest';
import { csvCell, parseCsv, toCsv } from './csv';

describe('parseCsv', () => {
  it('detects ; and , separators', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles quotes, escaped quotes, separators and line breaks inside quotes', () => {
    expect(parseCsv('nombre;nota\n"Pérez; S.L.";"dijo ""hola""\nadiós"')).toEqual([
      ['nombre', 'nota'],
      ['Pérez; S.L.', 'dijo "hola"\nadiós'],
    ]);
  });

  it('strips the BOM, accepts CRLF and skips blank lines', () => {
    expect(parseCsv('﻿a;b\r\n1;2\r\n\r\n;\r\n3;4\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('keeps empty trailing cells', () => {
    expect(parseCsv('a;b;c\n1;;')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', ''],
    ]);
  });
});

describe('toCsv', () => {
  it('round-trips through parseCsv', () => {
    const rows = [
      ['nombre', 'nota'],
      ['Pérez; S.L.', 'dijo "hola"\nadiós'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('neutralizes formulas', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toMatch(/^"'=/);
    expect(csvCell('+34 600')).toBe("'+34 600");
  });
});
