import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { isoDate } from '@/lib/dates';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant } from '@tests/setup/factories';
import { seedSystemData } from '../../../prisma/system-data';
import { syncObligationsForClient, syncObligationsForClients } from './service';

const profileId = async (name: string) =>
  (await prisma.taxProfile.findFirstOrThrow({ where: { tenantId: null, name } })).id;

const obligationsOf = async (clientId: string) =>
  (
    await prisma.obligation.findMany({
      where: { clientId },
      include: { period: true },
      orderBy: [{ dueDate: 'asc' }, { model: 'asc' }],
    })
  ).map(
    (o) =>
      `${o.model} ${o.period.year}-${o.period.type[0]}${o.period.ordinal} ${isoDate(o.dueDate)}`,
  );

describe('obligation generation', () => {
  let tenantId: string;

  beforeEach(async () => {
    await resetDb();
    await seedSystemData(prisma);
    tenantId = (await createTenant()).id;
  });

  it('§6.2 acceptance: EDS, quarterly, no employees, rented premises', async () => {
    const client = await createClient(tenantId, {
      taxProfileId: await profileId('Autónomo · Estimación directa con local alquilado'),
    });

    await syncObligationsForClient(tenantId, client.id, { today: '2026-01-02' });

    const all = await obligationsOf(client.id);
    const fiscal2026 = all.filter((line) => line.split(' ')[1]!.startsWith('2026-'));
    expect(fiscal2026).toEqual([
      '115 2026-Q1 2026-04-20',
      '130 2026-Q1 2026-04-20',
      '303 2026-Q1 2026-04-20',
      '115 2026-Q2 2026-07-20',
      '130 2026-Q2 2026-07-20',
      '303 2026-Q2 2026-07-20',
      '115 2026-Q3 2026-10-20',
      '130 2026-Q3 2026-10-20',
      '303 2026-Q3 2026-10-20',
      '115 2026-Q4 2027-01-20',
      '130 2026-Q4 2027-02-01', // 30 Jan 2027 is Saturday
      '180 2026-Y0 2027-02-01', // 31 Jan 2027 is Sunday
      '303 2026-Q4 2027-02-01',
      '390 2026-Y0 2027-02-01',
      '100 2026-Y0 2027-06-30',
    ]);
    expect(new Set(all.map((line) => line.split(' ')[0]))).toEqual(
      new Set(['303', '130', '115', '390', '180', '100']),
    );
    // Deadlines of fiscal year 2025 that are still ahead on 2 January 2026 are included too.
    expect(all).toContain('303 2025-Q4 2026-01-30');
    expect(all).toContain('100 2025-Y0 2026-06-30');
  });

  it('never creates obligations whose deadline has passed', async () => {
    const client = await createClient(tenantId, {
      taxProfileId: await profileId('Autónomo · Estimación directa'),
    });
    await syncObligationsForClient(tenantId, client.id, { today: '2026-09-18' });
    const all = await obligationsOf(client.id);
    expect(all[0]).toBe('130 2026-Q3 2026-10-20');
    expect(all.every((line) => line.split(' ')[2]! >= '2026-09-18')).toBe(true);
  });

  it('is idempotent', async () => {
    const client = await createClient(tenantId, {
      taxProfileId: await profileId('Sociedad limitada'),
    });
    const first = await syncObligationsForClient(tenantId, client.id, { today: '2026-09-18' });
    const second = await syncObligationsForClient(tenantId, client.id, { today: '2026-09-18' });
    expect(first.added.length).toBeGreaterThan(0);
    expect(second).toEqual({ added: [], removed: [], kept: first.added.length });
  });

  it('adds next fiscal year from December on', async () => {
    const client = await createClient(tenantId, {
      taxProfileId: await profileId('Autónomo · Estimación directa'),
    });
    await syncObligationsForClient(tenantId, client.id, { today: '2026-11-30' });
    expect((await obligationsOf(client.id)).some((line) => line.includes(' 2027-Q1 '))).toBe(false);

    const december = await syncObligationsForClient(tenantId, client.id, { today: '2026-12-01' });
    expect(december.added.some((o) => o.year === 2027 && o.model === '303')).toBe(true);
  });

  it('follows monthly VAT periodicity', async () => {
    const monthly = await prisma.taxProfile.create({
      data: {
        tenantId,
        name: 'SL mensual',
        rules: {
          regime: 'CORPORATE',
          vatPeriodicity: 'MONTH',
          hasEmployees: true,
          withholdsRent: false,
          intraCommunity: false,
          models: ['303', '111', '200'],
          checklist: [],
        },
      },
    });
    const client = await createClient(tenantId, { taxProfileId: monthly.id });
    await syncObligationsForClient(tenantId, client.id, { today: '2026-09-18' });
    const all = await obligationsOf(client.id);
    expect(all).toContain('111 2026-M9 2026-10-20');
    expect(all).toContain('303 2026-M9 2026-10-30');
    expect(all.some((line) => line.includes('-Q'))).toBe(false);
  });

  it('on profile change keeps started work, drops what no longer applies and reports the diff', async () => {
    const client = await createClient(tenantId, {
      taxProfileId: await profileId('Autónomo · Estimación directa con local alquilado'),
    });
    await syncObligationsForClient(tenantId, client.id, { today: '2026-09-18' });

    // The manager already started the Q3 115.
    const started = await prisma.obligation.findFirstOrThrow({
      where: { clientId: client.id, model: '115', dueDate: new Date('2026-10-20') },
    });
    await prisma.obligation.update({ where: { id: started.id }, data: { status: 'IN_PROGRESS' } });

    await prisma.client.update({
      where: { id: client.id },
      data: { taxProfileId: await profileId('Autónomo · Módulos') },
    });
    const diff = await syncObligationsForClient(tenantId, client.id, { today: '2026-09-18' });

    expect(new Set(diff.added.map((o) => o.model))).toEqual(new Set(['131']));
    expect(new Set(diff.removed.map((o) => o.model))).toEqual(new Set(['130', '115', '180']));
    const after = await obligationsOf(client.id);
    expect(after).toContain('115 2026-Q3 2026-10-20'); // started: kept
    expect(after).not.toContain('115 2026-Q4 2027-01-20'); // not started: removed
    expect(after).toContain('131 2026-Q3 2026-10-20');
    expect(after).toContain('303 2026-Q3 2026-10-20'); // common to both profiles: untouched
  });

  it('removes pending future obligations when the profile is unassigned', async () => {
    const client = await createClient(tenantId, {
      taxProfileId: await profileId('Particular · Solo Renta'),
    });
    await syncObligationsForClient(tenantId, client.id, { today: '2026-09-18' });
    await prisma.client.update({ where: { id: client.id }, data: { taxProfileId: null } });
    const diff = await syncObligationsForClient(tenantId, client.id, { today: '2026-09-18' });
    expect(diff.removed.map((o) => o.model)).toEqual(['100']);
    expect(await obligationsOf(client.id)).toEqual([]);
  });

  it('cannot reach a client of another tenant', async () => {
    const other = await createTenant();
    const client = await createClient(other.id, {
      taxProfileId: await profileId('Sociedad limitada'),
    });
    await expect(syncObligationsForClient(tenantId, client.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await prisma.obligation.count()).toBe(0);
  });

  it('syncs every active client with a profile (December job)', async () => {
    const id = await profileId('Autónomo · Estimación directa');
    await createClient(tenantId, { taxProfileId: id });
    await createClient((await createTenant()).id, { taxProfileId: id });
    await createClient(tenantId, { taxProfileId: id, status: 'INACTIVE' });
    await createClient(tenantId);
    expect(await syncObligationsForClients({}, { today: '2026-12-01' })).toBe(2);
    expect(await prisma.obligation.count({ where: { period: { year: 2027 } } })).toBeGreaterThan(0);
  });
});
