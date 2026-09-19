import { describe, expect, it } from 'vitest';
import { collectingPeriod, nominalChecklistDeadline, trafficLight } from './light';

describe('trafficLight (§6.5)', () => {
  const deadline = '2026-10-20';
  it('is green when nothing is missing, however close the deadline', () => {
    expect(trafficLight(0, deadline, '2026-10-19')).toBe('GREEN');
    expect(trafficLight(0, deadline, '2026-11-01')).toBe('GREEN');
  });
  it('is amber with items missing and more than 7 days left', () => {
    expect(trafficLight(2, deadline, '2026-09-19')).toBe('AMBER');
    expect(trafficLight(1, deadline, '2026-10-12')).toBe('AMBER'); // 8 days
  });
  it('is red with items missing and 7 days or fewer, or overdue', () => {
    expect(trafficLight(1, deadline, '2026-10-13')).toBe('RED'); // exactly 7 days
    expect(trafficLight(1, deadline, '2026-10-20')).toBe('RED');
    expect(trafficLight(1, deadline, '2026-10-21')).toBe('RED');
  });
});

describe('collectingPeriod', () => {
  it('stays on the quarter that just ended while its filing window is open', () => {
    expect(collectingPeriod('2026-10-05', 'QUARTER')).toEqual({
      year: 2026,
      type: 'QUARTER',
      ordinal: 3,
    });
    expect(collectingPeriod('2026-10-20', 'QUARTER')).toEqual({
      year: 2026,
      type: 'QUARTER',
      ordinal: 3,
    });
    expect(collectingPeriod('2026-10-21', 'QUARTER')).toEqual({
      year: 2026,
      type: 'QUARTER',
      ordinal: 4,
    });
    expect(collectingPeriod('2026-09-19', 'QUARTER')).toEqual({
      year: 2026,
      type: 'QUARTER',
      ordinal: 3,
    });
  });
  it('crosses the year: Q4 is collected until 30 January', () => {
    expect(collectingPeriod('2027-01-30', 'QUARTER')).toEqual({
      year: 2026,
      type: 'QUARTER',
      ordinal: 4,
    });
    expect(collectingPeriod('2027-01-31', 'QUARTER')).toEqual({
      year: 2027,
      type: 'QUARTER',
      ordinal: 1,
    });
  });
  it('works monthly', () => {
    expect(collectingPeriod('2026-03-10', 'MONTH')).toEqual({
      year: 2026,
      type: 'MONTH',
      ordinal: 2,
    });
    expect(collectingPeriod('2026-03-25', 'MONTH')).toEqual({
      year: 2026,
      type: 'MONTH',
      ordinal: 3,
    });
    expect(collectingPeriod('2027-01-15', 'MONTH')).toEqual({
      year: 2026,
      type: 'MONTH',
      ordinal: 12,
    });
  });
});

describe('nominalChecklistDeadline', () => {
  it('is day 20 of the month after the period', () => {
    expect(nominalChecklistDeadline({ year: 2026, type: 'QUARTER', ordinal: 3 })).toBe(
      '2026-10-20',
    );
    expect(nominalChecklistDeadline({ year: 2026, type: 'QUARTER', ordinal: 4 })).toBe(
      '2027-01-20',
    );
    expect(nominalChecklistDeadline({ year: 2026, type: 'MONTH', ordinal: 12 })).toBe('2027-01-20');
  });
});
