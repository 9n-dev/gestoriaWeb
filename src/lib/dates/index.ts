import { formatInTimeZone } from 'date-fns-tz';

export const APP_TIME_ZONE = 'Europe/Madrid';

/**
 * Calendar dates (deadlines, invoice dates) travel as ISO strings "YYYY-MM-DD" and are stored as
 * UTC midnight (`@db.Date`), so they never shift with the server's time zone.
 */
export type IsoDate = string;

export const todayInMadrid = (now: Date = new Date()): IsoDate =>
  formatInTimeZone(now, APP_TIME_ZONE, 'yyyy-MM-dd');

export const toDateOnly = (iso: IsoDate): Date => new Date(`${iso}T00:00:00.000Z`);

export const isoDate = (date: Date): IsoDate => date.toISOString().slice(0, 10);

export function addDays(iso: IsoDate, days: number): IsoDate {
  const date = toDateOnly(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

/** Whole days from `from` to `to` (negative when `to` is in the past). */
export const daysBetween = (from: IsoDate, to: IsoDate): number =>
  Math.round((toDateOnly(to).getTime() - toDateOnly(from).getTime()) / 86_400_000);

/** Saturdays, Sundays and the given holidays are non-business days (art. 30 Ley 39/2015). */
export function isBusinessDay(iso: IsoDate, holidays: ReadonlySet<IsoDate>): boolean {
  const weekday = toDateOnly(iso).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !holidays.has(iso);
}

/** The date itself when it is a business day, otherwise the next one. */
export function nextBusinessDay(iso: IsoDate, holidays: ReadonlySet<IsoDate>): IsoDate {
  let day = iso;
  while (!isBusinessDay(day, holidays)) day = addDays(day, 1);
  return day;
}

/** "20 de octubre de 2026" */
export const formatLongDate = (date: Date | IsoDate): string =>
  new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeZone: 'UTC' }).format(
    typeof date === 'string' ? toDateOnly(date) : date,
  );

const DATE_TIME = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: APP_TIME_ZONE,
});

/** "19 sept 2026, 16:20", always in Madrid time. */
export const formatDateTime = (date: Date): string => DATE_TIME.format(date);
