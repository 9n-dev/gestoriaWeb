import { nextBusinessDay, type IsoDate } from '@/lib/dates';

/**
 * Real filing deadline: the nominal AEAT date, moved to the next business day when it falls on
 * a Saturday, Sunday or national holiday.
 */
export function computeDueDate(nominal: IsoDate, holidays: ReadonlySet<IsoDate>): IsoDate {
  return nextBusinessDay(nominal, holidays);
}
