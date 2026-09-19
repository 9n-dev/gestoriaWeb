import { beforeEach, describe, expect, it } from 'vitest';
import { parseCsv } from '@/lib/csv';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/modules/auth/permissions';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant } from '@tests/setup/factories';
import { sessionUserFor } from '@tests/setup/session';
import { unzipForTests } from '@tests/setup/unzip';
import { exportDocuments, saveExportFormat } from './export';

const Q3 = { year: 2026, type: 'QUARTER' as const, ordinal: 3 };
let n = 0;

describe('accounting export', () => {
  let tenantId: string;
  let admin: SessionUser;
  let manager: SessionUser;

  const addInvoice = async (clientId: string, data: Record<string, unknown>) => {
    const period = await prisma.period.upsert({
      where: { year_type_ordinal: Q3 },
      create: Q3,
      update: {},
    });
    const file = await prisma.storedFile.create({
      data: {
        tenantId,
        kind: 'DOCUMENT',
        status: 'CLEAN',
        storageKey: `e-${++n}`,
        originalName: `f${n}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1,
      },
    });
    await prisma.document.create({
      data: {
        tenantId,
        clientId,
        fileId: file.id,
        periodId: period.id,
        type: 'RECEIVED_INVOICE',
        status: 'BOOKED',
        supplierName: '=Proveedor, S.L.',
        supplierTaxId: 'B96000112',
        invoiceNumber: 'F-1',
        invoiceDate: new Date('2026-08-14'),
        taxBase: 1000,
        vatRate: 21,
        vatAmount: 210,
        total: 1210,
        ...data,
      },
    });
  };

  beforeEach(async () => {
    await resetDb();
    tenantId = (await createTenant()).id;
    admin = await sessionUserFor(tenantId, 'TENANT_ADMIN');
    manager = await sessionUserFor(tenantId, 'MANAGER');
    const mine = await createClient(tenantId, {
      legalName: 'Marta Soler',
      assignedManagerId: manager.id,
    });
    const theirs = await createClient(tenantId, { legalName: 'Turia SL' });
    await addInvoice(mine.id, {});
    await addInvoice(mine.id, { status: 'IN_REVIEW', invoiceNumber: 'F-2' });
    await addInvoice(theirs.id, { invoiceNumber: 'F-3' });
  });

  it('exports the booked documents of the period to CSV with Spanish decimals and safe cells', async () => {
    const result = await exportDocuments(admin, { period: Q3 });
    expect(result).toMatchObject({ fileName: 'documentos-2026-t3.csv', count: 2 });
    const rows = parseCsv(result.body as string);
    expect(rows[0]).toEqual([
      'Cliente',
      'Fecha',
      'Número',
      'Proveedor o cliente',
      'NIF',
      'Base imponible',
      '% IVA',
      'Cuota de IVA',
      'Total',
    ]);
    expect(rows[1]).toEqual([
      'Marta Soler',
      '2026-08-14',
      'F-1',
      "'=Proveedor, S.L.",
      'B96000112',
      '1000,00',
      '21,00',
      '210,00',
      '1210,00',
    ]);
  });

  it('honours the tenant format: columns, decimal point, unbooked documents', async () => {
    await saveExportFormat(admin, {
      columns: ['numero', 'total', 'estado'],
      decimalSeparator: '.',
      onlyBooked: false,
    });
    const rows = parseCsv((await exportDocuments(admin, { period: Q3 })).body as string);
    expect(rows[0]).toEqual(['Número', 'Total', 'Estado']);
    expect(rows.slice(1)).toEqual([
      ['F-1', '1210.00', 'Contabilizado'],
      ['F-2', '1210.00', 'En revisión'],
      ['F-3', '1210.00', 'Contabilizado'],
    ]);
    await expect(
      saveExportFormat(manager, { columns: ['total'], decimalSeparator: ',', onlyBooked: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      saveExportFormat(admin, { columns: [], decimalSeparator: ',', onlyBooked: true }),
    ).rejects.toThrow();
  });

  it('writes XLSX with numeric cells', async () => {
    const result = await exportDocuments(admin, { period: Q3, format: 'xlsx' });
    expect(result.fileName).toBe('documentos-2026-t3.xlsx');
    const sheet = unzipForTests(result.body as Uint8Array)['xl/worksheets/sheet1.xml']!;
    expect(sheet).toContain('<v>1210</v>');
    expect(sheet).toContain('Marta Soler');
  });

  it('managers export their assigned clients only; clients cannot export; other tenants get nothing', async () => {
    expect((await exportDocuments(manager, { period: Q3 })).count).toBe(1);
    const client = await sessionUserFor(tenantId, 'CLIENT_USER');
    await expect(exportDocuments(client, { period: Q3 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const outsider = await sessionUserFor((await createTenant()).id, 'TENANT_ADMIN');
    expect((await exportDocuments(outsider, { period: Q3 })).count).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'document.export' } })).toBe(2);
  });
});
