import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/modules/auth/permissions';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant } from '@tests/setup/factories';
import { unzipForTests } from '@tests/setup/unzip';
import { seedTenantWorld } from '@tests/setup/world';
import {
  cancelClientErasure,
  cancelTenant,
  purgeClient,
  purgeOldDocuments,
  purgeTenant,
  requestClientErasure,
  runGdprSweep,
  setRetentionYears,
} from './erasure';
import { exportUrlForToken, exportUrlForUser, requestExport, runExport } from './export';

// In-memory bucket shared by both storage modules.
const bucket = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock('@/lib/storage/objects', () => ({
  putObject: vi.fn(async (key: string, body: Uint8Array) => void bucket.set(key, body)),
  getObjectBytes: vi.fn(async (key: string) => bucket.get(key) ?? new Uint8Array([37, 80, 68, 70])),
}));
vi.mock('@/lib/storage/multipart', () => ({
  deleteObject: vi.fn(async (key: string) => void bucket.delete(key)),
  deletePrefix: vi.fn(async (prefix: string) => {
    for (const key of [...bucket.keys()]) if (key.startsWith(prefix)) bucket.delete(key);
  }),
  signedDownloadUrl: vi.fn(async (key: string) => `https://bucket.test/${key}?signed`),
}));
vi.mock('@/lib/queue', () => ({ enqueue: vi.fn(), QUEUES: { scheduled: 'scheduled' } }));

const tenantModels = Prisma.dmmf.datamodel.models.filter((model) =>
  model.fields.some((field) => field.name === 'tenantId'),
);
type Counter = { count(args: object): Promise<number> };
const countOf = (model: string, tenantId: string) =>
  (prisma as unknown as Record<string, Counter>)[
    model.charAt(0).toLowerCase() + model.slice(1)
  ]!.count({ where: { tenantId } });

const asUser = (row: { id: string; tenantId: string | null }, role: SessionUser['role']) =>
  ({
    id: row.id,
    tenantId: row.tenantId,
    role,
    status: 'ACTIVE',
    clientIds: [],
    supportTenantIds: [],
  }) satisfies SessionUser;

const DAY = 86_400_000;

describe('GDPR operations', () => {
  let tenantId: string;
  let world: Awaited<ReturnType<typeof seedTenantWorld>>;
  let admin: SessionUser;

  beforeEach(async () => {
    await resetDb();
    bucket.clear();
    tenantId = (await createTenant({ slug: 'perez' })).id;
    world = await seedTenantWorld(tenantId);
    admin = asUser(world.admin, 'TENANT_ADMIN');
    await prisma.dataExport.deleteMany({});
  });

  describe('export', () => {
    it('only the tenant admin may ask for one', async () => {
      await expect(requestExport(asUser(world.manager, 'MANAGER'), null)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('exports a client as CSVs plus files, without secrets and without other clients', async () => {
      const other = await createClient(tenantId, { legalName: 'Otro Cliente SL' });
      await prisma.user.update({
        where: { id: world.clientUser.id },
        data: { passwordHash: 'scrypt$secret-hash' },
      });

      const job = await requestExport(admin, world.client.id);
      await runExport(job.id);

      const stored = await prisma.dataExport.findUniqueOrThrow({ where: { id: job.id } });
      expect(stored).toMatchObject({
        status: 'READY',
        storageKey: `${tenantId}/exports/${job.id}.zip`,
      });
      const files = unzipForTests(bucket.get(stored.storageKey!)!);
      const names = Object.keys(files);

      expect(names).toEqual(
        expect.arrayContaining(['datos/clients.csv', 'datos/documents.csv', 'datos/users.csv']),
      );
      expect(names.some((name) => name.startsWith('archivos/'))).toBe(true);
      expect(files['datos/clients.csv']).toContain(world.client.legalName);
      const everything = Object.values(files).join('\n');
      expect(everything).not.toContain(other.id);
      expect(everything).not.toContain('Otro Cliente SL');
      expect(everything).not.toContain('secret-hash');
      expect(files['datos/users.csv']).not.toContain('passwordHash');
    });

    it('hands out a signed URL through the emailed token or to the admin, and audits it', async () => {
      const job = await requestExport(admin, null);
      await runExport(job.id);

      const email = await prisma.emailLog.findFirstOrThrow({
        where: { templateKey: 'data.export_ready' },
      });
      const token = /token=([\w-]+)/.exec(email.bodyText ?? '')?.[1] ?? '';
      expect(await exportUrlForToken(token)).toContain(`${tenantId}/exports/${job.id}.zip`);
      expect(await exportUrlForUser(admin, job.id)).toContain('signed');
      await expect(exportUrlForToken('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await prisma.auditLog.count({ where: { action: 'data.export_download' } })).toBe(2);

      // Another tenant's admin gets nothing, and an expired export is gone for everybody.
      const stranger = await seedTenantWorld((await createTenant()).id);
      await expect(
        exportUrlForUser(asUser(stranger.admin, 'TENANT_ADMIN'), job.id),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await prisma.dataExport.update({
        where: { id: job.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await expect(exportUrlForToken(token)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect((await runGdprSweep()).exports).toBe(1);
      expect(bucket.has(`${tenantId}/exports/${job.id}.zip`)).toBe(false);
    });
  });

  describe('client erasure', () => {
    it('hides the client for 30 days, reversibly, and closes its users sessions', async () => {
      await prisma.userSession.create({
        data: { tenantId, userId: world.clientUser.id, expiresAt: new Date(Date.now() + DAY) },
      });
      const purgeAfter = await requestClientErasure(admin, world.client.id);

      expect(Math.round((purgeAfter.getTime() - Date.now()) / DAY)).toBe(30);
      expect(
        await prisma.userSession.count({ where: { userId: world.clientUser.id, revokedAt: null } }),
      ).toBe(0);
      expect((await runGdprSweep()).clients).toBe(0); // still inside the grace period

      await cancelClientErasure(admin, world.client.id);
      const client = await prisma.client.findUniqueOrThrow({ where: { id: world.client.id } });
      expect(client).toMatchObject({ deletedAt: null, purgeAfter: null });
    });

    it('after the grace period deletes rows and files, keeps invoices and anonymises its users', async () => {
      const files = await prisma.storedFile.findMany({ where: { tenantId } });
      for (const file of files) bucket.set(file.storageKey, new Uint8Array([1]));
      const invoices = await prisma.invoice.count({ where: { tenantId } });
      const documentFile = await prisma.document.findFirstOrThrow({
        where: { clientId: world.client.id },
        include: { file: true },
      });

      await requestClientErasure(admin, world.client.id);
      await prisma.client.update({
        where: { id: world.client.id },
        data: { purgeAfter: new Date(Date.now() - 1000) },
      });
      expect((await runGdprSweep()).clients).toBe(1);

      expect(await prisma.client.count({ where: { id: world.client.id } })).toBe(0);
      expect(await prisma.document.count({ where: { tenantId } })).toBe(0);
      expect(await prisma.thread.count({ where: { tenantId } })).toBe(0);
      expect(bucket.has(documentFile.file.storageKey)).toBe(false);
      expect(await prisma.invoice.count({ where: { tenantId, clientId: null } })).toBe(invoices);

      const ghost = await prisma.user.findUniqueOrThrow({ where: { id: world.clientUser.id } });
      expect(ghost).toMatchObject({ name: 'Usuario eliminado', status: 'DISABLED' });
      expect(ghost.email).not.toBe(world.clientUser.email);
    });

    it('is out of reach for managers and for other tenants', async () => {
      await expect(
        requestClientErasure(asUser(world.manager, 'MANAGER'), world.client.id),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const stranger = await seedTenantWorld((await createTenant()).id);
      await expect(
        requestClientErasure(asUser(stranger.admin, 'TENANT_ADMIN'), world.client.id),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(purgeClient(stranger.admin.tenantId!, world.client.id)).rejects.toThrow();
      expect(await prisma.client.count({ where: { id: world.client.id } })).toBe(1);
    });
  });

  describe('document retention', () => {
    it('deletes documents older than the retention period and old soft deletes, nothing else', async () => {
      const file = await prisma.storedFile.findFirstOrThrow({
        where: { id: world.document.fileId },
      });
      bucket.set(file.storageKey, new Uint8Array([1]));
      expect(await purgeOldDocuments(tenantId)).toBe(0);

      const sevenYearsAgo = new Date();
      sevenYearsAgo.setFullYear(sevenYearsAgo.getFullYear() - 7);
      await prisma.document.update({
        where: { id: world.document.id },
        data: { createdAt: sevenYearsAgo },
      });
      await setRetentionYears(admin, 10);
      expect(await purgeOldDocuments(tenantId)).toBe(0);
      await setRetentionYears(admin, 6);
      expect(await purgeOldDocuments(tenantId)).toBe(1);
      expect(bucket.has(file.storageKey)).toBe(false);
      expect(await prisma.storedFile.count({ where: { id: file.id } })).toBe(0);
      await expect(setRetentionYears(admin, 2)).rejects.toMatchObject({ code: 'VALIDATION' });
    });

    it('sweeps files nothing points at any more, once they are a month old', async () => {
      const make = (createdAt: Date) =>
        prisma.storedFile.create({
          data: {
            tenantId,
            kind: 'OBLIGATION_RECEIPT',
            status: 'CLEAN',
            storageKey: `${tenantId}/orphan-${createdAt.getTime()}`,
            originalName: 'justificante-antiguo.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1,
            createdAt,
          },
        });
      const old = await make(new Date(Date.now() - 40 * DAY));
      const recent = await make(new Date());
      bucket.set(old.storageKey, new Uint8Array([1]));
      const referenced = await prisma.storedFile.count({ where: { tenantId } });

      await purgeOldDocuments(tenantId);
      expect(bucket.has(old.storageKey)).toBe(false);
      expect(await prisma.storedFile.count({ where: { id: recent.id } })).toBe(1);
      expect(await prisma.storedFile.count({ where: { tenantId } })).toBe(referenced - 1);
    });
  });

  describe('tenant cancellation', () => {
    it('needs the slug typed, closes the portal, queues the export and schedules the purge', async () => {
      await expect(cancelTenant(admin, 'otra-cosa')).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(cancelTenant(asUser(world.manager, 'MANAGER'), 'perez')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });

      const purgeAfter = await cancelTenant(admin, 'perez');
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      expect(tenant.status).toBe('CANCELLED');
      expect(Math.round((purgeAfter.getTime() - Date.now()) / DAY)).toBe(30);
      expect(await prisma.userSession.count({ where: { tenantId, revokedAt: null } })).toBe(0);
      expect(
        await prisma.dataExport.count({ where: { tenantId, clientId: null, status: 'PENDING' } }),
      ).toBe(1);
      await expect(purgeTenant(tenantId)).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('physically deletes every row and object of the tenant after 30 days, and nobody else s', async () => {
      const neighbour = (await createTenant()).id;
      await seedTenantWorld(neighbour);
      const before = await Promise.all(tenantModels.map((model) => countOf(model.name, neighbour)));
      bucket.set(`${tenantId}/clients/x/file`, new Uint8Array([1]));
      bucket.set(`${neighbour}/clients/x/file`, new Uint8Array([1]));

      await cancelTenant(admin, 'perez');
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { purgeAfter: new Date(Date.now() - 1000) },
      });
      expect((await runGdprSweep()).tenants).toBe(1);

      for (const model of tenantModels) {
        expect(await countOf(model.name, tenantId), model.name).toBe(0);
      }
      expect(await prisma.tenant.count({ where: { id: tenantId } })).toBe(0);
      expect([...bucket.keys()]).toEqual([`${neighbour}/clients/x/file`]);
      expect(
        await Promise.all(tenantModels.map((model) => countOf(model.name, neighbour))),
      ).toEqual(before);
      expect(
        await prisma.auditLog.count({ where: { action: 'tenant.purged', entityId: tenantId } }),
      ).toBe(1);
    });
  });
});
