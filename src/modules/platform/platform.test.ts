import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant, createUser } from '@tests/setup/factories';
import { sessionUserFor } from '@tests/setup/session';
import { runCleanup } from './cleanup';
import { listFailedJobs, redactJobData, retryFailedJob } from './jobs';

const abortMultipartUpload = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/storage/multipart', () => ({ abortMultipartUpload }));
vi.mock('@/lib/queue', () => ({
  QUEUES: { files: 'files', scheduled: 'scheduled' },
  getQueue: () => ({
    getFailed: async () => [],
    getFailedCount: async () => 0,
    getJob: async () => null,
  }),
}));

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

describe('cleanup', () => {
  beforeEach(resetDb);

  it('removes dead sessions and tokens, keeps live ones', async () => {
    const tenant = await createTenant();
    const user = await createUser(tenant.id, 'MANAGER');
    const session = (expiresAt: Date, revokedAt?: Date) =>
      prisma.userSession.create({
        data: { tenantId: tenant.id, userId: user.id, expiresAt, revokedAt },
      });
    await session(daysAgo(10));
    await session(daysAgo(-1), daysAgo(9));
    const live = await session(daysAgo(-1));
    const recent = await session(daysAgo(2)); // expired, but within the week kept for the audit trail
    await prisma.verificationToken.createMany({
      data: [
        { identifier: 'a', token: 'old', expires: daysAgo(1) },
        { identifier: 'a', token: 'valid', expires: daysAgo(-1) },
      ],
    });

    expect(await runCleanup()).toMatchObject({ sessions: 2, tokens: 1 });
    expect((await prisma.userSession.findMany()).map((s) => s.id).sort()).toEqual(
      [live.id, recent.id].sort(),
    );
    expect((await prisma.verificationToken.findMany()).map((t) => t.token)).toEqual(['valid']);
  });

  it('removes sign-ups that never verified after a week, and nothing else', async () => {
    const stale = await createTenant({ status: 'PENDING_VERIFICATION', createdAt: daysAgo(8) });
    await createUser(stale.id, 'TENANT_ADMIN', { status: 'INVITED' });
    const fresh = await createTenant({ status: 'PENDING_VERIFICATION', createdAt: daysAgo(2) });
    const active = await createTenant({ createdAt: daysAgo(100) });

    expect((await runCleanup()).tenants).toBe(1);
    expect((await prisma.tenant.findMany()).map((t) => t.id).sort()).toEqual(
      [fresh.id, active.id].sort(),
    );
    expect(await prisma.user.count({ where: { tenantId: stale.id } })).toBe(0);
  });

  it('discards uploads abandoned for more than a day, aborting the multipart upload', async () => {
    const tenant = await createTenant();
    const client = await createClient(tenant.id);
    const pending = async (key: string, createdAt: Date) => {
      const file = await prisma.storedFile.create({
        data: {
          tenantId: tenant.id,
          kind: 'DOCUMENT',
          status: 'PENDING',
          storageKey: key,
          originalName: 'f',
          mimeType: 'image/jpeg',
          sizeBytes: 1,
          multipartUploadId: `u-${key}`,
          createdAt,
        },
      });
      await prisma.document.create({
        data: { tenantId: tenant.id, clientId: client.id, fileId: file.id },
      });
    };
    await pending('abandoned', daysAgo(2));
    await pending('in-progress', new Date());

    expect((await runCleanup()).uploads).toBe(1);
    expect(abortMultipartUpload).toHaveBeenCalledWith('abandoned', 'u-abandoned');
    expect((await prisma.storedFile.findMany()).map((f) => f.storageKey)).toEqual(['in-progress']);
    expect(await prisma.document.count()).toBe(1);
  });
});

describe('failed jobs panel', () => {
  it('shows identifiers only', () => {
    expect(
      redactJobData({
        tenantId: 't1',
        fileId: 'f1',
        today: '2026-10-13',
        email: 'marta@example.com',
        nested: { clientId: 'x' },
        count: 3,
      }),
    ).toEqual({ tenantId: 't1', fileId: 'f1', today: '2026-10-13' });
    expect(redactJobData(null)).toEqual({});
  });

  it('is for superadmins only', async () => {
    await resetDb();
    const admin = await sessionUserFor((await createTenant()).id, 'TENANT_ADMIN');
    await expect(listFailedJobs(admin)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(retryFailedJob(admin, 'files', '1')).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const root = await sessionUserFor(null, 'SUPERADMIN');
    expect(await listFailedJobs(root)).toEqual({ jobs: [], total: 0, page: 1, pages: 1 });
    await expect(retryFailedJob(root, 'nope', '1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(retryFailedJob(root, 'files', 'missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
