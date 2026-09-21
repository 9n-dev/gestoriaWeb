import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { xlsx } from './xlsx';
import { readXlsx } from './xlsx-read';
import { zip } from './zip';

describe('xlsx reader', () => {
  it('reads a workbook written by LibreOffice: shared strings, accents, quotes, text-formatted codes', () => {
    const rows = readXlsx(
      new Uint8Array(readFileSync('fixtures/import/clientes-libreoffice.xlsx')),
    );
    expect(rows).toEqual([
      ['razon_social', 'nif', 'email', 'telefono', 'direccion', 'cp', 'ciudad'],
      [
        'Panadería Ñandú & Hijos, S.L.',
        'B12345674',
        'hola@nandu.test',
        '600111222',
        'C/ Mayor 1',
        '08001',
        'Barcelona',
      ],
      ['Marta "la del bar" Soler', '00000014Z'],
    ]);
  });

  it('round-trips our own writer: inline strings, numbers, empty cells in the middle, empty rows dropped', () => {
    const rows = readXlsx(
      xlsx('Hoja', [
        ['nombre', 'importe', 'nota'],
        ['A & B <S.L.>', 1234.5, null],
        [null, null, null],
        ['Último', null, 'con hueco'],
      ]),
    );
    expect(rows).toEqual([
      ['nombre', 'importe', 'nota'],
      ['A & B <S.L.>', '1234.5'],
      ['Último', '', 'con hueco'],
    ]);
  });

  it('refuses what is not a spreadsheet, and zip bombs', () => {
    expect(() => readXlsx(new Uint8Array([1, 2, 3]))).toThrow();
    expect(() => readXlsx(zip([{ path: 'hola.txt', data: 'hola' }]))).toThrow('no worksheet');
    const bomb = zip([
      { path: 'xl/worksheets/sheet1.xml', data: new Uint8Array(21 * 1024 * 1024) },
    ]);
    expect(bomb.byteLength).toBeLessThan(100_000);
    expect(() => readXlsx(bomb)).toThrow();
  });
});
