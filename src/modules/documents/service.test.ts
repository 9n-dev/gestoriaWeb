import type { DocumentStatus, FileStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/modules/auth/permissions';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant, createUser, linkClientUser } from '@tests/setup/factories';
import { sessionUserFor } from '@tests/setup/session';
import { DEFAULT_REJECTION_REASONS } from './schema';
import {
  bookDocument,
  confirmFields,
  deleteDocument,
  fileAccessUrl,
  getDocument,
  listClientDocuments,
  listInbox,
  markDuplicate,
  rejectDocument,
  reopenDocument,
  updateDocumentFields,
  updateRejectionReasons,
} from './service';

vi.mock('@/lib/storage/multipart', () => ({
  signedDownloadUrl: vi.fn(
    async (key: string, name: string, mime: string, inline: boolean) =>
      `https://s3.test/${key}?signed&inline=${inline}`,
  ),
}));

let n = 0;
const addDocument = async (
  tenantId: string,
  clientId: string,
  options: { status?: DocumentStatus; fileStatus?: FileStatus; name?: string } = {},
) => {
  const file = await prisma.storedFile.create({
    data: {
      tenantId,
      kind: 'DOCUMENT',
      status: options.fileStatus ?? 'CLEAN',
      storageKey: `key-${++n}`,
      originalName: options.name ?? `factura-${n}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 1000,
    },
  });
  return prisma.document.create({
    data: { tenantId, clientId, fileId: file.id, status: options.status ?? 'RECEIVED' },
  });
};

const fields = (overrides = {}) => ({
  type: 'RECEIVED_INVOICE' as const,
  period: { year: 2026, type: 'QUARTER' as const, ordinal: 3 },
  supplierName: 'Suministros Levante SL',
  supplierTaxId: 'b-12345674',
  invoiceNumber: 'F-2026/118',
  invoiceDate: '2026-08-14',
  taxBase: '1.000,00',
  vatRate: '21',
  vatAmount: '210,00',
  total: '1.210,00',
  ...overrides,
});

describe('documents service', () => {
  let tenantId: string;
  let manager: SessionUser;
  let otherManager: SessionUser;
  let supervisor: SessionUser;
  let clientUser: SessionUser;
  let clientId: string;
  let otherClientId: string;

  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    await resetDb();
    tenantId = (await createTenant()).id;
    manager = await sessionUserFor(tenantId, 'MANAGER');
    otherManager = await sessionUserFor(tenantId, 'MANAGER');
    supervisor = await sessionUserFor(tenantId, 'SUPERVISOR');
    clientId = (await createClient(tenantId, { assignedManagerId: manager.id })).id;
    otherClientId = (await createClient(tenantId, { assignedManagerId: otherManager.id })).id;
    const person = await createUser(tenantId, 'CLIENT_USER');
    await linkClientUser(tenantId, clientId, person.id);
    clientUser = {
      id: person.id,
      tenantId,
      role: 'CLIENT_USER',
      status: 'ACTIVE',
      clientIds: [clientId],
      supportTenantIds: [],
    };
  });

  describe('inbox', () => {
    it('shows managers the pending documents of their clients, oldest first; leads see everything', async () => {
      const first = await addDocument(tenantId, clientId);
      const second = await addDocument(tenantId, clientId, { status: 'IN_REVIEW' });
      await addDocument(tenantId, clientId, { status: 'BOOKED' });
      const foreign = await addDocument(tenantId, otherClientId);
      await addDocument(tenantId, clientId, { fileStatus: 'PENDING' }); // upload never finished

      expect((await listInbox(manager)).map((d) => d.id)).toEqual([first.id, second.id]);
      expect((await listInbox(supervisor)).map((d) => d.id)).toEqual([
        first.id,
        second.id,
        foreign.id,
      ]);
      expect(
        (await listInbox(supervisor, { managerId: otherManager.id })).map((d) => d.id),
      ).toEqual([foreign.id]);
      expect((await listInbox(manager, { statuses: ['BOOKED'], order: 'newest' })).length).toBe(1);
    });

    it('a manager cannot widen the inbox with filters', async () => {
      await addDocument(tenantId, otherClientId);
      expect(await listInbox(manager, { managerId: otherManager.id })).toEqual([]);
      expect(await listInbox(manager, { clientId: otherClientId })).toEqual([]);
    });

    it('is closed to client users', async () => {
      await expect(listInbox(clientUser)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('workflow', () => {
    it('saving fields moves RECEIVED → IN_REVIEW, normalizes NIF and Spanish amounts', async () => {
      const document = await addDocument(tenantId, clientId);
      await updateDocumentFields(manager, document.id, fields());
      const saved = await getDocument(manager, document.id);
      expect(saved).toMatchObject({
        status: 'IN_REVIEW',
        supplierTaxId: 'B12345674',
        type: 'RECEIVED_INVOICE',
      });
      expect(Number(saved.total)).toBe(1210);
      expect(saved.period).toEqual({ year: 2026, type: 'QUARTER', ordinal: 3 });
      await expect(
        updateDocumentFields(manager, document.id, fields({ supplierTaxId: 'B12345675' })),
      ).rejects.toThrow(/NIF/);
    });

    it('several VAT rates: the rows are the truth and the totals follow them; one row is just the totals', async () => {
      const document = await addDocument(tenantId, clientId);
      await updateDocumentFields(manager, document.id, {
        ...fields({ taxBase: '', vatRate: '', vatAmount: '', total: '112,20' }),
        vatBreakdown: [
          { rate: '10', base: '80,00', vat: '8,00' },
          { rate: '21', base: '20', vat: '4,2' },
          { rate: '', base: '', vat: '' }, // an empty row left in the form
        ],
      });
      const saved = await getDocument(manager, document.id);
      expect(Number(saved.taxBase)).toBe(100);
      expect(Number(saved.vatAmount)).toBe(12.2);
      expect(Number(saved.vatRate)).toBe(10); // the rate with the largest base
      expect(saved.vatBreakdown).toEqual([
        { rate: 10, base: 80, vat: 8 },
        { rate: 21, base: 20, vat: 4.2 },
      ]);

      await updateDocumentFields(manager, document.id, {
        ...fields(),
        vatBreakdown: [{ rate: '21', base: '1.000,00', vat: '210,00' }],
      });
      const single = await getDocument(manager, document.id);
      expect(single.vatBreakdown).toBeNull();
      expect(Number(single.taxBase)).toBe(1000);
    });

    it('books, rejects, marks duplicates and reopens, stamping who and when', async () => {
      const document = await addDocument(tenantId, clientId);
      await confirmFields(manager, document.id);
      await bookDocument(manager, document.id);
      let row = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
      expect(row).toMatchObject({
        status: 'BOOKED',
        processedById: manager.id,
        extractionConfirmed: true,
      });
      expect(row.processedAt).not.toBeNull();

      await reopenDocument(manager, document.id);
      row = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
      expect(row).toMatchObject({ status: 'IN_REVIEW', processedById: null, processedAt: null });

      await markDuplicate(manager, document.id);
      expect((await getDocument(manager, document.id)).status).toBe('DUPLICATE');

      const actions = (await prisma.auditLog.findMany({ where: { entityId: document.id } })).map(
        (a) => a.action,
      );
      expect(actions).toEqual(
        expect.arrayContaining(['document.booked', 'document.in_review', 'document.duplicate']),
      );
    });

    it('rejecting needs a reason from the tenant list and notifies the client at once', async () => {
      const document = await addDocument(tenantId, clientId, { name: 'ticket-borroso.jpg' });
      await expect(
        rejectDocument(manager, document.id, { reason: 'Porque sí', note: '' }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });

      await rejectDocument(manager, document.id, {
        reason: DEFAULT_REJECTION_REASONS[0]!,
        note: 'No se ve el total',
      });

      expect(await getDocument(clientUser, document.id)).toMatchObject({
        status: 'REJECTED',
        rejectionReason: DEFAULT_REJECTION_REASONS[0],
        rejectionNote: 'No se ve el total',
      });
      const notification = await prisma.notification.findFirstOrThrow({
        where: { userId: clientUser.id },
      });
      expect(notification).toMatchObject({ type: 'DOCUMENT_REJECTED', link: '/documentos' });
      expect(notification.title).toContain('ticket-borroso.jpg');
      const email = await prisma.emailLog.findFirstOrThrow();
      expect(email.bodyText).toContain('No se ve el total');
    });

    it('the admin edits the list of rejection reasons', async () => {
      const admin = await sessionUserFor(tenantId, 'TENANT_ADMIN');
      await updateRejectionReasons(admin, ['Foto movida', 'Falta la segunda página']);
      const document = await addDocument(tenantId, clientId);
      await expect(
        rejectDocument(manager, document.id, { reason: 'Foto movida' }),
      ).resolves.toBeUndefined();
      await expect(updateRejectionReasons(manager, ['x y z'])).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(updateRejectionReasons(admin, [])).rejects.toThrow();
    });

    it('nothing can be processed until the file is CLEAN', async () => {
      const document = await addDocument(tenantId, clientId, { fileStatus: 'UPLOADED' });
      for (const act of [
        () => bookDocument(manager, document.id),
        () => updateDocumentFields(manager, document.id, fields()),
      ]) {
        await expect(act()).rejects.toMatchObject({ code: 'CONFLICT' });
      }
    });

    it('managers only process documents of their assigned clients; clients never', async () => {
      const foreign = await addDocument(tenantId, otherClientId);
      await expect(bookDocument(manager, foreign.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(bookDocument(supervisor, foreign.id)).resolves.toBeUndefined();

      const mine = await addDocument(tenantId, clientId);
      await expect(bookDocument(clientUser, mine.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('duplicate detection by invoice data (§6.3)', () => {
    it('flags same supplier NIF + number + date within the client, without closing the document', async () => {
      const original = await addDocument(tenantId, clientId);
      const again = await addDocument(tenantId, clientId);
      await updateDocumentFields(manager, original.id, fields());

      const result = await updateDocumentFields(
        manager,
        again.id,
        fields({ invoiceNumber: 'f-2026/118', total: '1210' }),
      );

      expect(result.possibleDuplicateOfId).toBe(original.id);
      expect(await getDocument(manager, again.id)).toMatchObject({
        status: 'IN_REVIEW',
        duplicateOfId: original.id,
      });
    });

    it('does not flag a different number, date, supplier or client', async () => {
      const original = await addDocument(tenantId, clientId);
      await updateDocumentFields(manager, original.id, fields());
      const variants = [
        { invoiceNumber: 'F-2026/119' },
        { invoiceDate: '2026-08-15' },
        { supplierTaxId: '12345678Z' },
        { supplierTaxId: '' },
      ];
      for (const variant of variants) {
        const document = await addDocument(tenantId, clientId);
        expect(
          (await updateDocumentFields(manager, document.id, fields(variant))).possibleDuplicateOfId,
        ).toBeNull();
      }
      const elsewhere = await addDocument(tenantId, otherClientId);
      expect(
        (await updateDocumentFields(otherManager, elsewhere.id, fields())).possibleDuplicateOfId,
      ).toBeNull();
    });

    it('ignores rejected originals and clears the flag when the data is corrected', async () => {
      const original = await addDocument(tenantId, clientId);
      await updateDocumentFields(manager, original.id, fields());
      const again = await addDocument(tenantId, clientId);
      await updateDocumentFields(manager, again.id, fields());
      await updateDocumentFields(manager, again.id, fields({ invoiceNumber: 'F-2026/200' }));
      expect((await getDocument(manager, again.id)).duplicateOfId).toBeNull();

      await rejectDocument(manager, original.id, { reason: DEFAULT_REJECTION_REASONS[0]! });
      expect(
        (await updateDocumentFields(manager, again.id, fields())).possibleDuplicateOfId,
      ).toBeNull();
    });
  });

  describe('client side', () => {
    it('clients list their own documents and withdraw them only while RECEIVED', async () => {
      const fresh = await addDocument(tenantId, clientId);
      const booked = await addDocument(tenantId, clientId, { status: 'BOOKED' });
      await addDocument(tenantId, otherClientId);

      expect((await listClientDocuments(clientUser, clientId)).map((d) => d.id).sort()).toEqual(
        [fresh.id, booked.id].sort(),
      );
      expect(await listClientDocuments(clientUser, otherClientId)).toEqual([]);

      await expect(deleteDocument(clientUser, booked.id)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await deleteDocument(clientUser, fresh.id);
      await expect(getDocument(clientUser, fresh.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('file access', () => {
    const meta = { inline: false, ip: '203.0.113.9', userAgent: 'vitest' };

    it('hands out a signed URL after auditing who downloaded what', async () => {
      const document = await addDocument(tenantId, clientId);
      const url = await fileAccessUrl(clientUser, document.fileId, meta);
      expect(url).toContain('signed');
      expect(
        await prisma.auditLog.findFirstOrThrow({ where: { action: 'file.download' } }),
      ).toMatchObject({
        actorId: clientUser.id,
        entity: 'Document',
        entityId: document.id,
        ip: '203.0.113.9',
      });
      await fileAccessUrl(manager, document.fileId, { ...meta, inline: true });
      expect(
        await prisma.auditLog.count({ where: { action: 'file.view', actorId: manager.id } }),
      ).toBe(1);
    });

    it('never serves files that are not CLEAN', async () => {
      for (const fileStatus of ['UPLOADED', 'INFECTED'] as const) {
        const document = await addDocument(tenantId, clientId, { fileStatus });
        await expect(fileAccessUrl(manager, document.fileId, meta)).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
      }
    });

    it('DELINQUENT clients cannot download; their manager can', async () => {
      const document = await addDocument(tenantId, clientId);
      await prisma.client.update({ where: { id: clientId }, data: { status: 'DELINQUENT' } });
      await expect(fileAccessUrl(clientUser, document.fileId, meta)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(fileAccessUrl(manager, document.fileId, meta)).resolves.toContain('signed');
    });

    it('does not reveal files of other clients or tenants, nor non-document files', async () => {
      const foreign = await addDocument(tenantId, otherClientId);
      await expect(fileAccessUrl(clientUser, foreign.fileId, meta)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(fileAccessUrl(manager, foreign.fileId, meta)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      const outsider = await sessionUserFor((await createTenant()).id, 'TENANT_ADMIN');
      await expect(fileAccessUrl(outsider, foreign.fileId, meta)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      const logo = await prisma.storedFile.create({
        data: {
          tenantId,
          kind: 'BRANDING',
          status: 'CLEAN',
          storageKey: 'logo',
          originalName: 'l.png',
          mimeType: 'image/png',
          sizeBytes: 1,
        },
      });
      await expect(fileAccessUrl(supervisor, logo.id, meta)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });
});
