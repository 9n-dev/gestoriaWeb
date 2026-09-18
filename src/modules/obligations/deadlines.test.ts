import { describe, expect, it } from 'vitest';
import holidaysFile from '../../../data/holidays.json';
import { todayInMadrid } from '@/lib/dates';
import { getTaxCalendar } from './calendar';
import { computeDueDate } from './deadlines';

const holidays = new Set(holidaysFile.holidays.map((h) => h.date));
const nominal = (
  year: number,
  model: string,
  type: 'MONTH' | 'QUARTER' | 'YEAR',
  ordinal: number,
) => getTaxCalendar(year)!.models[model]!.periods[type]!.find((p) => p.ordinal === ordinal)!.due;

describe('computeDueDate', () => {
  it('keeps a deadline that falls on a business day', () => {
    // Monday 20 April 2026
    expect(computeDueDate('2026-04-20', holidays)).toBe('2026-04-20');
  });

  it('moves a Saturday or Sunday deadline to Monday', () => {
    expect(computeDueDate('2027-06-20', holidays)).toBe('2027-06-21'); // Sunday
    expect(computeDueDate('2026-06-20', holidays)).toBe('2026-06-22'); // Saturday
  });

  it('moves a holiday deadline to the next business day', () => {
    // Monday 12 October 2026, Fiesta Nacional
    expect(computeDueDate('2026-10-12', holidays)).toBe('2026-10-13');
  });

  it('skips consecutive non-business days (holiday + weekend)', () => {
    // Friday 1 May 2026 is a holiday, then Saturday and Sunday
    expect(computeDueDate('2026-05-01', holidays)).toBe('2026-05-04');
    // Friday 25 Dec 2026 → Monday 28
    expect(computeDueDate('2026-12-25', holidays)).toBe('2026-12-28');
  });

  it('handles the change of year', () => {
    // Friday 1 January 2027 is a holiday → Monday 4 January 2027
    expect(computeDueDate('2027-01-01', holidays)).toBe('2027-01-04');
    // Q4 2026 VAT is due in January 2027: Saturday 30 → Monday 1 February
    expect(nominal(2026, '303', 'QUARTER', 4)).toBe('2027-01-30');
    expect(computeDueDate(nominal(2026, '303', 'QUARTER', 4), holidays)).toBe('2027-02-01');
  });

  it('handles leap years', () => {
    // Form 347 of fiscal year 2027 is due on the last day of February 2028, a leap year
    expect(nominal(2027, '347', 'YEAR', 0)).toBe('2028-02-29');
    expect(computeDueDate('2028-02-29', holidays)).toBe('2028-02-29'); // Tuesday
    // ...and of fiscal year 2026 on Sunday 28 February 2027 → Monday 1 March
    expect(computeDueDate(nominal(2026, '347', 'YEAR', 0), holidays)).toBe('2027-03-01');
    // Monthly VAT for January is due on the last day of February
    expect(nominal(2027, '303', 'MONTH', 1)).toBe('2027-02-28');
  });

  it('computes the quarterly deadlines of 2026', () => {
    const due = (q: number) => computeDueDate(nominal(2026, '303', 'QUARTER', q), holidays);
    expect([due(1), due(2), due(3)]).toEqual(['2026-04-20', '2026-07-20', '2026-10-20']);
    // Withholdings (111/115) close Q4 on 20 January, not 30
    expect(computeDueDate(nominal(2026, '115', 'QUARTER', 4), holidays)).toBe('2027-01-20');
  });
});

describe('todayInMadrid', () => {
  it('uses the Madrid calendar day, not UTC', () => {
    expect(todayInMadrid(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
    expect(todayInMadrid(new Date('2026-06-30T21:59:00Z'))).toBe('2026-06-30');
    expect(todayInMadrid(new Date('2026-06-30T22:01:00Z'))).toBe('2026-07-01');
  });
});
