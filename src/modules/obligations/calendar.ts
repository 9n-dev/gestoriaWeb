import { z } from 'zod';
import calendar2025 from '../../../data/tax-calendar-2025.json';
import calendar2026 from '../../../data/tax-calendar-2026.json';
import calendar2027 from '../../../data/tax-calendar-2027.json';

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const periodsSchema = z.array(
  z.object({ ordinal: z.number().int().min(0).max(12), due: isoDateSchema }),
);

const taxCalendarSchema = z.object({
  year: z.number().int(),
  source: z.string(),
  updatedAt: isoDateSchema,
  models: z.record(
    z.string(),
    z.object({
      name: z.string(),
      periods: z.object({
        MONTH: periodsSchema.optional(),
        QUARTER: periodsSchema.optional(),
        YEAR: periodsSchema.optional(),
      }),
    }),
  ),
});

export type TaxCalendar = z.infer<typeof taxCalendarSchema>;

// To add a year: create data/tax-calendar-<year>.json and register it here (see README).
const FILES: Record<number, unknown> = {
  2025: calendar2025,
  2026: calendar2026,
  2027: calendar2027,
};
const parsed = new Map<number, TaxCalendar>();

/** AEAT calendar of a fiscal year with NOMINAL due dates, or null when that year is not loaded. */
export function getTaxCalendar(year: number): TaxCalendar | null {
  if (!(year in FILES)) return null;
  if (!parsed.has(year)) parsed.set(year, taxCalendarSchema.parse(FILES[year]));
  return parsed.get(year)!;
}

/** Every model known to any loaded calendar, for validating tax profiles. */
export function knownModels(): string[] {
  const models = new Set<string>();
  for (const year of Object.keys(FILES)) {
    Object.keys(getTaxCalendar(Number(year))!.models).forEach((model) => models.add(model));
  }
  return [...models].sort();
}

export const modelName = (model: string): string => {
  for (const year of Object.keys(FILES).reverse()) {
    const name = getTaxCalendar(Number(year))?.models[model]?.name;
    if (name) return name;
  }
  return `Modelo ${model}`;
};
