import type { DocumentType } from '@prisma/client';
import { z } from 'zod';
import { toCsv } from '@/lib/csv';
import { prisma, tenantDb } from '@/lib/db';
import { isoDate, todayInMadrid, type IsoDate } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { recordAudit } from '@/modules/audit/service';
import { assertCan, requireTenantId, scopeFor, type SessionUser } from '@/modules/auth/permissions';
import { loadForStaff, resourceOf } from '@/modules/clients/service';
import { DOCUMENT_TYPES } from '@/modules/documents/schema';
import { nominalChecklistDeadline, trafficLight, type Light, type PeriodRef } from './light';

import { ensureChecklist, ensurePeriod, labelOf, refreshChecklist } from './sync';

export { ensureChecklist, refreshChecklist } from './sync';

// ─────────────────────────── Reading ───────────────────────────

export type ClientChecklist = {
  period: PeriodRef & { id: string };
  items: Array<{
    id: string;
    label: string;
    documentType: DocumentType;
    fulfilled: boolean;
    manual: boolean;
    source: 'AUTO' | 'MANUAL';
  }>;
  missing: string[];
  deadline: IsoDate;
  light: Light;
  closed: boolean;
};

/** Earliest deadline of the client's obligations for the period; day 20 of the next month otherwise. */
async function checklistDeadline(
  tenantId: string,
  clientId: string,
  period: PeriodRef & { id: string },
): Promise<IsoDate> {
  const first = await tenantDb(tenantId).obligation.findFirst({
    where: { clientId, periodId: period.id },
    orderBy: { dueDate: 'asc' },
    select: { dueDate: true },
  });
  return first ? isoDate(first.dueDate) : nominalChecklistDeadline(period);
}

export async function getClientChecklist(
  user: SessionUser,
  clientId: string,
  options: { period?: PeriodRef; today?: IsoDate } = {},
): Promise<ClientChecklist | null> {
  const client = await loadForStaff(user, clientId);
  assertCan(user, 'checklist.read', resourceOf(client));
  const today = options.today ?? todayInMadrid();
  const periodId = await ensureChecklist(client.tenantId, clientId, { ...options, today });
  if (!periodId) return null;

  const db = tenantDb(client.tenantId);
  const [period, items, clientPeriod] = await Promise.all([
    prisma.period.findUniqueOrThrow({ where: { id: periodId } }),
    db.checklistItem.findMany({
      where: { clientId, periodId, dismissedAt: null },
      orderBy: { createdAt: 'asc' },
    }),
    db.clientPeriod.findFirst({ where: { clientId, periodId } }),
  ]);
  const missing = items.filter((item) => !item.fulfilled).map(labelOf);
  const deadline = await checklistDeadline(client.tenantId, clientId, period);
  return {
    period,
    items: items.map((item) => ({
      id: item.id,
      label: labelOf(item),
      documentType: item.documentType,
      fulfilled: item.fulfilled,
      manual: item.fulfilledManually,
      source: item.source,
    })),
    missing,
    deadline,
    light: trafficLight(missing.length, deadline, today),
    closed: clientPeriod?.status === 'CLOSED',
  };
}

// ─────────────────────────── Manager actions ───────────────────────────

const newItemSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  label: z.string().trim().min(2, 'Describe qué documento necesitas.').max(120),
});

async function manageable(user: SessionUser, clientId: string) {
  const client = await loadForStaff(user, clientId);
  assertCan(user, 'checklist.manage', resourceOf(client));
  return client;
}

export async function addChecklistItem(
  user: SessionUser,
  clientId: string,
  period: PeriodRef,
  input: z.input<typeof newItemSchema>,
): Promise<void> {
  const client = await manageable(user, clientId);
  const data = newItemSchema.parse(input);
  const { id: periodId } = await ensurePeriod(period);
  const item = await tenantDb(client.tenantId).checklistItem.create({
    data: { tenantId: client.tenantId, clientId, periodId, source: 'MANUAL', ...data },
  });
  await refreshChecklist(client.tenantId, clientId, [periodId]);
  await recordAudit({
    tenantId: client.tenantId,
    actor: user,
    action: 'checklist.addItem',
    entity: 'ChecklistItem',
    entityId: item.id,
    diff: data,
  });
}

async function loadItem(user: SessionUser, itemId: string) {
  const item = await tenantDb(requireTenantId(user)).checklistItem.findFirst({
    where: { id: itemId },
  });
  if (!item) throw new AppError('NOT_FOUND', 'No encontramos ese elemento de la lista.');
  await manageable(user, item.clientId);
  return item;
}

/** Removes an item. Automatic ones are kept as dismissed, so regeneration does not bring them back. */
export async function removeChecklistItem(user: SessionUser, itemId: string): Promise<void> {
  const item = await loadItem(user, itemId);
  const db = tenantDb(item.tenantId);
  if (item.source === 'AUTO')
    await db.checklistItem.update({ where: { id: itemId }, data: { dismissedAt: new Date() } });
  else await db.checklistItem.delete({ where: { id: itemId } });
  await recordAudit({
    tenantId: item.tenantId,
    actor: user,
    action: 'checklist.removeItem',
    entity: 'ChecklistItem',
    entityId: itemId,
  });
}

/** Manual tick ("this quarter there are no payrolls") or its removal, which returns the item to automatic. */
export async function setChecklistItemFulfilled(
  user: SessionUser,
  itemId: string,
  fulfilled: boolean,
): Promise<void> {
  const item = await loadItem(user, itemId);
  await tenantDb(item.tenantId).checklistItem.update({
    where: { id: itemId },
    data: { fulfilledManually: fulfilled, fulfilled, fulfilledAt: fulfilled ? new Date() : null },
  });
  if (!fulfilled) await refreshChecklist(item.tenantId, item.clientId, [item.periodId]);
  await recordAudit({
    tenantId: item.tenantId,
    actor: user,
    action: 'checklist.setFulfilled',
    entity: 'ChecklistItem',
    entityId: itemId,
    diff: { fulfilled },
  });
}

/** "Cerrar documentación": the client can no longer upload to this period until a manager reopens it. */
export async function setPeriodClosed(
  user: SessionUser,
  clientId: string,
  period: PeriodRef,
  closed: boolean,
): Promise<void> {
  const client = await loadForStaff(user, clientId);
  assertCan(user, closed ? 'period.close' : 'period.reopen', resourceOf(client));
  const { id: periodId } = await ensurePeriod(period);
  const data = closed
    ? { status: 'CLOSED' as const, closedAt: new Date(), closedById: user.id }
    : { status: 'OPEN' as const, closedAt: null, closedById: null };
  await tenantDb(client.tenantId).clientPeriod.upsert({
    where: { clientId_periodId: { clientId, periodId } },
    create: { tenantId: client.tenantId, clientId, periodId, ...data },
    update: data,
  });
  await recordAudit({
    tenantId: client.tenantId,
    actor: user,
    action: closed ? 'period.close' : 'period.reopen',
    entity: 'Client',
    entityId: clientId,
    diff: period,
  });
}

// ─────────────────────────── Tenant overview (§6.5) ───────────────────────────

export const overviewFiltersSchema = z.object({
  managerId: z.string().optional(),
  light: z.enum(['GREEN', 'AMBER', 'RED']).optional(),
  sort: z.enum(['light', 'client', 'deadline', 'manager']).default('light'),
});
export type OverviewFilters = z.input<typeof overviewFiltersSchema>;

export type OverviewRow = {
  clientId: string;
  legalName: string;
  managerName: string | null;
  light: Light;
  missing: string[];
  total: number;
  deadline: IsoDate;
  closed: boolean;
};

const LIGHT_ORDER: Record<Light, number> = { RED: 0, AMBER: 1, GREEN: 2 };

/** One row per client with a checklist in the period: managers see theirs, leads see everybody. */
export async function tenantOverview(
  user: SessionUser,
  period: PeriodRef,
  filters: OverviewFilters = {},
  today: IsoDate = todayInMadrid(),
): Promise<OverviewRow[]> {
  assertCan(user, 'dashboard.viewOwn');
  const { managerId, light, sort } = overviewFiltersSchema.parse(filters);
  const ownOnly = scopeFor(user, 'checklist.manage') === 'assigned';
  const { id: periodId } = await ensurePeriod(period);

  const clients = await tenantDb(requireTenantId(user)).client.findMany({
    where: {
      deletedAt: null,
      status: { not: 'INACTIVE' },
      assignedManagerId: ownOnly ? user.id : managerId,
      checklistItems: { some: { periodId, dismissedAt: null } },
    },
    select: {
      id: true,
      legalName: true,
      assignedManager: { select: { name: true } },
      checklistItems: {
        where: { periodId, dismissedAt: null },
        select: { fulfilled: true, label: true, documentType: true },
      },
      obligations: {
        where: { periodId },
        orderBy: { dueDate: 'asc' },
        take: 1,
        select: { dueDate: true },
      },
      periods: { where: { periodId }, select: { status: true } },
    },
  });

  const rows = clients.map((client): OverviewRow => {
    const missing = client.checklistItems.filter((item) => !item.fulfilled).map(labelOf);
    const deadline = client.obligations[0]
      ? isoDate(client.obligations[0].dueDate)
      : nominalChecklistDeadline(period);
    return {
      clientId: client.id,
      legalName: client.legalName,
      managerName: client.assignedManager?.name ?? null,
      light: trafficLight(missing.length, deadline, today),
      missing,
      total: client.checklistItems.length,
      deadline,
      closed: client.periods[0]?.status === 'CLOSED',
    };
  });

  const compare: Record<typeof sort, (a: OverviewRow, b: OverviewRow) => number> = {
    light: (a, b) =>
      LIGHT_ORDER[a.light] - LIGHT_ORDER[b.light] || a.deadline.localeCompare(b.deadline),
    client: () => 0,
    deadline: (a, b) => a.deadline.localeCompare(b.deadline),
    manager: (a, b) => (a.managerName ?? '').localeCompare(b.managerName ?? '', 'es'),
  };
  return rows
    .filter((row) => !light || row.light === light)
    .sort((a, b) => compare[sort](a, b) || a.legalName.localeCompare(b.legalName, 'es'));
}

const LIGHT_LABEL: Record<Light, string> = { GREEN: 'Verde', AMBER: 'Ámbar', RED: 'Rojo' };

export const overviewCsv = (rows: OverviewRow[]): string =>
  toCsv([
    ['cliente', 'gestor', 'semaforo', 'pendientes', 'fecha_limite', 'documentacion_cerrada'],
    ...rows.map((row) => [
      row.legalName,
      row.managerName ?? '',
      LIGHT_LABEL[row.light],
      row.missing.join(' | '),
      row.deadline,
      row.closed ? 'sí' : 'no',
    ]),
  ]);
