import type { DocumentType } from '@prisma/client';
import { prisma, tenantDb } from '@/lib/db';
import { todayInMadrid, type IsoDate } from '@/lib/dates';
import { DOCUMENT_TYPE_LABELS } from '@/modules/clients/tax-profiles/labels';
import { taxProfileRulesSchema } from '@/modules/clients/tax-profiles/schema';
import { collectingPeriod, type PeriodRef } from './light';

// Kept free of service imports: clients, documents and jobs all call into this file.

export const ensurePeriod = (period: PeriodRef) =>
  prisma.period.upsert({ where: { year_type_ordinal: period }, create: period, update: {} });

export const labelOf = (item: { label: string | null; documentType: DocumentType }) =>
  item.label ?? DOCUMENT_TYPE_LABELS[item.documentType];

/** Documents are collected per VAT period: monthly filers by month, everybody else by quarter. */
export const checklistPeriodType = (rules: unknown): 'MONTH' | 'QUARTER' => {
  const parsed = taxProfileRulesSchema.safeParse(rules);
  return parsed.success && parsed.data.vatPeriodicity === 'MONTH' ? 'MONTH' : 'QUARTER';
};

/**
 * Creates the checklist of a client and period from its tax profile (§6.5). Idempotent: items that
 * exist are left alone, including the ones a manager dismissed, which therefore stay dismissed.
 * Without `period`, the one being collected today.
 */
export async function ensureChecklist(
  tenantId: string,
  clientId: string,
  options: { period?: PeriodRef; today?: IsoDate } = {},
): Promise<string | null> {
  const db = tenantDb(tenantId);
  const client = await db.client.findFirst({
    where: { id: clientId, deletedAt: null },
    select: { taxProfile: { select: { rules: true } } },
  });
  const rules = taxProfileRulesSchema.safeParse(client?.taxProfile?.rules);
  if (!rules.success) return null;

  const period = await ensurePeriod(
    options.period ??
      collectingPeriod(options.today ?? todayInMadrid(), checklistPeriodType(rules.data)),
  );
  const existing = await db.checklistItem.findMany({
    where: { clientId, periodId: period.id, source: 'AUTO' },
    select: { documentType: true },
  });
  const have = new Set(existing.map((item) => item.documentType));
  const missing = rules.data.checklist.filter((item) => !have.has(item.documentType));
  if (missing.length > 0) {
    await db.checklistItem.createMany({
      data: missing.map((item) => ({
        tenantId,
        clientId,
        periodId: period.id,
        documentType: item.documentType,
        label: item.label,
        source: 'AUTO' as const,
      })),
    });
    await refreshChecklist(tenantId, clientId, [period.id]);
  }
  return period.id;
}

/**
 * Re-evaluates automatic fulfilment: an item is met when the client has sent at least one document
 * of that type for the period that was not rejected or a duplicate. Manual ticks are never undone.
 * Called whenever a document appears, changes type/period/status or is withdrawn.
 */
export async function refreshChecklist(
  tenantId: string,
  clientId: string,
  periodIds: Array<string | null | undefined>,
): Promise<void> {
  const db = tenantDb(tenantId);
  for (const periodId of new Set(periodIds.filter((id): id is string => Boolean(id)))) {
    const received = await db.document.groupBy({
      by: ['type'],
      where: {
        clientId,
        periodId,
        deletedAt: null,
        status: { notIn: ['REJECTED', 'DUPLICATE'] },
        file: { status: { in: ['UPLOADED', 'CLEAN'] } },
      },
    });
    const types = received.map((row) => row.type);
    const auto = { clientId, periodId, fulfilledManually: false };
    await db.checklistItem.updateMany({
      where: { ...auto, fulfilled: false, documentType: { in: types } },
      data: { fulfilled: true, fulfilledAt: new Date() },
    });
    await db.checklistItem.updateMany({
      where: { ...auto, fulfilled: true, documentType: { notIn: types } },
      data: { fulfilled: false, fulfilledAt: null },
    });
  }
}
