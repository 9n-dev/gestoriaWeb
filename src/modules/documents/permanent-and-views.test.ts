import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/modules/auth/permissions';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant } from '@tests/setup/factories';
import { sessionUserFor } from '@tests/setup/session';
import { deletePermanentDocument, listPermanentDocuments } from './permanent';
import { deleteSavedView, listSavedViews, saveView } from './saved-views';

describe('permanent documents', () => {
  let tenantId: string;
  let clientId: string;
  let manager: SessionUser;
  let clientUser: SessionUser;
  let n = 0;

  const add = async (
    title: string,
    expiresAt: string | null,
    status: 'CLEAN' | 'PENDING' = 'CLEAN',
  ) => {
    const file = await prisma.storedFile.create({
      data: {
        tenantId,
        kind: 'PERMANENT_DOCUMENT',
        status,
        storageKey: `p-${++n}`,
        originalName: 'x.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
      },
    });
    return prisma.permanentDocument.create({
      data: {
        tenantId,
        clientId,
        fileId: file.id,
        title,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });
  };

  beforeEach(async () => {
    await resetDb();
    tenantId = (await createTenant()).id;
    manager = await sessionUserFor(tenantId, 'MANAGER');
    clientId = (await createClient(tenantId, { assignedManagerId: manager.id })).id;
    clientUser = await sessionUserFor(tenantId, 'CLIENT_USER', { clientIds: [clientId] });
  });

  it('lists finished uploads, soonest expiry first, to staff and to the client', async () => {
    await add('Escritura', null);
    await add('Certificado digital', '2027-03-01');
    await add('Poder notarial', '2026-12-01');
    await add('Subida a medias', null, 'PENDING');

    for (const user of [manager, clientUser]) {
      expect((await listPermanentDocuments(user, clientId)).map((d) => d.title)).toEqual([
        'Poder notarial',
        'Certificado digital',
        'Escritura',
      ]);
    }
  });

  it('only staff with the client assigned can delete', async () => {
    const document = await add('Escritura', null);
    const stranger = await sessionUserFor(tenantId, 'MANAGER');
    await expect(deletePermanentDocument(clientUser, document.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(deletePermanentDocument(stranger, document.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(listPermanentDocuments(stranger, clientId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    await deletePermanentDocument(manager, document.id);
    expect(await listPermanentDocuments(manager, clientId)).toEqual([]);
  });
});

describe('saved inbox views', () => {
  it('are personal: saved, overwritten by name, listed and deleted only by their owner', async () => {
    await resetDb();
    const tenantId = (await createTenant()).id;
    const ana = await sessionUserFor(tenantId, 'MANAGER');
    const luis = await sessionUserFor(tenantId, 'MANAGER');

    await saveView(ana, {
      name: 'Rechazados',
      filters: { statuses: ['REJECTED'], order: 'newest' },
    });
    await saveView(ana, { name: 'Rechazados', filters: { statuses: ['REJECTED', 'DUPLICATE'] } });

    const views = await listSavedViews(ana);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      name: 'Rechazados',
      filters: { statuses: ['REJECTED', 'DUPLICATE'], order: 'oldest' },
    });
    expect(await listSavedViews(luis)).toEqual([]);

    await expect(deleteSavedView(luis, views[0]!.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await deleteSavedView(ana, views[0]!.id);
    expect(await listSavedViews(ana)).toEqual([]);

    const client = await sessionUserFor(tenantId, 'CLIENT_USER');
    await expect(saveView(client, { name: 'x', filters: {} })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
