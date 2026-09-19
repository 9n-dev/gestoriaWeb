import type { DocumentStatus, DocumentType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/modules/auth/permissions';
import { assignTaxProfile } from '@/modules/clients/service';
import { rejectDocument, updateDocumentFields } from '@/modules/documents/service';
import { DEFAULT_REJECTION_REASONS } from '@/modules/documents/schema';
import { initiateUpload } from '@/modules/documents/uploads';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant } from '@tests/setup/factories';
import { sessionUserFor } from '@tests/setup/session';
import { seedSystemData } from '../../../prisma/system-data';
import {
  addChecklistItem,
  ensureChecklist,
  getClientChecklist,
  overviewCsv,
  removeChecklistItem,
  setChecklistItemFulfilled,
  setPeriodClosed,
  tenantOverview,
} from './service';

vi.mock('@/lib/storage/multipart', () => ({
  PART_SIZE: 5 * 1024 * 1024,
  createMultipartUpload: vi.fn(async () => 'u'),
}));
vi.mock('@/lib/queue', () => ({ enqueue: vi.fn(), QUEUES: { files: 'files' } }));

const Q3 = { year: 2026, type: 'QUARTER' as const, ordinal: 3 };
const TODAY = '2026-09-19';
let n = 0;

describe('checklists', () => {
  let tenantId: string;
  let manager: SessionUser;
  let clientId: string;

  const profileId = async (name: string) =>
    (await prisma.taxProfile.findFirstOrThrow({ where: { tenantId: null, name } })).id;
  const addDocument = async (
    type: DocumentType,
    status: DocumentStatus = 'RECEIVED',
    client = clientId,
  ) => {
    const period = await prisma.period.findUniqueOrThrow({ where: { year_type_ordinal: Q3 } });
    const file = await prisma.storedFile.create({
      data: {
        tenantId,
        kind: 'DOCUMENT',
        status: 'CLEAN',
        storageKey: `c-${++n}`,
        originalName: 'f.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
      },
    });
    return prisma.document.create({
      data: { tenantId, clientId: client, fileId: file.id, type, status, periodId: period.id },
    });
  };
  const checklist = () => getClientChecklist(manager, clientId, { period: Q3, today: TODAY });

  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    await resetDb();
    await seedSystemData(prisma);
    tenantId = (await createTenant()).id;
    manager = await sessionUserFor(tenantId, 'MANAGER');
    clientId = (
      await createClient(tenantId, {
        assignedManagerId: manager.id,
        taxProfileId: await profileId('Autónomo · Estimación directa con local alquilado'),
      })
    ).id;
  });

  it('generates the checklist from the tax profile, once', async () => {
    await ensureChecklist(tenantId, clientId, { period: Q3 });
    await ensureChecklist(tenantId, clientId, { period: Q3 });
    const result = (await checklist())!;
    expect(result.items.map((item) => item.label)).toEqual([
      'Facturas emitidas',
      'Facturas recibidas y gastos',
      'Recibos del alquiler del local',
    ]);
    expect(result.missing).toHaveLength(3);
  });

  it('assigning a profile creates the checklist of the period being collected', async () => {
    const fresh = await createClient(tenantId, { assignedManagerId: manager.id });
    await assignTaxProfile(manager, fresh.id, await profileId('Sociedad limitada'));
    expect(await prisma.checklistItem.count({ where: { clientId: fresh.id } })).toBe(3);
  });

  it('takes its deadline from the first obligation of the period and lights up accordingly', async () => {
    await assignTaxProfile(
      manager,
      clientId,
      await profileId('Autónomo · Estimación directa con local alquilado'),
    );
    expect(await checklist()).toMatchObject({ deadline: '2026-10-20', light: 'AMBER' });
    expect(
      (await getClientChecklist(manager, clientId, { period: Q3, today: '2026-10-13' }))!.light,
    ).toBe('RED');
    expect(
      (await getClientChecklist(manager, clientId, { period: Q3, today: '2026-10-25' }))!.light,
    ).toBe('RED');
  });

  it('ticks items automatically as documents of that type arrive, and unticks them when they are rejected', async () => {
    await ensureChecklist(tenantId, clientId, { period: Q3 });
    const clientUser = await sessionUserFor(tenantId, 'CLIENT_USER', { clientIds: [clientId] });
    await initiateUpload(clientUser, {
      purpose: 'DOCUMENT',
      clientId,
      fileName: 'f.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1000,
      documentType: 'ISSUED_INVOICE',
      period: Q3,
    });
    // An upload that has not finished does not count.
    expect((await checklist())!.missing).toHaveLength(3);

    const invoice = await addDocument('RECEIVED_INVOICE');
    await updateDocumentFields(manager, invoice.id, { type: 'RECEIVED_INVOICE', period: Q3 });
    expect((await checklist())!.missing).toEqual([
      'Facturas emitidas',
      'Recibos del alquiler del local',
    ]);

    await rejectDocument(manager, invoice.id, { reason: DEFAULT_REJECTION_REASONS[0]! });
    expect((await checklist())!.missing).toHaveLength(3);
  });

  it('re-typing a document moves the tick to the right item', async () => {
    await ensureChecklist(tenantId, clientId, { period: Q3 });
    const document = await addDocument('OTHER');
    await updateDocumentFields(manager, document.id, { type: 'RENT_RECEIPT', period: Q3 });
    expect((await checklist())!.missing).toEqual([
      'Facturas emitidas',
      'Facturas recibidas y gastos',
    ]);
    await updateDocumentFields(manager, document.id, {
      type: 'RENT_RECEIPT',
      period: { ...Q3, ordinal: 2 },
    });
    expect((await checklist())!.missing).toHaveLength(3);
  });

  it('goes green when everything is in', async () => {
    await ensureChecklist(tenantId, clientId, { period: Q3 });
    for (const type of ['ISSUED_INVOICE', 'RECEIVED_INVOICE', 'RENT_RECEIPT'] as const) {
      const document = await addDocument(type);
      await updateDocumentFields(manager, document.id, { type, period: Q3 });
    }
    expect(await checklist()).toMatchObject({ missing: [], light: 'GREEN' });
  });

  it('manager adds, removes and ticks items by hand; manual ticks survive document changes', async () => {
    await ensureChecklist(tenantId, clientId, { period: Q3 });
    await addChecklistItem(manager, clientId, Q3, {
      documentType: 'OTHER',
      label: 'Contrato de alquiler renovado',
    });
    let result = (await checklist())!;
    expect(result.items).toHaveLength(4);

    const rent = result.items.find((item) => item.documentType === 'RENT_RECEIPT')!;
    await removeChecklistItem(manager, rent.id);
    await ensureChecklist(tenantId, clientId, { period: Q3 }); // regeneration must not bring it back
    result = (await checklist())!;
    expect(result.items.map((item) => item.documentType)).not.toContain('RENT_RECEIPT');

    const issued = result.items.find((item) => item.documentType === 'ISSUED_INVOICE')!;
    await setChecklistItemFulfilled(manager, issued.id, true);
    const document = await addDocument('RECEIVED_INVOICE');
    await rejectDocument(manager, document.id, { reason: DEFAULT_REJECTION_REASONS[0]! });
    expect((await checklist())!.items.find((item) => item.id === issued.id)).toMatchObject({
      fulfilled: true,
      manual: true,
    });

    await setChecklistItemFulfilled(manager, issued.id, false);
    expect((await checklist())!.items.find((item) => item.id === issued.id)).toMatchObject({
      fulfilled: false,
      manual: false,
    });
  });

  it('closing the documentation blocks client uploads for that period until reopened', async () => {
    const clientUser = await sessionUserFor(tenantId, 'CLIENT_USER', { clientIds: [clientId] });
    const upload = () =>
      initiateUpload(clientUser, {
        purpose: 'DOCUMENT',
        clientId,
        fileName: 'f.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1000,
        period: Q3,
      });

    await setPeriodClosed(manager, clientId, Q3, true);
    expect((await checklist())!.closed).toBe(true);
    await expect(upload()).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await setPeriodClosed(manager, clientId, Q3, false);
    await expect(upload()).resolves.toBeTruthy();
    await expect(setPeriodClosed(clientUser, clientId, Q3, true)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('clients read their checklist but cannot manage it; strangers see nothing', async () => {
    await ensureChecklist(tenantId, clientId, { period: Q3 });
    const clientUser = await sessionUserFor(tenantId, 'CLIENT_USER', { clientIds: [clientId] });
    const result = (await getClientChecklist(clientUser, clientId, { period: Q3, today: TODAY }))!;
    expect(result.items).toHaveLength(3);
    await expect(removeChecklistItem(clientUser, result.items[0]!.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      addChecklistItem(clientUser, clientId, Q3, { documentType: 'OTHER', label: 'xx' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const otherManager = await sessionUserFor(tenantId, 'MANAGER');
    await expect(getClientChecklist(otherManager, clientId, { period: Q3 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(removeChecklistItem(otherManager, result.items[0]!.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  describe('tenant overview', () => {
    let supervisor: SessionUser;
    let otherManager: SessionUser;

    beforeEach(async () => {
      supervisor = await sessionUserFor(tenantId, 'SUPERVISOR');
      otherManager = await sessionUserFor(tenantId, 'MANAGER');
      await prisma.client.update({
        where: { id: clientId },
        data: { legalName: 'Zeta (todo pendiente)' },
      });
      await ensureChecklist(tenantId, clientId, { period: Q3 });

      const done = await createClient(tenantId, {
        legalName: 'Alfa (al día)',
        assignedManagerId: otherManager.id,
        taxProfileId: await profileId('Particular · Solo Renta'),
      });
      await addChecklistItem(supervisor, done.id, Q3, {
        documentType: 'OTHER',
        label: 'Certificado de retenciones',
      });
      const item = await prisma.checklistItem.findFirstOrThrow({ where: { clientId: done.id } });
      await setChecklistItemFulfilled(supervisor, item.id, true);

      await createClient(tenantId, { legalName: 'Sin checklist' });
    });

    it('lists one row per client with a checklist, red first; managers only see their clients', async () => {
      const rows = await tenantOverview(supervisor, Q3, {}, '2026-10-15');
      expect(rows.map((row) => [row.legalName, row.light])).toEqual([
        ['Zeta (todo pendiente)', 'RED'],
        ['Alfa (al día)', 'GREEN'],
      ]);
      expect(rows[0]!.missing).toHaveLength(3);
      expect((await tenantOverview(manager, Q3)).map((row) => row.legalName)).toEqual([
        'Zeta (todo pendiente)',
      ]);
      expect(await tenantOverview(manager, Q3, { managerId: otherManager.id })).toHaveLength(1); // filter ignored
    });

    it('filters by manager and light, sorts by client, exports to CSV', async () => {
      expect(
        (await tenantOverview(supervisor, Q3, { managerId: otherManager.id })).map(
          (r) => r.legalName,
        ),
      ).toEqual(['Alfa (al día)']);
      expect(
        (await tenantOverview(supervisor, Q3, { light: 'AMBER' }, TODAY)).map((r) => r.legalName),
      ).toEqual(['Zeta (todo pendiente)']);
      const byClient = await tenantOverview(supervisor, Q3, { sort: 'client' }, TODAY);
      expect(byClient.map((r) => r.legalName)).toEqual(['Alfa (al día)', 'Zeta (todo pendiente)']);

      const csv = overviewCsv(byClient);
      expect(csv).toContain(
        'cliente;gestor;semaforo;pendientes;fecha_limite;documentacion_cerrada',
      );
      expect(csv).toContain('Zeta (todo pendiente)');
      expect(csv).toContain('Facturas emitidas | Facturas recibidas y gastos');
    });

    it('is closed to clients and to other tenants', async () => {
      const clientUser = await sessionUserFor(tenantId, 'CLIENT_USER', { clientIds: [clientId] });
      await expect(tenantOverview(clientUser, Q3)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const outsider = await sessionUserFor((await createTenant()).id, 'TENANT_ADMIN');
      expect(await tenantOverview(outsider, Q3)).toEqual([]);
    });
  });
});
