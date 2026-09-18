import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { parseCsv } from '@/lib/csv';
import { validateTaxId } from '@/lib/tax-id';
import type { SessionUser } from '@/modules/auth/permissions';
import { resetDb } from '@tests/setup/db';
import { createTenant, createUser } from '@tests/setup/factories';
import { sessionUserFor } from '@tests/setup/session';
import { seedSystemData } from '../../../prisma/system-data';
import { clientImportTemplate, importClients } from './import';

const LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const nif = (n: number) => `${String(n).padStart(8, '0')}${LETTERS[n % 23]}`;

describe('client import', () => {
  let tenantId: string;
  let supervisor: SessionUser;

  beforeEach(async () => {
    await resetDb();
    await seedSystemData(prisma);
    tenantId = (await createTenant()).id;
    supervisor = await sessionUserFor(tenantId, 'SUPERVISOR');
  });

  it('the downloadable template imports cleanly', async () => {
    const template = clientImportTemplate();
    expect(parseCsv(template)[0]).toContain('razon_social');
    expect(await importClients(supervisor, template)).toEqual({ imported: 1, rejected: [] });
  });

  it('imports 20 clients with profile and manager, generating their obligations', async () => {
    const gestor = await createUser(tenantId, 'MANAGER', { email: 'gestor@demo.es' });
    const rows = Array.from({ length: 20 }, (_, i) =>
      [
        `Cliente ${i}`,
        nif(1000 + i),
        `c${i}@example.com`,
        'Autónomo · Módulos',
        'Gestor@demo.es',
      ].join(';'),
    );
    const csv = ['Razón Social;NIF;Email;Perfil fiscal;Gestor email', ...rows].join('\r\n');

    expect(await importClients(supervisor, csv)).toEqual({ imported: 20, rejected: [] });
    const clients = await prisma.client.findMany({
      where: { tenantId },
      include: { obligations: true },
    });
    expect(clients).toHaveLength(20);
    expect(
      clients.every((c) => c.assignedManagerId === gestor.id && c.obligations.length > 0),
    ).toBe(true);
    expect(clients.every((c) => validateTaxId(c.taxId).valid)).toBe(true);
  });

  it('imports the valid rows and reports the others with their spreadsheet row number', async () => {
    const csv = [
      'razon_social,nif,email,perfil_fiscal,gestor_email',
      `Buena,${nif(1)},ok@example.com,,`,
      'NIF malo,12345678A,,,',
      `,${nif(2)},,,`,
      `Repetida,${nif(1)},,,`,
      `Email malo,${nif(3)},no-es-un-correo,,`,
      `Perfil raro,${nif(4)},,Perfil inventado,`,
      `Gestor raro,${nif(5)},,,nadie@demo.es`,
      `"Comas, S.L.",${nif(6)},,,`,
    ].join('\n');

    const report = await importClients(supervisor, csv);

    expect(report.imported).toBe(2);
    expect(report.rejected.map((r) => r.row)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(report.rejected[0]!.errors[0]).toMatch(/NIF no es válido/);
    expect(report.rejected[1]!.errors[0]).toMatch(/nombre o la razón social/);
    expect(report.rejected[2]!.errors).toEqual(['NIF repetido en el archivo.']);
    expect(report.rejected[3]!.errors[0]).toMatch(/correo electrónico no es válido/);
    expect(report.rejected[4]!.errors[0]).toMatch(/Perfil inventado/);
    expect(report.rejected[5]!.errors[0]).toMatch(/nadie@demo.es/);
    expect(await prisma.client.count({ where: { legalName: 'Comas, S.L.' } })).toBe(1);
  });

  it('reports clients that already exist instead of failing', async () => {
    const csv = `razon_social;nif\nMarta;${nif(7)}`;
    await importClients(supervisor, csv);
    const again = await importClients(supervisor, csv);
    expect(again.imported).toBe(0);
    expect(again.rejected[0]!.errors[0]).toMatch(/Ya existe un cliente/);
  });

  it('rejects files without the mandatory columns or without rows', async () => {
    await expect(importClients(supervisor, 'nombre;dni\nMarta;1')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(importClients(supervisor, 'razon_social;nif\n')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('is not available to managers or client users', async () => {
    for (const role of ['MANAGER', 'CLIENT_USER'] as const) {
      await expect(
        importClients(await sessionUserFor(tenantId, role), 'razon_social;nif\nA;1'),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });
});
