import { describe, expect, it } from 'vitest';
import { brandingWarnings, contrastRatio, readableForeground } from './contrast';

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5); // the classic AA grey
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5);
  });

  it('picks a legible text colour for buttons', () => {
    expect(readableForeground('#1d4ed8')).toBe('#ffffff');
    expect(readableForeground('#fde047')).toBe('#18181b');
  });

  it('warns about colours that fail AA on white, and only about those', () => {
    expect(brandingWarnings({ primaryColor: '#1d4ed8', accentColor: '#0f766e' })).toEqual([]);
    const warnings = brandingWarnings({ primaryColor: '#fde047', accentColor: '#0f766e' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ color: 'primary' });
    expect(warnings[0]!.message).toContain('poco contraste');
    expect(brandingWarnings({})).toEqual([]);
  });
});
