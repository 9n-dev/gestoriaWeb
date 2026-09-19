import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/modules/auth/permissions';
import { fileAccessUrl } from '@/modules/documents/service';
import { initiateUpload } from '@/modules/documents/uploads';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant, createUser, linkClientUser } from '@tests/setup/factories';
import { sessionUserFor } from '@tests/setup/session';
import {
  announceDeliveries,
  deleteDelivery,
  deliveryHistory,
  listDeliveries,
  signDelivery,
} from './service';

const putObject = vi.hoisted(() => vi.fn());
vi.mock('@/lib/storage/objects', () => ({ putObject }));
vi.mock('@/lib/storage/multipart', () => ({
  PART_SIZE: 5 * 1024 * 1024,
  createMultipartUpload: vi.fn(async () => 'u'),
  signedDownloadUrl: vi.fn(async () => 'https://s3.test/signed'),
}));
vi.mock('@/lib/queue', () => ({ enqueue: vi.fn(), QUEUES: { files: 'files' } }));

const meta = { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 (iPhone)' };
const SHA = createHash('sha256').update('modelo 303').digest('hex');

describe('deliveries and simple signature', () => {
  let tenantId: string;
  let clientId: string;
  let manager: SessionUser;
  let clientUser: SessionUser;

  /** A delivery whose file the worker has already cleaned. */
  const deliver = async (overrides: { requiresSignature?: boolean; visibleFrom?: string } = {}) => {
    const { fileId } = await initiateUpload(manager, {
      purpose: 'DELIVERY',
      clientId,
      fileName: 'modelo-303.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 5000,
      title: 'Modelo 303 · 3T 2026',
      category: 'FILED_FORM',
      period: { year: 2026, type: 'QUARTER', ordinal: 3 },
      visibleFrom: overrides.visibleFrom ?? '',
      requiresSignature: overrides.requiresSignature ?? false,
    });
    await prisma.storedFile.update({
      where: { id: fileId },
      data: { status: 'CLEAN', sha256: SHA },
    });
    const delivery = await prisma.delivery.findFirstOrThrow({ where: { fileId } });
    return { id: delivery.id, fileId };
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    await resetDb();
    tenantId = (await createTenant({ name: 'Gestoría Pérez' })).id;
    manager = await sessionUserFor(tenantId, 'MANAGER');
    clientId = (
      await createClient(tenantId, {
        assignedManagerId: manager.id,
        legalName: 'Marta Soler',
        taxId: '12345678Z',
      })
    ).id;
    const marta = await createUser(tenantId, 'CLIENT_USER', {
      name: 'Marta Soler',
      email: 'marta@example.com',
    });
    await linkClientUser(tenantId, clientId, marta.id);
    clientUser = { ...manager, id: marta.id, role: 'CLIENT_USER', clientIds: [clientId] };
  });

  it('only staff deliver; the client is told once the file is clean, exactly once', async () => {
    await expect(
      initiateUpload(clientUser, {
        purpose: 'DELIVERY',
        clientId,
        fileName: 'x.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        title: 'Intento',
        period: '',
        visibleFrom: '',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const { id } = await deliver();
    expect(await announceDeliveries(tenantId)).toBe(1);
    expect(await announceDeliveries(tenantId)).toBe(0);
    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId: clientUser.id },
    });
    expect(notification).toMatchObject({ type: 'DELIVERY_AVAILABLE', link: `/entregas/${id}` });
  });

  it('stays invisible to the client until visibleFrom; staff always see it', async () => {
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const { fileId } = await deliver({ visibleFrom: future });

    expect(await listDeliveries(clientUser, clientId)).toEqual([]);
    expect(await listDeliveries(manager, clientId)).toHaveLength(1);
    await expect(fileAccessUrl(clientUser, fileId, { inline: true })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await announceDeliveries(tenantId)).toBe(0);

    await prisma.delivery.updateMany({ data: { visibleFrom: new Date(Date.now() - 1000) } });
    expect(await listDeliveries(clientUser, clientId)).toHaveLength(1);
    expect(await announceDeliveries(tenantId)).toBe(1);
  });

  it('signing stores the evidence, attaches a certificate with the file hash and notifies the gestoría', async () => {
    const { id } = await deliver({ requiresSignature: true });
    await announceDeliveries(tenantId);
    expect(
      (await prisma.notification.findFirstOrThrow({ where: { userId: clientUser.id } })).type,
    ).toBe('SIGNATURE_REQUESTED');

    await expect(signDelivery(clientUser, id, false, meta)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await signDelivery(clientUser, id, true, meta);

    const signed = await prisma.delivery.findUniqueOrThrow({
      where: { id },
      include: { certificateFile: true },
    });
    expect(signed).toMatchObject({
      signedById: clientUser.id,
      signatureIp: meta.ip,
      signatureUserAgent: meta.userAgent,
      signedFileHash: SHA,
    });
    expect(signed.signedAt).not.toBeNull();
    expect(signed.certificateFile).toMatchObject({
      kind: 'SIGNATURE_CERTIFICATE',
      status: 'CLEAN',
      mimeType: 'application/pdf',
    });

    const pdf = Buffer.from(putObject.mock.calls.at(-1)![1] as Uint8Array).toString('latin1');
    expect(pdf.startsWith('%PDF-')).toBe(true);
    for (const expected of [
      SHA,
      'Marta Soler',
      '12345678Z',
      'marta@example.com',
      meta.ip,
      'Modelo 303',
      'Gestor',
    ]) {
      expect(pdf, expected).toContain(expected);
    }
    expect(
      await prisma.notification.count({
        where: { userId: manager.id, title: { contains: 'ha firmado' } },
      }),
    ).toBe(1);
    await expect(
      fileAccessUrl(clientUser, signed.certificateFileId!, { inline: false }),
    ).resolves.toContain('signed');
  });

  it('can be signed once, only by the client, and only when a signature was asked for', async () => {
    const { id } = await deliver({ requiresSignature: true });
    await expect(signDelivery(manager, id, true, meta)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await signDelivery(clientUser, id, true, meta);
    await expect(signDelivery(clientUser, id, true, meta)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(deleteDelivery(manager, id)).rejects.toMatchObject({ code: 'CONFLICT' });

    const plain = await deliver();
    await expect(signDelivery(clientUser, plain.id, true, meta)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('cannot be signed before the file has been scanned and hashed', async () => {
    const { id, fileId } = await deliver({ requiresSignature: true });
    await prisma.storedFile.update({
      where: { id: fileId },
      data: { status: 'UPLOADED', sha256: null },
    });
    await expect(signDelivery(clientUser, id, true, meta)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('keeps a view/download/signature history for staff', async () => {
    const { id, fileId } = await deliver({ requiresSignature: true });
    await fileAccessUrl(clientUser, fileId, { inline: true, ...meta });
    await fileAccessUrl(clientUser, fileId, { inline: false, ...meta });
    await signDelivery(clientUser, id, true, meta);

    const history = await deliveryHistory(manager, id);
    expect(history.map((entry) => entry.action)).toEqual([
      'delivery.sign',
      'file.download',
      'file.view',
    ]);
    expect(history[0]).toMatchObject({ actorName: 'Marta Soler', ip: meta.ip });
    await expect(deliveryHistory(clientUser, id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('DELINQUENT clients see their deliveries but cannot download them; other clients see nothing', async () => {
    const { id, fileId } = await deliver();
    await prisma.client.update({ where: { id: clientId }, data: { status: 'DELINQUENT' } });
    expect(await listDeliveries(clientUser, clientId)).toHaveLength(1);
    await expect(fileAccessUrl(clientUser, fileId, { inline: true })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const stranger = await sessionUserFor(tenantId, 'CLIENT_USER', { clientIds: [] });
    await expect(listDeliveries(stranger, clientId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(signDelivery(stranger, id, true, meta)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const otherManager = await sessionUserFor(tenantId, 'MANAGER');
    await expect(deleteDelivery(otherManager, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
