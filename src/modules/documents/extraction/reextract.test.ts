import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/modules/auth/permissions';
import { resetDb } from '@tests/setup/db';
import { createTenant } from '@tests/setup/factories';
import { seedTenantWorld } from '@tests/setup/world';
import { requestReextraction } from './reextract';

const enqueue = vi.hoisted(() => vi.fn());
vi.mock('@/lib/queue', () => ({ enqueue, QUEUES: { files: 'files' } }));
vi.mock('@/lib/storage/multipart', () => ({ signedDownloadUrl: vi.fn() }));

describe('reading a document again', () => {
  let world: Awaited<ReturnType<typeof seedTenantWorld>>;
  let manager: SessionUser;
  const read = (data: object) => prisma.document.update({ where: { id: world.document.id }, data });

  beforeEach(async () => {
    await resetDb();
    enqueue.mockClear();
    const tenantId = (await createTenant()).id;
    world = await seedTenantWorld(tenantId);
    manager = {
      id: world.manager.id,
      tenantId,
      role: 'MANAGER',
      status: 'ACTIVE',
      clientIds: [],
      supportTenantIds: [],
    };
    await prisma.aiUsageLog.deleteMany({});
    await read({
      status: 'IN_REVIEW',
      extractionStatus: 'DONE',
      supplierTaxId: 'B12345674',
      total: 12.1,
      extractionConfirmed: true,
    });
  });

  it('discards the previous reading, queues a new one under a fresh job id and audits it', async () => {
    await requestReextraction(manager, world.document.id);
    const document = await prisma.document.findUniqueOrThrow({ where: { id: world.document.id } });
    expect(document).toMatchObject({
      extractionStatus: 'PENDING',
      extractionConfirmed: false,
      supplierTaxId: null,
      total: null,
    });
    expect(enqueue).toHaveBeenCalledWith(
      'files',
      'extract',
      { tenantId: world.client.tenantId, documentId: document.id },
      `extract_${document.id}_retry1`,
    );
    expect(await prisma.auditLog.count({ where: { action: 'document.reextract' } })).toBe(1);

    // While it is being read, asking again does nothing but explain.
    await expect(requestReextraction(manager, world.document.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('stops at three reads per document, leaves booked documents alone, and is for staff of that client only', async () => {
    await read({ status: 'BOOKED' });
    await expect(requestReextraction(manager, world.document.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    await read({ status: 'IN_REVIEW' });
    await prisma.aiUsageLog.createMany({
      data: [1, 2, 3].map(() => ({
        tenantId: world.client.tenantId,
        documentId: world.document.id,
        provider: 'test',
        model: 'test',
        inputTokens: 1,
        outputTokens: 1,
      })),
    });
    await expect(requestReextraction(manager, world.document.id)).rejects.toMatchObject({
      userMessage: expect.stringContaining('3 veces'),
    });

    const stranger = await seedTenantWorld((await createTenant()).id);
    const foreign: SessionUser = {
      ...manager,
      id: stranger.manager.id,
      tenantId: stranger.client.tenantId,
    };
    await expect(requestReextraction(foreign, world.document.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const client: SessionUser = {
      ...manager,
      id: world.clientUser.id,
      role: 'CLIENT_USER',
      clientIds: [world.client.id],
    };
    await expect(requestReextraction(client, world.document.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
