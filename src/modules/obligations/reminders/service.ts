import type { ReminderKind } from '@prisma/client';
import { prisma, tenantDb } from '@/lib/db';
import {
  addDays,
  daysBetween,
  formatLongDate,
  isoDate,
  toDateOnly,
  type IsoDate,
} from '@/lib/dates';
import { periodLabel } from '@/lib/labels';
import { collectingPeriod } from '@/modules/checklists/light';
import { checklistPeriodType, ensureChecklist, labelOf } from '@/modules/checklists/sync';
import { notifyClientUsers, notifyUsers } from '@/modules/messaging/notifications';
import { syncObligationsForClients } from '../service';
import { reminderStep } from './planner';
import {
  deadlineTemplateKey,
  parseReminderSettings,
  renderTemplate,
  resolveTemplate,
} from './templates';

export type DailySummary = {
  deadlineReminders: number;
  inactivityNotices: number;
  expiryNotices: number;
};
type LogEntry = { kind: ReminderKind; entityId: string; step: string };

/**
 * Claims the right to send: inserts the log rows and returns only the ones that were new. Sending
 * happens after; if it fails the claim is released, so the BullMQ retry sends it again. A notice
 * is therefore sent at least once and, outside crashes between send and release, exactly once.
 */
async function claim(tenantId: string, entries: LogEntry[]): Promise<LogEntry[]> {
  const db = tenantDb(tenantId);
  const fresh: LogEntry[] = [];
  for (const entry of entries) {
    const { count } = await db.reminderLog.createMany({
      data: [{ tenantId, ...entry }],
      skipDuplicates: true,
    });
    if (count === 1) fresh.push(entry);
  }
  return fresh;
}

async function sendOrRelease(
  tenantId: string,
  entries: LogEntry[],
  send: () => Promise<void>,
): Promise<void> {
  try {
    await send();
  } catch (error) {
    await tenantDb(tenantId).reminderLog.deleteMany({ where: { OR: entries } });
    throw error;
  }
}

/**
 * Everything a tenant needs every morning (§6.9). Idempotent for a given `today`: a second run,
 * or a retry, sends nothing new. `today` comes from the job payload, not from the clock.
 */
export async function runTenantDaily(tenantId: string, today: IsoDate): Promise<DailySummary> {
  const summary: DailySummary = { deadlineReminders: 0, inactivityNotices: 0, expiryNotices: 0 };
  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, status: 'ACTIVE' } });
  if (!tenant) return summary;
  const settings = parseReminderSettings(tenant.reminderSettings);
  const db = tenantDb(tenantId);

  // Housekeeping: next year's obligations appear on 1 December (the sync adds them from then on),
  // and every client gets the checklist of the period being collected.
  if (today.endsWith('-01')) await syncObligationsForClients({ tenantId }, { today });
  const clients = await db.client.findMany({
    where: { deletedAt: null, status: { not: 'INACTIVE' }, taxProfileId: { not: null } },
    select: { id: true, taxProfile: { select: { rules: true } } },
  });
  for (const client of clients) await ensureChecklist(tenantId, client.id, { today });

  if (!settings.enabled) return summary;
  summary.deadlineReminders = await sendDeadlineReminders(
    tenantId,
    tenant.name,
    today,
    settings.offsets,
  );
  summary.inactivityNotices = await sendInactivityNotices(tenantId, today, settings.inactivityDays);
  summary.expiryNotices = await sendExpiryNotices(
    tenantId,
    tenant.name,
    today,
    settings.permanentExpiryOffsets,
  );
  return summary;
}

/** One message per client and day: the forms that are due and, concretely, what is still missing. */
async function sendDeadlineReminders(
  tenantId: string,
  tenantName: string,
  today: IsoDate,
  offsets: number[],
): Promise<number> {
  const db = tenantDb(tenantId);
  const horizon = toDateOnly(addDays(today, Math.max(...offsets)));
  const obligations = await db.obligation.findMany({
    where: {
      status: { not: 'FILED' },
      dueDate: { gte: toDateOnly(today), lte: horizon },
      client: { deletedAt: null, status: { not: 'INACTIVE' }, users: { some: {} } },
    },
    select: {
      id: true,
      model: true,
      dueDate: true,
      period: true,
      client: { select: { id: true, legalName: true, taxProfile: { select: { rules: true } } } },
    },
    orderBy: { dueDate: 'asc' },
  });

  const byClient = Map.groupBy(obligations, (obligation) => obligation.client.id);
  let sent = 0;
  for (const [clientId, items] of byClient) {
    const due = items
      .map((o) => ({ ...o, step: reminderStep(isoDate(o.dueDate), today, offsets) }))
      .filter((o): o is typeof o & { step: number } => o.step !== null);
    const fresh = await claim(
      tenantId,
      due.map((o) => ({ kind: 'OBLIGATION_DEADLINE', entityId: o.id, step: String(o.step) })),
    );
    const announced = due.filter((o) => fresh.some((entry) => entry.entityId === o.id));
    if (announced.length === 0) continue;

    const client = items[0]!.client;
    const period = collectingPeriod(today, checklistPeriodType(client.taxProfile?.rules));
    const missing = await db.checklistItem.findMany({
      where: { clientId, fulfilled: false, dismissedAt: null, period },
      orderBy: { createdAt: 'asc' },
    });
    const entries = [...fresh];
    if (missing.length > 0) {
      entries.push(
        ...(await claim(tenantId, [
          {
            kind: 'MISSING_DOCS',
            entityId: `${clientId}:${periodLabel(period)}`,
            step: `${today}`,
          },
        ])),
      );
    }

    const step = Math.min(...announced.map((o) => o.step));
    const deadline = isoDate(announced[0]!.dueDate);
    const template = await resolveTemplate(tenantId, deadlineTemplateKey(step));
    const variables = {
      cliente: client.legalName,
      gestoria: tenantName,
      plazo: formatLongDate(deadline),
      dias: daysBetween(today, deadline),
      modelos: announced.map((o) => `${o.model} (${periodLabel(o.period)})`).join(', '),
      pendientes: missing.length
        ? `Para prepararlo todavía nos falta de ${periodLabel(period)}:\n${missing.map((item) => `- ${labelOf(item)}`).join('\n')}`
        : 'Ya tenemos toda tu documentación: no necesitamos nada más de ti.',
    };
    const subject = renderTemplate(template.subject, variables);
    await sendOrRelease(tenantId, entries, () =>
      notifyClientUsers(tenantId, clientId, {
        type: missing.length ? 'MISSING_DOCS_REMINDER' : 'DEADLINE_REMINDER',
        title: subject,
        body: missing.length
          ? `Nos falta: ${missing.map(labelOf).join(', ')}.`
          : `Modelos: ${variables.modelos}.`,
        link: missing.length ? '/subir' : '/plazos',
        email: {
          subject,
          text: renderTemplate(template.body, variables),
          templateKey: deadlineTemplateKey(step),
        },
      }),
    );
    sent++;
  }
  return sent;
}

/** One notice per manager listing the clients that went quiet; each silent streak is reported once. */
async function sendInactivityNotices(
  tenantId: string,
  today: IsoDate,
  inactivityDays: number,
): Promise<number> {
  if (inactivityDays === 0) return 0;
  const db = tenantDb(tenantId);
  const threshold = toDateOnly(addDays(today, -inactivityDays));
  const quiet = await db.client.findMany({
    where: {
      deletedAt: null,
      status: 'ACTIVE',
      isSample: false,
      assignedManagerId: { not: null },
      OR: [
        { lastActivityAt: { lt: threshold } },
        { lastActivityAt: null, createdAt: { lt: threshold } },
      ],
    },
    select: {
      id: true,
      legalName: true,
      assignedManagerId: true,
      lastActivityAt: true,
      createdAt: true,
    },
    orderBy: { legalName: 'asc' },
  });

  let sent = 0;
  for (const [managerId, clients] of Map.groupBy(quiet, (client) => client.assignedManagerId!)) {
    const fresh = await claim(
      tenantId,
      clients.map((c) => ({
        kind: 'CLIENT_INACTIVITY',
        entityId: c.id,
        step: isoDate(c.lastActivityAt ?? c.createdAt),
      })),
    );
    const names = clients
      .filter((c) => fresh.some((entry) => entry.entityId === c.id))
      .map((c) => c.legalName);
    if (names.length === 0) continue;

    const template = await resolveTemplate(tenantId, 'reminder.inactivity');
    const variables = {
      dias: inactivityDays,
      clientes: names.map((name) => `- ${name}`).join('\n'),
    };
    await sendOrRelease(tenantId, fresh, () =>
      notifyUsers(tenantId, [managerId], {
        type: 'CLIENT_INACTIVE',
        title:
          names.length === 1
            ? `${names[0]} lleva más de ${inactivityDays} días sin actividad`
            : `${names.length} clientes sin actividad`,
        body: names.join(', '),
        link: '/panel/clientes',
        email: {
          subject: renderTemplate(template.subject, variables),
          text: renderTemplate(template.body, variables),
          templateKey: 'reminder.inactivity',
        },
      }),
    );
    sent++;
  }
  return sent;
}

/** Permanent documents about to expire (60/30/7 days): the manager and the client both hear about it. */
async function sendExpiryNotices(
  tenantId: string,
  tenantName: string,
  today: IsoDate,
  offsets: number[],
): Promise<number> {
  const db = tenantDb(tenantId);
  const expiring = await db.permanentDocument.findMany({
    where: {
      deletedAt: null,
      expiresAt: { gte: toDateOnly(today), lte: toDateOnly(addDays(today, Math.max(...offsets))) },
      client: { deletedAt: null, status: { not: 'INACTIVE' } },
    },
    select: {
      id: true,
      title: true,
      expiresAt: true,
      client: { select: { id: true, legalName: true, assignedManagerId: true } },
    },
  });

  let sent = 0;
  for (const document of expiring) {
    const expiresAt = isoDate(document.expiresAt!);
    const step = reminderStep(expiresAt, today, offsets);
    if (step === null) continue;
    const fresh = await claim(tenantId, [
      { kind: 'PERMANENT_DOC_EXPIRY', entityId: document.id, step: String(step) },
    ]);
    if (fresh.length === 0) continue;

    const template = await resolveTemplate(tenantId, 'reminder.permanent_expiry');
    const variables = {
      documento: document.title,
      cliente: document.client.legalName,
      gestoria: tenantName,
      plazo: formatLongDate(expiresAt),
      dias: daysBetween(today, expiresAt),
    };
    const payload = {
      type: 'PERMANENT_DOC_EXPIRING' as const,
      title: renderTemplate(template.subject, variables),
      body: `${document.client.legalName} · quedan ${variables.dias} días`,
      email: {
        subject: renderTemplate(template.subject, variables),
        text: renderTemplate(template.body, variables),
        templateKey: 'reminder.permanent_expiry',
      },
    };
    await sendOrRelease(tenantId, fresh, async () => {
      if (document.client.assignedManagerId) {
        await notifyUsers(tenantId, [document.client.assignedManagerId], {
          ...payload,
          link: `/panel/clientes/${document.client.id}`,
        });
      }
      await notifyClientUsers(tenantId, document.client.id, { ...payload, link: '/inicio' });
    });
    sent++;
  }
  return sent;
}
