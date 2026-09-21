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

describe('brand colours in the dark theme (TD-050)', () => {
  it('lightens a dark brand colour until it reads on the dark surface, keeping its hue', async () => {
    const { adaptForDarkTheme, contrastRatio } = await import('./contrast');
    const navy = '#0f4c81';
    expect(contrastRatio(navy, '#18181b')).toBeLessThan(3);
    const adapted = adaptForDarkTheme(navy);
    expect(contrastRatio(adapted, '#18181b')).toBeGreaterThanOrEqual(4.5);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(adapted.slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(g!); // still a blue
    expect(g).toBeGreaterThan(r!);
  });

  it('leaves alone a colour that already reads, and survives pure black', async () => {
    const { adaptForDarkTheme, contrastRatio } = await import('./contrast');
    expect(adaptForDarkTheme('#60a5fa')).toBe('#60a5fa');
    expect(contrastRatio(adaptForDarkTheme('#000000'), '#18181b')).toBeGreaterThanOrEqual(4.5);
  });
});
