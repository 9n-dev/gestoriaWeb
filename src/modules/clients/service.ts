import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { tenantDb } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { recordAudit } from '@/modules/audit/service';
import {
  assertCan,
  can,
  requireTenantId,
  scopeFor,
  type Resource,
  type SessionUser,
} from '@/modules/auth/permissions';
import { syncObligationsForClient, type ObligationDiff } from '@/modules/obligations/service';
import {
  clientsRepository,
  type ClientFacingClient,
  type ClientFilter,
  type StaffClient,
} from './repository';
import { clientInputSchema, internalNotesSchema, type ClientInput } from './schema';
import { getTaxProfile } from './tax-profiles/service';

const notFound = (id: string) =>
  new AppError('NOT_FOUND', 'No encontramos ese cliente.', `client ${id} not visible`);

const resourceOf = (client: StaffClient): Resource => ({
  tenantId: client.tenantId,
  clientId: client.id,
  assignedManagerId: client.assignedManagerId,
  clientStatus: client.status,
});

function filterFor(user: SessionUser): ClientFilter {
  switch (scopeFor(user, 'client.read')) {
    case 'own':
      return { ids: user.clientIds };
    case 'assigned':
      return { assignedManagerId: user.id };
    case 'all':
      return {};
    default:
      throw new AppError('FORBIDDEN', 'No tienes permiso para realizar esta acción.');
  }
}

/** Clients the user may see: own (client user), assigned (manager) or all (supervisor, admin). */
export async function listClientsFor(
  user: SessionUser,
): Promise<Array<StaffClient | ClientFacingClient>> {
  assertCan(user, 'client.read');
  const repository = clientsRepository(requireTenantId(user));
  return can(user, 'client.readInternalNotes')
    ? repository.listForStaff(filterFor(user))
    : repository.listForClientUser(filterFor(user));
}

/** Staff view of a client the user can read. Not found and not allowed are indistinguishable. */
async function loadForStaff(user: SessionUser, id: string): Promise<StaffClient> {
  const client = await clientsRepository(requireTenantId(user)).findForStaff(id);
  if (!client || !can(user, 'client.read', resourceOf(client))) throw notFound(id);
  return client;
}

export async function getClientFor(
  user: SessionUser,
  id: string,
): Promise<StaffClient | ClientFacingClient> {
  const client = await loadForStaff(user, id);
  if (can(user, 'client.readInternalNotes', resourceOf(client))) return client;

  const {
    internalNotes: _notes,
    tags: _tags,
    assignedManagerId: _manager,
    taxProfileId: _profile,
    lastActivityAt: _activity,
    createdAt: _created,
    ...clientFacing
  } = client;
  return clientFacing;
}

/** Staff members that can be given clients. */
export async function listAssignableManagers(user: SessionUser) {
  assertCan(user, 'client.create');
  return tenantDb(requireTenantId(user)).user.findMany({
    where: { role: { in: ['MANAGER', 'SUPERVISOR', 'TENANT_ADMIN'] }, status: { not: 'DISABLED' } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

async function assertAssignable(user: SessionUser, managerId: string): Promise<void> {
  const managers = await listAssignableManagers(user);
  if (!managers.some((manager) => manager.id === managerId)) {
    throw new AppError('VALIDATION', 'El gestor seleccionado no existe en esta gestoría.');
  }
}

const duplicateTaxId = (error: unknown, taxId: string) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
    ? new AppError('CONFLICT', `Ya existe un cliente con el NIF ${taxId}.`, undefined, error)
    : error;

// Part of the client's inbound address <slug>-<code>@docs.<domain>; unambiguous alphabet.
const inboundCode = () =>
  Array.from(randomBytes(8), (byte) => 'abcdefghjkmnpqrstuvwxyz23456789'[byte % 31]).join('');

export async function createClient(user: SessionUser, input: ClientInput): Promise<StaffClient> {
  assertCan(user, 'client.create');
  const tenantId = requireTenantId(user);
  const { taxProfileId, assignedManagerId, ...data } = clientInputSchema.parse(input);

  // Managers only work on assigned clients, so what they create is theirs (ADR 0012).
  const managerId = can(user, 'client.assignManager') ? assignedManagerId : user.id;
  if (managerId && managerId !== user.id) await assertAssignable(user, managerId);
  if (taxProfileId) await getTaxProfile(user, taxProfileId);

  const created = await tenantDb(tenantId)
    .client.create({
      data: {
        tenantId,
        ...data,
        taxProfileId,
        assignedManagerId: managerId,
        inboundEmailCode: inboundCode(),
      },
      select: { id: true },
    })
    .catch((error: unknown) => {
      throw duplicateTaxId(error, data.taxId);
    });

  await recordAudit({
    tenantId,
    actor: user,
    action: 'client.create',
    entity: 'Client',
    entityId: created.id,
    diff: {
      legalName: data.legalName,
      taxId: data.taxId,
      taxProfileId,
      assignedManagerId: managerId,
    },
  });
  if (taxProfileId) await syncObligationsForClient(tenantId, created.id);
  return (await clientsRepository(tenantId).findForStaff(created.id))!;
}

/** Contact and identification data. Manager, tax profile and notes have their own operations. */
export async function updateClient(
  user: SessionUser,
  id: string,
  input: ClientInput,
): Promise<StaffClient> {
  const client = await loadForStaff(user, id);
  assertCan(user, 'client.update', resourceOf(client));
  const {
    taxProfileId: _profile,
    assignedManagerId: _manager,
    ...data
  } = clientInputSchema.parse(input);

  await tenantDb(client.tenantId)
    .client.update({ where: { id }, data })
    .catch((error: unknown) => {
      throw duplicateTaxId(error, data.taxId);
    });
  await recordAudit({
    tenantId: client.tenantId,
    actor: user,
    action: 'client.update',
    entity: 'Client',
    entityId: id,
    diff: {
      before: { legalName: client.legalName, taxId: client.taxId, email: client.email },
      after: data,
    },
  });
  return loadForStaff(user, id);
}

export async function assignManager(
  user: SessionUser,
  id: string,
  managerId: string | null,
): Promise<void> {
  const client = await loadForStaff(user, id);
  assertCan(user, 'client.assignManager', resourceOf(client));
  if (managerId) await assertAssignable(user, managerId);

  await tenantDb(client.tenantId).client.update({
    where: { id },
    data: { assignedManagerId: managerId },
  });
  await recordAudit({
    tenantId: client.tenantId,
    actor: user,
    action: 'client.assignManager',
    entity: 'Client',
    entityId: id,
    diff: { before: client.assignedManagerId, after: managerId },
  });
}

/** Changing the profile only touches future obligations nobody started; the diff is returned (§6.2). */
export async function assignTaxProfile(
  user: SessionUser,
  id: string,
  taxProfileId: string | null,
): Promise<ObligationDiff> {
  const client = await loadForStaff(user, id);
  assertCan(user, 'client.assignTaxProfile', resourceOf(client));
  if (taxProfileId) await getTaxProfile(user, taxProfileId);

  await tenantDb(client.tenantId).client.update({ where: { id }, data: { taxProfileId } });
  await recordAudit({
    tenantId: client.tenantId,
    actor: user,
    action: 'client.assignTaxProfile',
    entity: 'Client',
    entityId: id,
    diff: { before: client.taxProfileId, after: taxProfileId },
  });
  return syncObligationsForClient(client.tenantId, id);
}

export async function updateInternalNotes(
  user: SessionUser,
  id: string,
  notes: string,
): Promise<void> {
  const client = await loadForStaff(user, id);
  assertCan(user, 'client.writeInternalNotes', resourceOf(client));
  await tenantDb(client.tenantId).client.update({
    where: { id },
    data: { internalNotes: internalNotesSchema.parse(notes) },
  });
  // The content of internal notes stays out of the audit trail on purpose.
  await recordAudit({
    tenantId: client.tenantId,
    actor: user,
    action: 'client.updateInternalNotes',
    entity: 'Client',
    entityId: id,
  });
}

/** Soft delete. Physical deletion belongs to the erasure process (phase 9). */
export async function deleteClient(user: SessionUser, id: string): Promise<void> {
  const client = await loadForStaff(user, id);
  assertCan(user, 'client.delete', resourceOf(client));
  await tenantDb(client.tenantId).client.update({ where: { id }, data: { deletedAt: new Date() } });
  await recordAudit({
    tenantId: client.tenantId,
    actor: user,
    action: 'client.delete',
    entity: 'Client',
    entityId: id,
  });
}
