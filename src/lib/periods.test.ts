import { describe, expect, it } from 'vitest';

describe('recentMonths', () => {
  it('lists the last months newest first, crossing the year', async () => {
    const { recentMonths } = await import('./periods');
    expect(recentMonths('2026-02-10', 3).map((o) => o.label)).toEqual([
      'febrero de 2026',
      'enero de 2026',
      'diciembre de 2025',
    ]);
    expect(recentMonths('2026-02-10', 1)[0]?.value).toBe('2026-MONTH-2');
  });
});
