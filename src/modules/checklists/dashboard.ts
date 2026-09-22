import { cached } from '@/lib/cache';
import { tenantDb } from '@/lib/db';
import { addDays, toDateOnly, todayInMadrid, type IsoDate } from '@/lib/dates';
import {
  assertCan,
  can,
  requireTenantId,
  scopeFor,
  type SessionUser,
} from '@/modules/auth/permissions';
import { collectingPeriod } from './light';
import { tenantOverview } from './service';

export type Dashboard = {
  redClients: number;
  amberClients: number;
  documentsToProcess: number;
  deadlinesThisWeek: number;
  averageProcessingHours: number | null;
  /** Only for supervisors and admins. */
  loadPerManager: Array<{
    managerName: string;
    clients: number;
    documentsToProcess: number;
  }> | null;
};

/** §6.10 dashboard. Managers get the numbers of their own clients; leads, of the whole gestoría. */
export async function getDashboard(
  user: SessionUser,
  today: IsoDate = todayInMadrid(),
): Promise<Dashboard> {
  assertCan(user, 'dashboard.viewOwn');
  // The numbers change slowly and every visit to /panel asked for all of them: a minute of cache
  // per user (the scope is theirs) keeps the page instant for a busy gestoría.
  return cached(`dashboard:${user.tenantId}:${user.id}:${today}`, 60, () =>
    computeDashboard(user, today),
  );
}

async function computeDashboard(user: SessionUser, today: IsoDate): Promise<Dashboard> {
  const db = tenantDb(requireTenantId(user));
  const ownOnly = scopeFor(user, 'document.process') === 'assigned';
  const client = { deletedAt: null, assignedManagerId: ownOnly ? user.id : undefined };
  const pending = {
    deletedAt: null,
    status: { in: ['RECEIVED', 'IN_REVIEW'] as const },
    file: { status: { not: 'PENDING' as const } },
  };

  const [quarterly, monthly, documentsToProcess, deadlinesThisWeek, processed] = await Promise.all([
    tenantOverview(user, collectingPeriod(today, 'QUARTER'), {}, today),
    // Clients with monthly VAT have monthly checklists: they count in their own period.
    tenantOverview(user, collectingPeriod(today, 'MONTH'), {}, today),
    db.document.count({ where: { ...pending, status: { in: ['RECEIVED', 'IN_REVIEW'] }, client } }),
    db.obligation.count({
      where: {
        status: { not: 'FILED' },
        dueDate: { gte: toDateOnly(today), lte: toDateOnly(addDays(today, 7)) },
        client,
      },
    }),
    db.document.findMany({
      where: { processedAt: { gte: toDateOnly(addDays(today, -30)) }, client },
      select: { createdAt: true, processedAt: true },
      take: 2000,
    }),
  ]);

  const hours = processed.map(
    (d) => (d.processedAt!.getTime() - d.createdAt.getTime()) / 3_600_000,
  );
  let loadPerManager: Dashboard['loadPerManager'] = null;
  if (can(user, 'dashboard.viewGlobal')) {
    const managers = await db.user.findMany({
      where: { assignedClients: { some: { deletedAt: null } } },
      select: {
        name: true,
        assignedClients: {
          where: { deletedAt: null },
          select: {
            _count: {
              select: {
                documents: { where: { ...pending, status: { in: ['RECEIVED', 'IN_REVIEW'] } } },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    loadPerManager = managers.map((manager) => ({
      managerName: manager.name,
      clients: manager.assignedClients.length,
      documentsToProcess: manager.assignedClients.reduce((sum, c) => sum + c._count.documents, 0),
    }));
  }

  const overview = [...quarterly, ...monthly];
  return {
    redClients: overview.filter((row) => row.light === 'RED').length,
    amberClients: overview.filter((row) => row.light === 'AMBER').length,
    documentsToProcess,
    deadlinesThisWeek,
    averageProcessingHours: hours.length
      ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10
      : null,
    loadPerManager,
  };
}
