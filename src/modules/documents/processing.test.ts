import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant, createUser, linkClientUser } from '@tests/setup/factories';
import { EICAR, fakeScanner } from './antivirus/fake';
import { processFile, type ProcessingDeps } from './processing';

const text = (value: string) => new TextEncoder().encode(value);
const PDF = text('%PDF-1.7 factura 2026/001');
const HEIC = new Uint8Array([0, 0, 0, 0x18, ...text('ftypheic'), 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);

describe('processFile', () => {
  let tenantId: string;
  let clientId: string;
  let bucket: Map<string, Uint8Array>;
  let deps: ProcessingDeps;

  const upload = async (bytes: Uint8Array, name = 'factura.pdf', client = clientId) => {
    const key = `k/${Math.random()}`;
    bucket.set(key, bytes);
    const file = await prisma.storedFile.create({
      data: {
        tenantId,
        kind: 'DOCUMENT',
        status: 'UPLOADED',
        storageKey: key,
        originalName: name,
        mimeType: 'application/octet-stream',
        sizeBytes: bytes.length,
      },
    });
    const document = await prisma.document.create({
      data: { tenantId, clientId: client, fileId: file.id },
    });
    return { fileId: file.id, documentId: document.id, key };
  };
  const reload = (fileId: string) =>
    prisma.storedFile.findUniqueOrThrow({ where: { id: fileId }, include: { document: true } });

  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    await resetDb();
    tenantId = (await createTenant()).id;
    clientId = (await createClient(tenantId)).id;
    await linkClientUser(tenantId, clientId, (await createUser(tenantId, 'CLIENT_USER')).id);
    bucket = new Map();
    deps = {
      getBytes: async (key) => bucket.get(key)!,
      putBytes: async (key, bytes) => void bucket.set(key, bytes),
      deleteObject: async (key) => void bucket.delete(key),
      convertHeicToJpeg: vi.fn(async () => JPEG),
      scanner: fakeScanner,
    };
  });

  it('marks a good file CLEAN with its real type, size and hash', async () => {
    const { fileId } = await upload(PDF);
    await processFile(tenantId, fileId, deps);
    const file = await reload(fileId);
    expect(file).toMatchObject({
      status: 'CLEAN',
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
      sha256: createHash('sha256').update(PDF).digest('hex'),
    });
    expect(file.scannedAt).not.toBeNull();
    expect(file.document?.status).toBe('RECEIVED');
  });

  it('blocks infected files: object removed, document rejected, client notified', async () => {
    const { fileId, key } = await upload(text(`%PDF-1.4 ${EICAR}`));
    await processFile(tenantId, fileId, deps);

    const file = await reload(fileId);
    expect(file.status).toBe('INFECTED');
    expect(bucket.has(key)).toBe(false);
    expect(file.document).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'Archivo bloqueado por seguridad',
    });
    expect(await prisma.notification.count({ where: { type: 'DOCUMENT_REJECTED' } })).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { action: 'file.infected', entityId: fileId } }),
    ).toBe(1);
  });

  it('rejects files that are not a photo or a PDF, whatever their name says', async () => {
    const { fileId, key } = await upload(text('MZ this is an executable'), 'factura.pdf');
    await processFile(tenantId, fileId, deps);
    const file = await reload(fileId);
    expect(file.status).not.toBe('CLEAN');
    expect(bucket.has(key)).toBe(false);
    expect(file.document).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'Formato de archivo no admitido',
    });
  });

  it('converts HEIC to JPEG and replaces the object', async () => {
    const { fileId, key } = await upload(HEIC, 'IMG_0042.HEIC');
    await processFile(tenantId, fileId, deps);
    const file = await reload(fileId);
    expect(file).toMatchObject({
      status: 'CLEAN',
      mimeType: 'image/jpeg',
      originalName: 'IMG_0042.jpg',
      sizeBytes: JPEG.length,
    });
    expect(bucket.has(key)).toBe(false);
    expect(bucket.get(file.storageKey)).toEqual(JPEG);
  });

  it('flags an exact duplicate within the same client, pointing at the first document', async () => {
    const first = await upload(PDF);
    const second = await upload(PDF, 'la-misma.pdf');
    await processFile(tenantId, first.fileId, deps);
    await processFile(tenantId, second.fileId, deps);

    expect((await reload(first.fileId)).document?.status).toBe('RECEIVED');
    expect((await reload(second.fileId)).document).toMatchObject({
      status: 'DUPLICATE',
      duplicateOfId: first.documentId,
    });
  });

  it('the same file for another client is not a duplicate', async () => {
    const other = (await createClient(tenantId)).id;
    const first = await upload(PDF);
    const second = await upload(PDF, 'factura.pdf', other);
    await processFile(tenantId, first.fileId, deps);
    await processFile(tenantId, second.fileId, deps);
    expect((await reload(second.fileId)).document?.status).toBe('RECEIVED');
  });

  it('is idempotent and ignores files of another tenant', async () => {
    const { fileId } = await upload(PDF);
    await processFile(tenantId, fileId, deps);
    const scan = vi.spyOn(deps.scanner, 'scan');
    await processFile(tenantId, fileId, deps);
    await processFile((await createTenant()).id, fileId, deps);
    expect(scan).not.toHaveBeenCalled();
  });

  it('a scanner failure leaves the file unserved and throws, so the job is retried', async () => {
    const { fileId } = await upload(PDF);
    deps.scanner = { scan: async () => Promise.reject(new Error('clamd down')) };
    await expect(processFile(tenantId, fileId, deps)).rejects.toThrow('clamd down');
    expect((await reload(fileId)).status).toBe('UPLOADED');
  });
});
