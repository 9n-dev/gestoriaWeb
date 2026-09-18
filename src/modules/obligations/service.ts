import { prisma, tenantDb } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { isoDate, toDateOnly, todayInMadrid, type IsoDate } from '@/lib/dates';
import { recordAudit } from '@/modules/audit/service';
import { taxProfileRulesSchema } from '@/modules/clients/tax-profiles/schema';
import { getTaxCalendar, type TaxCalendar } from './calendar';
import { obligationKey, planObligations, type PlannedObligation } from './planner';

export type ObligationDiff = {
  added: PlannedObligation[];
  removed: PlannedObligation[];
  kept: number;
};

const EMPTY: ObligationDiff = { added: [], removed: [], kept: 0 };

/** Fiscal years with deadlines still ahead: last year, this year, and next year from December on. */
function calendarsFor(today: IsoDate): TaxCalendar[] {
  const year = Number(today.slice(0, 4));
  const years = [year - 1, year, ...(today.slice(5, 7) === '12' ? [year + 1] : [])];
  if (!getTaxCalendar(year)) {
    throw new AppError(
      'INTERNAL',
      `Falta el calendario fiscal de ${year}. Contacta con soporte.`,
      `data/tax-calendar-${year}.json is not registered`,
    );
  }
  return years.flatMap((y) => getTaxCalendar(y) ?? []);
}

async function nationalHolidays(): Promise<Set<IsoDate>> {
  const rows = await prisma.holiday.findMany({
    where: { scope: 'NATIONAL' },
    select: { date: true },
  });
  return new Set(rows.map((row) => isoDate(row.date)));
}

/**
 * Brings a client's obligations in line with its tax profile (§6.2). Idempotent.
 * - adds every upcoming obligation of the profile that does not exist yet
 * - removes obligations that no longer apply, but only future ones nobody has started
 * Used when a profile is assigned or changed, when a profile is edited, and by the December job.
 */
export async function syncObligationsForClient(
  tenantId: string,
  clientId: string,
  { today = todayInMadrid() }: { today?: IsoDate } = {},
): Promise<ObligationDiff> {
  const db = tenantDb(tenantId);
  const client = await db.client.findFirst({
    where: { id: clientId, deletedAt: null },
    select: { id: true, taxProfile: { select: { rules: true } } },
  });
  if (!client) throw new AppError('NOT_FOUND', 'No encontramos ese cliente.');

  const planned = client.taxProfile
    ? planObligations(
        taxProfileRulesSchema.parse(client.taxProfile.rules),
        calendarsFor(today),
        await nationalHolidays(),
        today,
      )
    : [];
  const plannedKeys = new Set(planned.map(obligationKey));

  const existing = await db.obligation.findMany({
    where: { clientId },
    select: { id: true, model: true, status: true, dueDate: true, period: true },
  });
  const describe = (o: (typeof existing)[number]): PlannedObligation => ({
    model: o.model,
    year: o.period.year,
    periodType: o.period.type,
    ordinal: o.period.ordinal,
    dueDate: isoDate(o.dueDate),
  });
  const existingKeys = new Set(existing.map((o) => obligationKey(describe(o))));

  const obsolete = existing.filter(
    (o) =>
      o.status === 'PENDING_DOCS' &&
      isoDate(o.dueDate) >= today &&
      !plannedKeys.has(obligationKey(describe(o))),
  );
  const added = planned.filter((p) => !existingKeys.has(obligationKey(p)));
  if (obsolete.length === 0 && added.length === 0) return { ...EMPTY, kept: existing.length };

  const periodIds = new Map<string, string>();
  for (const p of added) {
    const key = `${p.year}:${p.periodType}:${p.ordinal}`;
    if (periodIds.has(key)) continue;
    const period = await prisma.period.upsert({
      where: { year_type_ordinal: { year: p.year, type: p.periodType, ordinal: p.ordinal } },
      create: { year: p.year, type: p.periodType, ordinal: p.ordinal },
      update: {},
    });
    periodIds.set(key, period.id);
  }

  await db.obligation.deleteMany({ where: { id: { in: obsolete.map((o) => o.id) } } });
  await db.obligation.createMany({
    data: added.map((p) => ({
      tenantId,
      clientId,
      model: p.model,
      periodId: periodIds.get(`${p.year}:${p.periodType}:${p.ordinal}`)!,
      dueDate: toDateOnly(p.dueDate),
    })),
    skipDuplicates: true,
  });

  await recordAudit({
    tenantId,
    action: 'obligation.sync',
    entity: 'Client',
    entityId: clientId,
    diff: {
      added: added.map(obligationKey),
      removed: obsolete.map((o) => obligationKey(describe(o))),
    },
  });

  return { added, removed: obsolete.map(describe), kept: existing.length - obsolete.length };
}

/** For the December job (phase 4) and for profile edits: syncs every active client with a profile. */
export async function syncObligationsForClients(
  where: { tenantId?: string; taxProfileId?: string },
  options: { today?: IsoDate } = {},
): Promise<number> {
  const clients = await prisma.client.findMany({
    where: {
      ...where,
      deletedAt: null,
      status: { not: 'INACTIVE' },
      taxProfileId: where.taxProfileId ?? { not: null },
    },
    select: { id: true, tenantId: true },
  });
  for (const client of clients) await syncObligationsForClient(client.tenantId, client.id, options);
  return clients.length;
}
