import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/modules/auth/permissions';
import { resetDb } from '@tests/setup/db';
import { createClient as makeClient, createTenant } from '@tests/setup/factories';
import { sessionUserFor } from '@tests/setup/session';
import { seedSystemData } from '../../../prisma/system-data';
import type { StaffClient } from './repository';
import {
  searchClients,
  assignManager,
  assignTaxProfile,
  createClient,
  deleteClient,
  getClientFor,
  listClientsFor,
  updateClient,
  updateInternalNotes,
} from './service';

const input = (overrides = {}) => ({
  legalName: 'Marta Soler Vidal',
  taxId: '12345678z',
  ...overrides,
});

describe('clients service', () => {
  let tenantId: string;
  let admin: SessionUser;
  let supervisor: SessionUser;
  let manager: SessionUser;
  let otherManager: SessionUser;

  beforeEach(async () => {
    await resetDb();
    await seedSystemData(prisma);
    tenantId = (await createTenant()).id;
    admin = await sessionUserFor(tenantId, 'TENANT_ADMIN');
    supervisor = await sessionUserFor(tenantId, 'SUPERVISOR');
    manager = await sessionUserFor(tenantId, 'MANAGER');
    otherManager = await sessionUserFor(tenantId, 'MANAGER');
  });

  it('validates and normalizes the NIF', async () => {
    const client = await createClient(admin, input({ taxId: ' 12.345.678-z ' }));
    expect(client.taxId).toBe('12345678Z');
    await expect(createClient(admin, input({ taxId: '12345678A' }))).rejects.toThrow(
      /NIF no es válido/,
    );
  });

  it('rejects a duplicate NIF in the tenant, but allows it in another tenant', async () => {
    await createClient(admin, input());
    await expect(createClient(admin, input())).rejects.toMatchObject({
      code: 'CONFLICT',
      userMessage: 'Ya existe un cliente con el NIF 12345678Z.',
    });
    const adminB = await sessionUserFor((await createTenant()).id, 'TENANT_ADMIN');
    await expect(createClient(adminB, input())).resolves.toBeTruthy();
  });

  it('auto-assigns clients created by a manager, whatever the input says', async () => {
    const client = (await createClient(
      manager,
      input({ assignedManagerId: otherManager.id }),
    )) as StaffClient;
    expect(client.assignedManagerId).toBe(manager.id);
    expect((await listClientsFor(otherManager)).length).toBe(0);
  });

  it('lets supervisors choose the manager, who must be staff of the same tenant', async () => {
    const client = (await createClient(
      supervisor,
      input({ assignedManagerId: manager.id }),
    )) as StaffClient;
    expect(client.assignedManagerId).toBe(manager.id);

    const outsider = await sessionUserFor((await createTenant()).id, 'MANAGER');
    const clientUser = await sessionUserFor(tenantId, 'CLIENT_USER');
    for (const id of [outsider.id, clientUser.id]) {
      await expect(assignManager(supervisor, client.id, id)).rejects.toMatchObject({
        code: 'VALIDATION',
      });
    }
    await expect(assignManager(manager, client.id, otherManager.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('client users cannot create, update or delete clients', async () => {
    const client = await createClient(admin, input());
    const clientUser = await sessionUserFor(tenantId, 'CLIENT_USER', { clientIds: [client.id] });
    await expect(createClient(clientUser, input({ taxId: 'B12345674' }))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(updateClient(clientUser, client.id, input())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(deleteClient(clientUser, client.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('managers update assigned clients only; unassigned ones do not exist for them', async () => {
    const mine = await createClient(manager, input());
    const theirs = await createClient(
      otherManager,
      input({ taxId: 'B12345674', legalName: 'Turia SL' }),
    );

    const updated = await updateClient(
      manager,
      mine.id,
      input({ legalName: 'Marta S.', phone: '600111222' }),
    );
    expect(updated).toMatchObject({ legalName: 'Marta S.', phone: '600111222' });
    await expect(updateClient(manager, theirs.id, input())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(deleteClient(manager, mine.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('update never changes manager or tax profile', async () => {
    const client = (await createClient(manager, input())) as StaffClient;
    await updateClient(
      manager,
      client.id,
      input({ assignedManagerId: otherManager.id, taxProfileId: 'x' }),
    );
    const after = (await getClientFor(admin, client.id)) as StaffClient;
    expect(after).toMatchObject({ assignedManagerId: manager.id, taxProfileId: null });
  });

  it('assigning a tax profile generates obligations and reports the diff', async () => {
    const profile = await prisma.taxProfile.findFirstOrThrow({
      where: { name: 'Autónomo · Estimación directa' },
    });
    const client = await createClient(manager, input());

    const diff = await assignTaxProfile(manager, client.id, profile.id);
    expect(diff.added.length).toBeGreaterThan(0);
    expect(diff.removed).toEqual([]);
    expect(await prisma.obligation.count({ where: { clientId: client.id } })).toBe(
      diff.added.length,
    );

    const modules = await prisma.taxProfile.findFirstOrThrow({
      where: { name: 'Autónomo · Módulos' },
    });
    const change = await assignTaxProfile(manager, client.id, modules.id);
    expect(new Set(change.removed.map((o) => o.model))).toEqual(new Set(['130']));
    expect(new Set(change.added.map((o) => o.model))).toEqual(new Set(['131']));
  });

  it('creating with a profile generates the obligations straight away', async () => {
    const profile = await prisma.taxProfile.findFirstOrThrow({
      where: { name: 'Sociedad limitada' },
    });
    const client = await createClient(
      admin,
      input({ taxId: 'B12345674', taxProfileId: profile.id }),
    );
    expect(await prisma.obligation.count({ where: { clientId: client.id } })).toBeGreaterThan(0);
  });

  it('cannot use a tax profile of another tenant', async () => {
    const foreign = await prisma.taxProfile.create({
      data: { tenantId: (await createTenant()).id, name: 'Ajeno', rules: {} },
    });
    await expect(createClient(admin, input({ taxProfileId: foreign.id }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('internal notes: written by staff, never visible to the client, content kept out of the audit log', async () => {
    const client = await createClient(manager, input());
    await updateInternalNotes(manager, client.id, 'Suele pagar tarde');

    expect(await getClientFor(manager, client.id)).toMatchObject({
      internalNotes: 'Suele pagar tarde',
    });
    const clientUser = await sessionUserFor(tenantId, 'CLIENT_USER', { clientIds: [client.id] });
    expect(await getClientFor(clientUser, client.id)).not.toHaveProperty('internalNotes');
    await expect(updateInternalNotes(clientUser, client.id, 'x')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const audit = await prisma.auditLog.findMany({ where: { entityId: client.id } });
    expect(JSON.stringify(audit)).not.toContain('pagar tarde');
  });

  it('soft-deletes: the client disappears from lists but the row remains', async () => {
    const client = await createClient(admin, input());
    await deleteClient(supervisor, client.id);
    expect(await listClientsFor(admin)).toEqual([]);
    await expect(getClientFor(admin, client.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      (await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).deletedAt,
    ).not.toBeNull();
  });

  it('audits every mutation', async () => {
    const client = await createClient(admin, input());
    await updateClient(admin, client.id, input({ city: 'Valencia' }));
    await assignManager(admin, client.id, manager.id);
    await deleteClient(admin, client.id);
    const actions = (
      await prisma.auditLog.findMany({ where: { entityId: client.id, actorId: admin.id } })
    ).map((entry) => entry.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'client.create',
        'client.update',
        'client.assignManager',
        'client.delete',
      ]),
    );
  });
});

describe('client search (TD-026)', () => {
  it('searches by name or tax id in SQL, paginates, and stays inside the manager scope', async () => {
    await resetDb();
    const tenantId = (await createTenant()).id;
    const manager = await sessionUserFor(tenantId, 'MANAGER');
    const supervisor = await sessionUserFor(tenantId, 'SUPERVISOR');
    for (let i = 0; i < 60; i++) {
      await makeClient(tenantId, {
        legalName: `Panadería ${String(i).padStart(2, '0')}`,
        taxId: `B${String(1000000 + i)}X`,
        assignedManagerId: i < 5 ? manager.id : null,
      });
    }
    await makeClient(tenantId, { legalName: 'Ferretería Ñu', taxId: 'A7654321Z' });
    await makeClient((await createTenant()).id, { legalName: 'Panadería ajena' });

    const first = await searchClients(supervisor, { query: 'panader' });
    expect(first).toMatchObject({ total: 60, page: 1, pages: 2 });
    expect(first.clients).toHaveLength(50);
    expect(first.clients[0]?.legalName).toBe('Panadería 00');
    const second = await searchClients(supervisor, { query: 'PANADER', page: 2 });
    expect(second.clients).toHaveLength(10);

    expect(
      (await searchClients(supervisor, { query: 'a7654321' })).clients.map((c) => c.legalName),
    ).toEqual(['Ferretería Ñu']);
    expect((await searchClients(manager, { query: 'panader' })).total).toBe(5);
    expect((await searchClients(supervisor, { query: '%' })).total).toBe(0); // LIKE wildcards are data, not syntax
    const client = await sessionUserFor(tenantId, 'CLIENT_USER');
    await expect(searchClients(client)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
