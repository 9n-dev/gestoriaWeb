import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/modules/auth/permissions';
import { resetDb } from '@tests/setup/db';
import { createTenant } from '@tests/setup/factories';
import { sessionUserFor } from '@tests/setup/session';
import { parseBillingSettings } from './schema';
import { getBillingSettings, saveBillingSettings } from './settings';

const valid = {
  paymentDays: '30',
  dunningDays: '20, 5 5;10',
  delinquentAfterDays: '45',
  seriesCode: ' f26 ',
};

describe('billing settings', () => {
  let tenantId: string;
  let admin: SessionUser;

  beforeEach(async () => {
    await resetDb();
    tenantId = (await createTenant({ settings: { retentionYears: 8 } })).id;
    admin = await sessionUserFor(tenantId, 'TENANT_ADMIN');
  });

  it('starts from the defaults', async () => {
    expect(await getBillingSettings(admin)).toEqual({
      paymentDays: 15,
      dunningDays: [3, 10, 20],
      delinquentAfterDays: 30,
      seriesCode: 'A',
    });
  });

  it('saves a normalised version without touching other settings, and audits the change', async () => {
    const saved = await saveBillingSettings(admin, valid);
    expect(saved).toEqual({
      paymentDays: 30,
      dunningDays: [5, 10, 20],
      delinquentAfterDays: 45,
      seriesCode: 'F26',
    });

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(parseBillingSettings(tenant.settings)).toEqual(saved);
    expect(tenant.settings).toMatchObject({ retentionYears: 8 });
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'tenantSettings.billing' },
    });
    expect(entry.diff).toMatchObject({ before: { seriesCode: 'A' }, after: { seriesCode: 'F26' } });
  });

  it('accepts no reminders at all', async () => {
    expect((await saveBillingSettings(admin, { ...valid, dunningDays: '' })).dunningDays).toEqual(
      [],
    );
  });

  it.each([
    [{ paymentDays: '-1' }, 'plazo de pago'],
    [{ dunningDays: '3, diez' }, 'separados por comas'],
    [{ dunningDays: '1,2,3,4,5,6,7' }, 'máximo 6'],
    [{ dunningDays: '10, 60' }, 'posterior al paso a moroso'],
    [{ seriesCode: 'R' }, 'rectificativas'],
    [{ seriesCode: 'A-2026' }, 'letras o números'],
  ])('explains what is wrong with %o', async (change, message) => {
    await expect(saveBillingSettings(admin, { ...valid, ...change })).rejects.toMatchObject({
      issues: [expect.objectContaining({ message: expect.stringContaining(message) })],
    });
  });

  it('is for the tenant admin only', async () => {
    const supervisor = await sessionUserFor(tenantId, 'SUPERVISOR');
    await expect(saveBillingSettings(supervisor, valid)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(getBillingSettings(supervisor)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
