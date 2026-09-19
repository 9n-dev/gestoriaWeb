import { daysBetween, type IsoDate } from '@/lib/dates';

export type Light = 'GREEN' | 'AMBER' | 'RED';
export type PeriodRef = { year: number; type: 'MONTH' | 'QUARTER' | 'YEAR'; ordinal: number };

export const RED_THRESHOLD_DAYS = 7;

/**
 * §6.5 — green: nothing missing · amber: items missing and more than 7 days left ·
 * red: items missing and 7 days or fewer left, or the deadline has passed.
 */
export function trafficLight(missing: number, deadline: IsoDate, today: IsoDate): Light {
  if (missing === 0) return 'GREEN';
  return daysBetween(today, deadline) <= RED_THRESHOLD_DAYS ? 'RED' : 'AMBER';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** First month (1-12) after the period ends, and the year it falls in. */
function monthAfter(period: PeriodRef): { year: number; month: number } {
  const lastMonth =
    period.type === 'MONTH' ? period.ordinal : period.type === 'QUARTER' ? period.ordinal * 3 : 12;
  return lastMonth === 12
    ? { year: period.year + 1, month: 1 }
    : { year: period.year, month: lastMonth + 1 };
}

/** Day 20 of the month after the period: used when the client has no obligation in that period. */
export function nominalChecklistDeadline(period: PeriodRef): IsoDate {
  const { year, month } = monthAfter(period);
  return `${year}-${pad(month)}-20`;
}

/**
 * The period a gestoría is collecting documents for today: the one that just ended while its
 * filing window is open (until day 20 of the following month; 30 in January), otherwise the
 * one in progress.
 */
export function collectingPeriod(today: IsoDate, type: 'MONTH' | 'QUARTER'): PeriodRef {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const day = Number(today.slice(8, 10));
  const size = type === 'MONTH' ? 1 : 3;
  const current: PeriodRef = { year, type, ordinal: Math.ceil(month / size) };
  const previous: PeriodRef =
    current.ordinal === 1
      ? { year: year - 1, type, ordinal: 12 / size }
      : { ...current, ordinal: current.ordinal - 1 };

  const firstMonthOfPeriod = (current.ordinal - 1) * size + 1;
  const windowOpen = month === firstMonthOfPeriod && day <= (month === 1 ? 30 : 20);
  return windowOpen ? previous : current;
}
