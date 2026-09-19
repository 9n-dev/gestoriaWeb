import { Prisma } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, tenantDb } from '@/lib/db';
import { listAudit } from '@/modules/audit/service';
import { loadSessionUser, completeLogin } from '@/modules/auth/service';
import type { SessionUser } from '@/modules/auth/permissions';
import { getDashboard } from '@/modules/checklists/dashboard';
import { getClientChecklist, tenantOverview } from '@/modules/checklists/service';
import {
  listClientObligations,
  listUpcomingObligations,
  startObligation,
} from '@/modules/obligations/workflow';
import { getClientFor, listAssignableManagers, listClientsFor } from '@/modules/clients/service';
import { listTaxProfiles } from '@/modules/clients/tax-profiles/service';
import { listPermanentDocuments } from '@/modules/documents/permanent';
import { listSavedViews } from '@/modules/documents/saved-views';
import {
  fileAccessUrl,
  getDocument,
  listClientDocuments,
  listInbox,
} from '@/modules/documents/service';
import { resetDb } from '@tests/setup/db';
import { createTenant } from '@tests/setup/factories';
import { seedTenantWorld } from '@tests/setup/world';

/**
 * CLAUDE.md §3: a user of tenant A cannot read, list or modify anything of tenant B.
 * Tenant B owns a full world of data; tenant A owns nothing, so anything A sees is a leak.
 * Every new service that returns tenant data gets a case in "services".
 */
const tenantModels = Prisma.dmmf.datamodel.models
  .filter((model) => model.fields.some((field) => field.name === 'tenantId'))
  .map((model) => model.name);

type Delegate = {
  findMany(args?: object): Promise<unknown[]>;
  count(args?: object): Promise<number>;
  updateMany(args: object): Promise<{ count: number }>;
  deleteMany(args?: object): Promise<{ count: number }>;
};
const delegate = (client: object, model: string) =>
  (client as Record<string, Delegate>)[model.charAt(0).toLowerCase() + model.slice(1)]!;

describe('tenant isolation', () => {
  let a: string;
  let b: string;
  let worldB: Awaited<ReturnType<typeof seedTenantWorld>>;
  let usersOfA: SessionUser[];

  beforeAll(async () => {
    await resetDb();
    a = (await createTenant()).id;
    b = (await createTenant()).id;
    worldB = await seedTenantWorld(b);
    usersOfA = (['CLIENT_USER', 'MANAGER', 'SUPERVISOR', 'TENANT_ADMIN'] as const).map((role) => ({
      id: `a-${role}`,
      tenantId: a,
      role,
      status: 'ACTIVE',
      // Forged links to B's data must not help.
      clientIds: [worldB.client.id],
      supportTenantIds: [],
    }));
  });

  describe('tenantDb', () => {
    it('covers every tenant-owned model in the fixture world', async () => {
      for (const model of tenantModels) {
        expect(
          await delegate(prisma, model).count({ where: { tenantId: b } }),
          model,
        ).toBeGreaterThan(0);
      }
    });

    it.each(tenantModels)('%s: tenant A cannot list or count rows of tenant B', async (model) => {
      expect(await delegate(tenantDb(a), model).findMany()).toEqual([]);
      expect(await delegate(tenantDb(a), model).findMany({ where: { tenantId: b } })).toEqual([]);
      expect(await delegate(tenantDb(a), model).count()).toBe(0);
    });

    it.each(tenantModels.filter((model) => model !== 'AuditLog'))(
      '%s: tenant A cannot modify or delete rows of tenant B',
      async (model) => {
        const before = await delegate(prisma, model).count({ where: { tenantId: b } });
        expect((await delegate(tenantDb(a), model).deleteMany()).count).toBe(0);
        expect(
          (await delegate(tenantDb(a), model).deleteMany({ where: { tenantId: b } })).count,
        ).toBe(0);
        expect(await delegate(prisma, model).count({ where: { tenantId: b } })).toBe(before);
      },
    );
  });

  describe('services', () => {
    it('clients: users of A never see B, even with forged client links', async () => {
      for (const user of usersOfA) {
        expect(await listClientsFor(user), user.role).toEqual([]);
        await expect(getClientFor(user, worldB.client.id), user.role).rejects.toMatchObject({
          code: 'NOT_FOUND',
        });
      }
    });

    it('tax profiles and staff: A sees neither the profiles nor the managers of B', async () => {
      const admin = usersOfA[3]!;
      expect((await listTaxProfiles(admin)).filter((profile) => profile.tenantId !== null)).toEqual(
        [],
      );
      expect(await listAssignableManagers(admin)).toEqual([]);
    });

    it('documents: no inbox row, document, file URL, permanent document or saved view of B', async () => {
      const file = await prisma.storedFile.findFirstOrThrow({
        where: { tenantId: b, kind: 'DOCUMENT' },
      });
      for (const user of usersOfA) {
        expect(await listClientDocuments(user, worldB.client.id), user.role).toEqual([]);
        await expect(getDocument(user, worldB.document.id), user.role).rejects.toMatchObject({
          code: 'NOT_FOUND',
        });
        await expect(
          fileAccessUrl(user, file.id, { inline: true }),
          user.role,
        ).rejects.toMatchObject({
          code: 'NOT_FOUND',
        });
        await expect(
          listPermanentDocuments(user, worldB.client.id),
          user.role,
        ).rejects.toMatchObject({
          code: 'NOT_FOUND',
        });
      }
      for (const staff of usersOfA.slice(1)) {
        expect(
          await listInbox(staff, {
            statuses: ['RECEIVED', 'IN_REVIEW', 'BOOKED', 'REJECTED', 'DUPLICATE'],
          }),
        ).toEqual([]);
        expect(await listSavedViews(staff)).toEqual([]);
      }
    });

    it('checklists, obligations and dashboard: nothing of B is visible or actionable from A', async () => {
      const obligation = await prisma.obligation.findFirstOrThrow({ where: { tenantId: b } });
      const period = { year: 2026, type: 'QUARTER' as const, ordinal: 3 };
      for (const user of usersOfA) {
        await expect(
          getClientChecklist(user, worldB.client.id, { period }),
          user.role,
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(
          listClientObligations(user, worldB.client.id),
          user.role,
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(startObligation(user, obligation.id), user.role).rejects.toMatchObject({
          code: 'NOT_FOUND',
        });
      }
      for (const staff of usersOfA.slice(1)) {
        expect(await tenantOverview(staff, period)).toEqual([]);
        expect(await listUpcomingObligations(staff, { days: 366 }, '2026-01-01')).toEqual([]);
        expect(await getDashboard(staff)).toMatchObject({
          redClients: 0,
          documentsToProcess: 0,
          deadlinesThisWeek: 0,
        });
      }
    });

    it('audit: the admin of A sees no entry of B', async () => {
      expect(await listAudit(usersOfA[3]!)).toEqual([]);
    });

    it('sessions: a session of B is not valid on the host of A', async () => {
      const session = await completeLogin(worldB.manager, 'password', {
        ip: null,
        userAgent: null,
      });
      expect(await loadSessionUser(session.id, a)).toBeNull();
      expect(await loadSessionUser(session.id, b)).not.toBeNull();
    });
  });

  describe('internal fields (§6.2)', () => {
    it('client users never receive internal notes, not even as a key', async () => {
      const user = (await loadSessionUser(
        (await completeLogin(worldB.clientUser, 'password', { ip: null, userAgent: null })).id,
        b,
      ))!;
      const [listed] = await listClientsFor(user);
      const fetched = await getClientFor(user, worldB.client.id);
      for (const client of [listed, fetched]) {
        expect(client).toBeDefined();
        expect(client).not.toHaveProperty('internalNotes');
        expect(JSON.stringify(client)).not.toContain('Paga tarde');
      }
    });

    it('managers see the internal notes of assigned clients only', async () => {
      const assigned: SessionUser = {
        ...usersOfA[1]!,
        id: worldB.manager.id,
        tenantId: b,
        clientIds: [],
      };
      expect(await getClientFor(assigned, worldB.client.id)).toHaveProperty('internalNotes');

      const other: SessionUser = { ...assigned, id: 'another-manager' };
      await expect(getClientFor(other, worldB.client.id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(await listClientsFor(other)).toEqual([]);
    });
  });
});
