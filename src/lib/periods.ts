import type { IsoDate } from '@/lib/dates';

export type PeriodOption = { value: string; label: string };

/** "2026-QUARTER-3" ⇄ { year, type, ordinal } */
export const periodValue = (p: { year: number; type: string; ordinal: number }) =>
  `${p.year}-${p.type}-${p.ordinal}`;
export function parsePeriodValue(
  value: string,
): { year: number; type: 'MONTH' | 'QUARTER' | 'YEAR'; ordinal: number } | null {
  const match = /^(\d{4})-(MONTH|QUARTER|YEAR)-(\d{1,2})$/.exec(value);
  return match
    ? { year: Number(match[1]), type: match[2] as 'QUARTER', ordinal: Number(match[3]) }
    : null;
}

/** Current quarter first, then the previous five: what a client or manager usually files documents under. */
export function recentQuarters(today: IsoDate, count = 6): PeriodOption[] {
  let year = Number(today.slice(0, 4));
  let quarter = Math.ceil(Number(today.slice(5, 7)) / 3);
  const options: PeriodOption[] = [];
  for (let i = 0; i < count; i++) {
    options.push({
      value: periodValue({ year, type: 'QUARTER', ordinal: quarter }),
      label: `${quarter}.º trimestre de ${year}`,
    });
    if (--quarter === 0) {
      quarter = 4;
      year--;
    }
  }
  return options;
}
