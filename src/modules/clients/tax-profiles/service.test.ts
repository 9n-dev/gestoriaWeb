import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/modules/auth/permissions';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant } from '@tests/setup/factories';
import { sessionUserFor } from '@tests/setup/session';
import { seedSystemData } from '../../../../prisma/system-data';
import { suggestModels, taxProfileRulesSchema, type TaxProfileRules } from './schema';
import {
  archiveTaxProfile,
  cloneTaxProfile,
  getTaxProfile,
  listTaxProfiles,
  updateTaxProfile,
} from './service';

describe('tax profiles', () => {
  let adminA: SessionUser;
  let managerA: SessionUser;
  let adminB: SessionUser;
  let systemId: string;

  beforeEach(async () => {
    await resetDb();
    await seedSystemData(prisma);
    const a = (await createTenant()).id;
    adminA = await sessionUserFor(a, 'TENANT_ADMIN');
    managerA = await sessionUserFor(a, 'MANAGER');
    adminB = await sessionUserFor((await createTenant()).id, 'TENANT_ADMIN');
    systemId = (
      await prisma.taxProfile.findFirstOrThrow({ where: { name: 'Autónomo · Estimación directa' } })
    ).id;
  });

  it('every system template has valid rules', async () => {
    const templates = await prisma.taxProfile.findMany({ where: { tenantId: null } });
    expect(templates.length).toBeGreaterThanOrEqual(8);
    for (const template of templates) {
      expect(taxProfileRulesSchema.safeParse(template.rules).success, template.name).toBe(true);
    }
  });

  it("lists system templates plus the tenant's own profiles, never another tenant's", async () => {
    const clone = await cloneTaxProfile(adminA, systemId);
    expect(clone).toMatchObject({ tenantId: adminA.tenantId, clonedFromId: systemId });

    expect((await listTaxProfiles(managerA)).map((p) => p.id)).toContain(clone.id);
    expect((await listTaxProfiles(adminB)).map((p) => p.id)).not.toContain(clone.id);
    await expect(getTaxProfile(adminB, clone.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(cloneTaxProfile(adminB, clone.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('only TENANT_ADMIN manages profiles', async () => {
    await expect(cloneTaxProfile(managerA, systemId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('system templates are read-only', async () => {
    const rules = taxProfileRulesSchema.parse((await getTaxProfile(adminA, systemId)).rules);
    await expect(
      updateTaxProfile(adminA, systemId, { name: 'Hackeado', rules }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(archiveTaxProfile(adminA, systemId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects unknown or repeated models', async () => {
    const clone = await cloneTaxProfile(adminA, systemId);
    const rules = taxProfileRulesSchema.parse(clone.rules);
    for (const models of [['303', '999'], ['303', '303'], []]) {
      await expect(
        updateTaxProfile(adminA, clone.id, { name: 'Perfil', rules: { ...rules, models } }),
      ).rejects.toThrow();
    }
  });

  it('editing a profile re-syncs the obligations of its clients', async () => {
    const clone = await cloneTaxProfile(adminA, systemId);
    const client = await createClient(adminA.tenantId!, { taxProfileId: clone.id });
    const rules = taxProfileRulesSchema.parse(clone.rules);

    await updateTaxProfile(adminA, clone.id, {
      name: 'Con intracomunitarias',
      rules: { ...rules, models: [...rules.models, '349'] },
    });

    expect(
      await prisma.obligation.count({ where: { clientId: client.id, model: '349' } }),
    ).toBeGreaterThan(0);
  });

  it('cannot archive a profile that is in use', async () => {
    const clone = await cloneTaxProfile(adminA, systemId);
    const client = await createClient(adminA.tenantId!, { taxProfileId: clone.id });
    await expect(archiveTaxProfile(adminA, clone.id)).rejects.toMatchObject({ code: 'CONFLICT' });

    await prisma.client.update({ where: { id: client.id }, data: { taxProfileId: null } });
    await archiveTaxProfile(adminA, clone.id);
    expect((await listTaxProfiles(adminA)).map((p) => p.id)).not.toContain(clone.id);
  });

  it('suggests models from the flags', () => {
    const flags: Omit<TaxProfileRules, 'models' | 'checklist'> = {
      regime: 'DIRECT_SIMPLIFIED',
      vatPeriodicity: 'QUARTER',
      hasEmployees: false,
      withholdsRent: true,
      intraCommunity: false,
    };
    expect(new Set(suggestModels(flags))).toEqual(
      new Set(['303', '130', '115', '390', '180', '100']),
    );
    expect(
      suggestModels({ ...flags, regime: 'CORPORATE', hasEmployees: true, withholdsRent: false }),
    ).toEqual(['303', '390', '111', '190', '347', '200']);
  });
});
