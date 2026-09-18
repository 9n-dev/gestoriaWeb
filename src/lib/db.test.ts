import { beforeEach, describe, expect, it } from 'vitest';
import { createClient, createTenant } from '@tests/setup/factories';
import { resetDb } from '@tests/setup/db';
import { prisma, tenantDb } from './db';

describe('tenantDb', () => {
  let a: string;
  let b: string;
  let clientA: string;
  let clientB: string;

  beforeEach(async () => {
    await resetDb();
    a = (await createTenant()).id;
    b = (await createTenant()).id;
    clientA = (await createClient(a)).id;
    clientB = (await createClient(b)).id;
  });

  it('lists and counts only rows of its tenant', async () => {
    const rows = await tenantDb(a).client.findMany();
    expect(rows.map((r) => r.id)).toEqual([clientA]);
    expect(await tenantDb(a).client.count()).toBe(1);
  });

  it('ignores a tenantId filter supplied by the caller', async () => {
    const rows = await tenantDb(a).client.findMany({ where: { tenantId: b } });
    expect(rows.map((r) => r.id)).toEqual([clientA]);
  });

  it('cannot read a foreign row by id', async () => {
    expect(await tenantDb(a).client.findUnique({ where: { id: clientB } })).toBeNull();
    expect(await tenantDb(a).client.findFirst({ where: { id: clientB } })).toBeNull();
  });

  it('cannot update or delete a foreign row', async () => {
    await expect(
      tenantDb(a).client.update({ where: { id: clientB }, data: { legalName: 'hacked' } }),
    ).rejects.toThrow();
    await expect(tenantDb(a).client.delete({ where: { id: clientB } })).rejects.toThrow();
    const many = await tenantDb(a).client.updateMany({ data: { legalName: 'hacked' } });
    expect(many.count).toBe(1);

    const untouched = await prisma.client.findUniqueOrThrow({ where: { id: clientB } });
    expect(untouched.legalName).not.toBe('hacked');
  });

  it('forces its tenantId on create, createMany and upsert', async () => {
    const created = await tenantDb(a).client.create({
      // A forged tenantId must be overridden.
      data: { tenantId: b, legalName: 'Nuevo', taxId: 'N1', inboundEmailCode: 'n1' },
    });
    expect(created.tenantId).toBe(a);

    await tenantDb(a).client.createMany({
      data: [{ tenantId: b, legalName: 'Otro', taxId: 'N2', inboundEmailCode: 'n2' }],
    });
    expect(await prisma.client.count({ where: { tenantId: b } })).toBe(1);

    const upserted = await tenantDb(a).client.upsert({
      where: { id: 'missing' },
      create: { tenantId: b, legalName: 'Up', taxId: 'N3', inboundEmailCode: 'n3' },
      update: {},
    });
    expect(upserted.tenantId).toBe(a);
  });

  it('cannot move a row to another tenant', async () => {
    await tenantDb(a).client.update({ where: { id: clientA }, data: { tenantId: b } });
    const row = await prisma.client.findUniqueOrThrow({ where: { id: clientA } });
    expect(row.tenantId).toBe(a);
  });

  it('passes through models without tenantId', async () => {
    await tenantDb(a).period.create({ data: { year: 2026, type: 'QUARTER', ordinal: 3 } });
    expect(await tenantDb(b).period.count()).toBe(1);
  });
});
