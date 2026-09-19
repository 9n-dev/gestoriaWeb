import { daysBetween, type IsoDate } from '@/lib/dates';

/**
 * Which reminder step applies today: the closest configured offset that has already been reached
 * (15 → 7 → 2 → 0). Using "reached" instead of "equal" means a day without worker, or an obligation
 * created late, still gets its reminder; `ReminderLog` makes sure each step is sent once.
 * Null when the first offset is still ahead or the deadline has passed.
 */
export function reminderStep(deadline: IsoDate, today: IsoDate, offsets: number[]): number | null {
  const daysLeft = daysBetween(today, deadline);
  if (daysLeft < 0) return null;
  const reached = offsets.filter((offset) => offset >= daysLeft);
  return reached.length ? Math.min(...reached) : null;
}
