import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/modules/auth/permissions';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant } from '@tests/setup/factories';
import { sessionUserFor } from '@tests/setup/session';
import { abortUpload, completeUpload, initiateUpload, signPart, uploadStatus } from './uploads';

const storage = vi.hoisted(() => ({
  PART_SIZE: 5 * 1024 * 1024,
  createMultipartUpload: vi.fn(async () => 'upload-1'),
  presignPart: vi.fn(
    async (key: string, uploadId: string, part: number) => `https://s3.test/${key}?part=${part}`,
  ),
  listParts: vi.fn(),
  completeMultipartUpload: vi.fn(),
  abortMultipartUpload: vi.fn(),
  objectSize: vi.fn(),
  deleteObject: vi.fn(),
}));
const queue = vi.hoisted(() => ({ enqueue: vi.fn(), QUEUES: { files: 'files' } }));
vi.mock('@/lib/storage/multipart', () => storage);
vi.mock('@/lib/queue', () => queue);

const MB = 1024 * 1024;
const part = (partNumber: number) => ({ partNumber, etag: `"e${partNumber}"`, size: 5 * MB });

describe('document uploads', () => {
  let tenantId: string;
  let clientId: string;
  let clientUser: SessionUser;
  let manager: SessionUser;

  const request = (overrides = {}) => ({
    purpose: 'DOCUMENT' as const,
    clientId,
    fileName: 'factura.jpg',
    mimeType: 'image/jpeg' as const,
    sizeBytes: 2 * MB,
    documentType: 'RECEIVED_INVOICE' as const,
    period: { year: 2026, type: 'QUARTER' as const, ordinal: 3 },
    ...overrides,
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDb();
    tenantId = (await createTenant()).id;
    manager = await sessionUserFor(tenantId, 'MANAGER');
    clientId = (await createClient(tenantId, { assignedManagerId: manager.id })).id;
    clientUser = await sessionUserFor(tenantId, 'CLIENT_USER', { clientIds: [clientId] });
  });

  it('opens a multipart upload and keeps the chosen metadata on a hidden, pending document', async () => {
    const ticket = await initiateUpload(clientUser, request({ sizeBytes: 12 * MB }));
    expect(ticket).toMatchObject({ partSize: 5 * MB, partCount: 3, uploadedParts: [] });

    const document = await prisma.document.findFirstOrThrow({
      include: { file: true, period: true },
    });
    expect(document).toMatchObject({
      clientId,
      type: 'RECEIVED_INVOICE',
      source: 'WEB',
      uploadedById: clientUser.id,
    });
    expect(document.period).toMatchObject({ year: 2026, type: 'QUARTER', ordinal: 3 });
    expect(document.file).toMatchObject({
      status: 'PENDING',
      multipartUploadId: 'upload-1',
      kind: 'DOCUMENT',
    });
    expect(document.file.storageKey.startsWith(`${tenantId}/clients/${clientId}/`)).toBe(true);
  });

  it('enforces size and declared type before anything reaches the bucket', async () => {
    await expect(initiateUpload(clientUser, request({ sizeBytes: 21 * MB }))).rejects.toThrow(
      /20 MB/,
    );
    await expect(initiateUpload(clientUser, request({ sizeBytes: 0 }))).rejects.toThrow(/vacío/);
    await expect(
      initiateUpload(clientUser, request({ mimeType: 'application/zip' })),
    ).rejects.toThrow(/Solo se admiten/);
    expect(storage.createMultipartUpload).not.toHaveBeenCalled();
  });

  it('only lets users upload to clients they can reach', async () => {
    const otherClient = (await createClient(tenantId)).id;
    await expect(
      initiateUpload(clientUser, request({ clientId: otherClient })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(initiateUpload(manager, request({ clientId: otherClient }))).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );

    const foreign = (await createClient((await createTenant()).id)).id;
    await expect(initiateUpload(manager, request({ clientId: foreign }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(initiateUpload(manager, request())).resolves.toBeTruthy();
  });

  it('a closed period blocks the client, with an explanation, but not the manager', async () => {
    await initiateUpload(manager, request());
    const period = await prisma.period.findFirstOrThrow();
    await prisma.clientPeriod.create({
      data: { tenantId, clientId, periodId: period.id, status: 'CLOSED' },
    });

    await expect(initiateUpload(clientUser, request())).rejects.toMatchObject({
      code: 'FORBIDDEN',
      userMessage: expect.stringMatching(/periodo ya está cerrada/),
    });
    await expect(initiateUpload(clientUser, request({ period: null }))).resolves.toBeTruthy();
    await expect(initiateUpload(manager, request())).resolves.toBeTruthy();
  });

  it('DELINQUENT clients can still upload (§6.11)', async () => {
    await prisma.client.update({ where: { id: clientId }, data: { status: 'DELINQUENT' } });
    await expect(initiateUpload(clientUser, request())).resolves.toBeTruthy();
  });

  it('signs parts within range and reports what the bucket already has, for resuming', async () => {
    const { fileId } = await initiateUpload(clientUser, request({ sizeBytes: 12 * MB }));
    expect(await signPart(clientUser, fileId, 2)).toContain('part=2');
    await expect(signPart(clientUser, fileId, 4)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(signPart(clientUser, fileId, 0)).rejects.toMatchObject({ code: 'VALIDATION' });

    storage.listParts.mockResolvedValue([part(1), part(3)]);
    expect((await uploadStatus(clientUser, fileId)).uploadedParts).toEqual([1, 3]);
  });

  it("another client user cannot touch someone else's upload", async () => {
    const { fileId } = await initiateUpload(clientUser, request());
    const stranger = await sessionUserFor(tenantId, 'CLIENT_USER', { clientIds: [] });
    const attempts = [
      () => signPart(stranger, fileId, 1),
      () => completeUpload(stranger, fileId),
      () => abortUpload(stranger, fileId),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('completes: assembles, trusts the real size, queues processing once, audits', async () => {
    const { fileId } = await initiateUpload(clientUser, request());
    storage.listParts.mockResolvedValue([part(1)]);
    storage.objectSize.mockResolvedValue(1_900_000);

    await completeUpload(clientUser, fileId);
    await completeUpload(clientUser, fileId); // retry after a lost response

    expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(queue.enqueue).toHaveBeenCalledWith('files', 'process', { tenantId, fileId }, fileId);
    expect(await prisma.storedFile.findUniqueOrThrow({ where: { id: fileId } })).toMatchObject({
      status: 'UPLOADED',
      sizeBytes: 1_900_000,
      multipartUploadId: null,
    });
    expect(
      await prisma.auditLog.count({ where: { action: 'document.upload', entityId: fileId } }),
    ).toBe(1);
    expect(
      (await prisma.client.findUniqueOrThrow({ where: { id: clientId } })).lastActivityAt,
    ).not.toBeNull();
  });

  it('refuses to complete with missing parts', async () => {
    const { fileId } = await initiateUpload(clientUser, request({ sizeBytes: 12 * MB }));
    storage.listParts.mockResolvedValue([part(1), part(2)]);
    await expect(completeUpload(clientUser, fileId)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
  });

  it('discards files whose real size breaks the limit, whatever was declared', async () => {
    const { fileId } = await initiateUpload(clientUser, request({ sizeBytes: 1 * MB }));
    storage.listParts.mockResolvedValue([part(1)]);
    storage.objectSize.mockResolvedValue(25 * MB);

    await expect(completeUpload(clientUser, fileId)).rejects.toMatchObject({
      userMessage: expect.stringMatching(/20 MB/),
    });
    expect(storage.deleteObject).toHaveBeenCalled();
    expect(await prisma.document.count()).toBe(0);
    expect(await prisma.storedFile.count()).toBe(0);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('aborting removes every trace', async () => {
    const { fileId } = await initiateUpload(clientUser, request());
    await abortUpload(clientUser, fileId);
    expect(storage.abortMultipartUpload).toHaveBeenCalled();
    expect(await prisma.document.count()).toBe(0);
    expect(await prisma.storedFile.count()).toBe(0);
  });

  it('permanent documents: staff upload them, clients cannot', async () => {
    const permanent = {
      purpose: 'PERMANENT_DOCUMENT' as const,
      clientId,
      fileName: 'escritura.pdf',
      mimeType: 'application/pdf' as const,
      sizeBytes: 3 * MB,
      title: 'Escritura de constitución',
      category: 'DEED' as const,
      expiresAt: '2030-01-31',
    };
    await expect(initiateUpload(clientUser, permanent)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await initiateUpload(manager, permanent);
    const row = await prisma.permanentDocument.findFirstOrThrow({ include: { file: true } });
    expect(row).toMatchObject({ title: 'Escritura de constitución', category: 'DEED' });
    expect(row.expiresAt?.toISOString().slice(0, 10)).toBe('2030-01-31');
    expect(row.file.kind).toBe('PERMANENT_DOCUMENT');
  });
});
