import { todayInMadrid } from '@/lib/dates';
import { parsePeriodValue } from '@/lib/periods';
import { collectingPeriod } from '@/modules/checklists/light';
import { overviewFiltersSchema } from '@/modules/checklists/service';

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) || undefined;

/** Shared by the page and its CSV export, so the file always matches what is on screen. */
export function overviewParams(params: Params) {
  const period =
    parsePeriodValue(first(params.periodo) ?? '') ?? collectingPeriod(todayInMadrid(), 'QUARTER');
  const filters = overviewFiltersSchema.safeParse({
    managerId: first(params.gestor),
    light: first(params.estado),
    sort: first(params.orden),
  });
  return { period, filters: filters.success ? filters.data : overviewFiltersSchema.parse({}) };
}
