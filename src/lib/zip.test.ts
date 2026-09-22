import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { unzipForTests } from '@tests/setup/unzip';
import { xlsx } from './xlsx';
import { zip } from './zip';

describe('zip', () => {
  it('round-trips files with UTF-8 names and content', () => {
    const files = unzipForTests(
      zip([
        { path: 'clientes/año 2026.csv', data: 'razón;importe\nPérez;1,5' },
        { path: 'vacío.txt', data: '' },
      ]),
    );
    expect(files).toEqual({ 'clientes/año 2026.csv': 'razón;importe\nPérez;1,5', 'vacío.txt': '' });
  });

  it('is accepted by a real unzip tool when one is installed', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'zip-')), 'test.zip');
    writeFileSync(path, zip([{ path: 'hola.txt', data: 'hola' }]));
    try {
      expect(execFileSync('unzip', ['-t', path]).toString()).toContain('No errors detected');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  });
});

describe('xlsx', () => {
  it('writes strings inline and numbers as numbers, escaping XML', () => {
    const files = unzipForTests(
      xlsx('Facturas 3T', [
        ['proveedor', 'total'],
        ['Pérez & Hijos <SL>', 1210.5],
        [null, 0],
      ]),
    );
    const sheet = files['xl/worksheets/sheet1.xml']!;
    expect(sheet).toContain(
      '<c r="A2" t="inlineStr"><is><t xml:space="preserve">Pérez &amp; Hijos &lt;SL&gt;</t></is></c>',
    );
    expect(sheet).toContain('<c r="B2"><v>1210.5</v></c>');
    expect(sheet).toContain('<c r="B3"><v>0</v></c>');
    expect(files['xl/workbook.xml']).toContain('name="Facturas 3T"');
    expect(Object.keys(files)).toContain('[Content_Types].xml');
  });
});

describe('ZipStream', () => {
  it('produces byte for byte the archive `zip` builds, one entry at a time', async () => {
    const { ZipStream, zip } = await import('./zip');
    const entries = [
      { path: 'datos/clientes.csv', data: 'id;nombre\n1;Ñandú' },
      { path: 'archivos/a.bin', data: new Uint8Array(70_000).map((_, i) => i % 251) },
    ];
    const chunks: Uint8Array[] = [];
    const stream = new ZipStream(async (chunk) => void chunks.push(chunk));
    for (const entry of entries) await stream.add(entry.path, entry.data);
    await stream.finish();
    expect(Buffer.concat(chunks).equals(Buffer.from(zip(entries)))).toBe(true);
    expect(chunks).toHaveLength(entries.length + 1); // one chunk per entry, one for the directory
  });
});
