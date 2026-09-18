import type { Prisma, TaxProfile } from '@prisma/client';
import { prisma, tenantDb } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { recordAudit } from '@/modules/audit/service';
import { assertCan, requireTenantId, type SessionUser } from '@/modules/auth/permissions';
import { syncObligationsForClients } from '@/modules/obligations/service';
import { taxProfileInputSchema, type TaxProfileInput } from './schema';

const notFound = () => new AppError('NOT_FOUND', 'No encontramos ese perfil fiscal.');

const tenantOf = requireTenantId;

/**
 * System templates (tenantId null) are shared and read-only, so they cannot go through tenantDb.
 * This is the only place that reads them together with the tenant's own profiles.
 */
const visibleTo = (tenantId: string): Prisma.TaxProfileWhereInput => ({
  archivedAt: null,
  OR: [{ tenantId: null }, { tenantId }],
});

export async function listTaxProfiles(user: SessionUser): Promise<TaxProfile[]> {
  assertCan(user, 'taxProfile.read');
  return prisma.taxProfile.findMany({
    where: visibleTo(tenantOf(user)),
    orderBy: [{ tenantId: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
  });
}

export async function getTaxProfile(user: SessionUser, id: string): Promise<TaxProfile> {
  assertCan(user, 'taxProfile.read');
  const profile = await prisma.taxProfile.findFirst({
    where: { id, ...visibleTo(tenantOf(user)) },
  });
  if (!profile) throw notFound();
  return profile;
}

/** Tenants never edit system templates: they clone one and edit the copy. */
export async function cloneTaxProfile(user: SessionUser, id: string): Promise<TaxProfile> {
  assertCan(user, 'taxProfile.manage');
  const source = await getTaxProfile(user, id);
  const clone = await tenantDb(tenantOf(user)).taxProfile.create({
    data: {
      tenantId: tenantOf(user),
      name: `${source.name} (copia)`,
      description: source.description,
      rules: source.rules as Prisma.InputJsonValue,
      clonedFromId: source.id,
    },
  });
  await recordAudit({
    tenantId: clone.tenantId,
    actor: user,
    action: 'taxProfile.clone',
    entity: 'TaxProfile',
    entityId: clone.id,
    diff: { clonedFromId: source.id },
  });
  return clone;
}

async function ownProfile(user: SessionUser, id: string): Promise<TaxProfile> {
  const profile = await tenantDb(tenantOf(user)).taxProfile.findFirst({
    where: { id, archivedAt: null },
  });
  if (profile) return profile;
  // Distinguish "system template" (exists, not editable) from "not found".
  await getTaxProfile(user, id);
  throw new AppError(
    'FORBIDDEN',
    'Los perfiles del sistema no se pueden modificar. Clónalo y edita la copia.',
  );
}

/** Editing a profile re-syncs the obligations of every client that uses it (§6.2). */
export async function updateTaxProfile(
  user: SessionUser,
  id: string,
  input: TaxProfileInput,
): Promise<TaxProfile> {
  assertCan(user, 'taxProfile.manage');
  const data = taxProfileInputSchema.parse(input);
  const before = await ownProfile(user, id);

  const profile = await tenantDb(tenantOf(user)).taxProfile.update({ where: { id }, data });
  await recordAudit({
    tenantId: profile.tenantId,
    actor: user,
    action: 'taxProfile.update',
    entity: 'TaxProfile',
    entityId: id,
    diff: { before: before.rules, after: profile.rules } as Prisma.InputJsonValue,
  });
  await syncObligationsForClients({ tenantId: tenantOf(user), taxProfileId: id });
  return profile;
}

export async function archiveTaxProfile(user: SessionUser, id: string): Promise<void> {
  assertCan(user, 'taxProfile.manage');
  await ownProfile(user, id);
  const db = tenantDb(tenantOf(user));
  const inUse = await db.client.count({ where: { taxProfileId: id, deletedAt: null } });
  if (inUse > 0) {
    throw new AppError(
      'CONFLICT',
      `Hay ${inUse} cliente(s) con este perfil. Asígnales otro antes de archivarlo.`,
    );
  }
  await db.taxProfile.update({ where: { id }, data: { archivedAt: new Date() } });
  await recordAudit({
    tenantId: tenantOf(user),
    actor: user,
    action: 'taxProfile.archive',
    entity: 'TaxProfile',
    entityId: id,
  });
}
