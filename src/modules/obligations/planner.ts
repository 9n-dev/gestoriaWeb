import type { PeriodType } from '@prisma/client';
import type { IsoDate } from '@/lib/dates';
import type { TaxProfileRules } from '@/modules/clients/tax-profiles/schema';
import type { TaxCalendar } from './calendar';
import { computeDueDate } from './deadlines';

export type PlannedObligation = {
  model: string;
  year: number;
  periodType: PeriodType;
  ordinal: number;
  dueDate: IsoDate;
};

export const obligationKey = (
  o: Pick<PlannedObligation, 'model' | 'year' | 'periodType' | 'ordinal'>,
) => `${o.model}:${o.year}:${o.periodType}:${o.ordinal}`;

/**
 * Pure: every obligation a tax profile produces over the given fiscal-year calendars, with its real
 * deadline, keeping only deadlines on or after `from` (older ones were handled before the client
 * joined the portal). Forms with monthly and quarterly variants follow the profile's VAT periodicity.
 */
export function planObligations(
  rules: Pick<TaxProfileRules, 'models' | 'vatPeriodicity'>,
  calendars: TaxCalendar[],
  holidays: ReadonlySet<IsoDate>,
  from: IsoDate,
): PlannedObligation[] {
  const planned: PlannedObligation[] = [];
  for (const calendar of calendars) {
    for (const model of rules.models) {
      const periods = calendar.models[model]?.periods;
      if (!periods) continue;

      const periodType: PeriodType =
        periods.MONTH && (rules.vatPeriodicity === 'MONTH' || !periods.QUARTER)
          ? 'MONTH'
          : periods.QUARTER
            ? 'QUARTER'
            : 'YEAR';

      for (const { ordinal, due } of periods[periodType] ?? []) {
        const dueDate = computeDueDate(due, holidays);
        if (dueDate >= from) {
          planned.push({ model, year: calendar.year, periodType, ordinal, dueDate });
        }
      }
    }
  }
  return planned.sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.model.localeCompare(b.model),
  );
}
