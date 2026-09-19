import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/modules/auth/permissions';
import { fileAccessUrl } from '@/modules/documents/service';
import { completeUpload, initiateUpload } from '@/modules/documents/uploads';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant, createUser, linkClientUser } from '@tests/setup/factories';
import { sessionUserFor } from '@tests/setup/session';
import { seedSystemData } from '../../../prisma/system-data';
import { syncObligationsForClient } from './service';
import {
  createObligation,
  deleteObligation,
  fileObligation,
  listClientObligations,
  listUpcomingObligations,
  reopenObligation,
  setEstimate,
  startObligation,
} from './workflow';

const storage = vi.hoisted(() => ({
  PART_SIZE: 5 * 1024 * 1024,
  createMultipartUpload: vi.fn(async () => 'u1'),
  listParts: vi.fn(async () => [{ partNumber: 1, etag: 'e', size: 10 }]),
  completeMultipartUpload: vi.fn(),
  objectSize: vi.fn(async () => 5000),
  signedDownloadUrl: vi.fn(async () => 'https://s3.test/signed'),
}));
vi.mock('@/lib/storage/multipart', () => storage);
vi.mock('@/lib/queue', () => ({ enqueue: vi.fn(), QUEUES: { files: 'files' } }));

const TODAY = '2026-09-19';

describe('obligation workflow', () => {
  let tenantId: string;
  let clientId: string;
  let manager: SessionUser;
  let clientUser: SessionUser;
  let vatQ3: string;

  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    await resetDb();
    await seedSystemData(prisma);
    tenantId = (await createTenant()).id;
    manager = await sessionUserFor(tenantId, 'MANAGER');
    const profile = await prisma.taxProfile.findFirstOrThrow({
      where: { name: 'Autónomo · Estimación directa' },
    });
    clientId = (
      await createClient(tenantId, { assignedManagerId: manager.id, taxProfileId: profile.id })
    ).id;
    await syncObligationsForClient(tenantId, clientId, { today: TODAY });
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
    vatQ3 = (
      await prisma.obligation.findFirstOrThrow({
        where: { clientId, model: '303', dueDate: new Date('2026-10-20') },
      })
    ).id;
  });

  it('PENDING_DOCS → IN_PROGRESS → FILED, with outcome, and the client is notified at once', async () => {
    await startObligation(manager, vatQ3);
    await expect(startObligation(manager, vatQ3)).rejects.toMatchObject({ code: 'CONFLICT' });
    await setEstimate(manager, vatQ3, '1.150,00');

    await fileObligation(manager, vatQ3, {
      result: 'TO_PAY',
      amount: '1.234,56',
      directDebit: true,
    });

    const filed = (await listClientObligations(clientUser, clientId)).find((o) => o.id === vatQ3)!;
    expect(filed).toMatchObject({ status: 'FILED', result: 'TO_PAY', directDebit: true });
    expect(Number(filed.resultAmount)).toBe(1234.56);
    expect(Number(filed.estimatedAmount)).toBe(1150);
    expect(filed.filedAt).not.toBeNull();

    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId: clientUser.id },
    });
    expect(notification).toMatchObject({ type: 'OBLIGATION_FILED', link: '/plazos' });
    expect(notification.title).toContain('modelo 303 (3T 2026)');
    expect(notification.body).toMatch(/a pagar 1\.234,56\s€.*domiciliado/);
  });

  it('validates the outcome: amount required unless the result is zero', async () => {
    await expect(fileObligation(manager, vatQ3, { result: 'TO_PAY', amount: '' })).rejects.toThrow(
      /importe/i,
    );
    await expect(
      fileObligation(manager, vatQ3, { result: 'TO_REFUND', amount: '-5' }),
    ).rejects.toThrow(/negativo/);
    await fileObligation(manager, vatQ3, { result: 'ZERO', amount: '300', directDebit: true });
    const row = await prisma.obligation.findUniqueOrThrow({ where: { id: vatQ3 } });
    expect(row).toMatchObject({ result: 'ZERO', directDebit: false });
    expect(Number(row.resultAmount)).toBe(0);
  });

  it('can be reopened to file a corrected return', async () => {
    await fileObligation(manager, vatQ3, { result: 'TO_REFUND', amount: '80' });
    await reopenObligation(manager, vatQ3);
    expect(await prisma.obligation.findUniqueOrThrow({ where: { id: vatQ3 } })).toMatchObject({
      status: 'IN_PROGRESS',
      filedAt: null,
    });
  });

  it('only staff with the client assigned can act; clients only read', async () => {
    const stranger = await sessionUserFor(tenantId, 'MANAGER');
    await expect(startObligation(stranger, vatQ3)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(startObligation(clientUser, vatQ3)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      fileObligation(clientUser, vatQ3, { result: 'ZERO', amount: '' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(listClientObligations(stranger, clientId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('receipt: uploaded through the pipeline, replaced by a newer one, downloadable once clean', async () => {
    const upload = {
      purpose: 'OBLIGATION_RECEIPT' as const,
      clientId,
      obligationId: vatQ3,
      fileName: 'justificante.pdf',
      mimeType: 'application/pdf' as const,
      sizeBytes: 5000,
    };
    await expect(initiateUpload(clientUser, upload)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const first = await initiateUpload(manager, upload);
    await completeUpload(manager, first.fileId);
    const second = await initiateUpload(manager, upload);
    await completeUpload(manager, second.fileId);

    const obligation = await prisma.obligation.findUniqueOrThrow({ where: { id: vatQ3 } });
    expect(obligation.receiptFileId).toBe(second.fileId);
    expect(
      (await prisma.storedFile.findUniqueOrThrow({ where: { id: first.fileId } })).deletedAt,
    ).not.toBeNull();

    const meta = { inline: false };
    await expect(fileAccessUrl(clientUser, second.fileId, meta)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    }); // not scanned yet
    await prisma.storedFile.update({ where: { id: second.fileId }, data: { status: 'CLEAN' } });
    await expect(fileAccessUrl(clientUser, second.fileId, meta)).resolves.toContain('signed');
    await expect(fileAccessUrl(clientUser, first.fileId, meta)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    await prisma.client.update({ where: { id: clientId }, data: { status: 'DELINQUENT' } });
    await expect(fileAccessUrl(clientUser, second.fileId, meta)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(fileAccessUrl(manager, second.fileId, meta)).resolves.toContain('signed');
  });

  it('a receipt cannot be attached to an obligation of another client', async () => {
    const other = await createClient(tenantId, { assignedManagerId: manager.id });
    await expect(
      initiateUpload(manager, {
        purpose: 'OBLIGATION_RECEIPT',
        clientId: other.id,
        obligationId: vatQ3,
        fileName: 'j.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await prisma.storedFile.count()).toBe(0);
  });

  it('manual obligations take their deadline from the calendar; untouched ones can be removed', async () => {
    await createObligation(manager, clientId, {
      model: '349',
      period: { year: 2026, type: 'QUARTER', ordinal: 3 },
    });
    const created = await prisma.obligation.findFirstOrThrow({ where: { clientId, model: '349' } });
    expect(created.dueDate.toISOString().slice(0, 10)).toBe('2026-10-20');

    await expect(
      createObligation(manager, clientId, {
        model: '349',
        period: { year: 2026, type: 'QUARTER', ordinal: 3 },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      createObligation(manager, clientId, {
        model: '999',
        period: { year: 2026, type: 'QUARTER', ordinal: 3 },
      }),
    ).rejects.toThrow();
    await expect(
      createObligation(manager, clientId, {
        model: '390',
        period: { year: 2026, type: 'QUARTER', ordinal: 3 },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    await deleteObligation(manager, created.id);
    await startObligation(manager, vatQ3);
    await expect(deleteObligation(manager, vatQ3)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('upcoming list: next N days plus what is late, scoped by manager', async () => {
    const supervisor = await sessionUserFor(tenantId, 'SUPERVISOR');
    const otherManager = await sessionUserFor(tenantId, 'MANAGER');
    const theirs = await createClient(tenantId, {
      assignedManagerId: otherManager.id,
      taxProfileId: (
        await prisma.taxProfile.findFirstOrThrow({ where: { name: 'Sociedad limitada' } })
      ).id,
    });
    await syncObligationsForClient(tenantId, theirs.id, { today: TODAY });

    const mine = await listUpcomingObligations(manager, { days: 40 }, TODAY);
    expect(mine.map((o) => `${o.model}`).sort()).toEqual(['130', '303']);
    expect(mine.every((o) => o.clientId === clientId)).toBe(true);
    expect((await listUpcomingObligations(supervisor, { days: 40 }, TODAY)).length).toBe(3);
    expect(
      (
        await listUpcomingObligations(supervisor, { days: 40, managerId: otherManager.id }, TODAY)
      ).every((o) => o.clientId === theirs.id),
    ).toBe(true);

    // Late ones stay on the list until filed.
    const late = await listUpcomingObligations(manager, { days: 5 }, '2026-10-25');
    expect(late.map((o) => o.model).sort()).toEqual(['130', '303']);
    await fileObligation(manager, vatQ3, { result: 'ZERO', amount: '' });
    expect(
      (await listUpcomingObligations(manager, { days: 5 }, '2026-10-25')).map((o) => o.model),
    ).toEqual(['130']);

    await expect(listUpcomingObligations(clientUser)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
