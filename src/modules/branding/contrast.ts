/** WCAG 2.x contrast maths for tenant colours (§6.12: validate automatically and warn). */

const channel = (value: number) => {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** 1 (no contrast) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

const WHITE = '#ffffff';
const INK = '#18181b';

/** Text colour that reads best on top of `background`: buttons always stay legible. */
export const readableForeground = (background: string): string =>
  contrastRatio(background, WHITE) >= contrastRatio(background, INK) ? WHITE : INK;

const DARK_SURFACE = '#18181b';

/**
 * The same brand colour for the dark theme: lightened towards white, in small steps, until it reads
 * on the dark background (AA, 4.5:1). A colour that already does is returned untouched, so a
 * gestoría with a light brand keeps it exactly.
 */
export function adaptForDarkTheme(hex: string): string {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let step = 0; step <= 20; step++) {
    const mixed = `#${channels
      .map((value) => Math.round(value + ((255 - value) * step) / 20))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')}`;
    if (contrastRatio(mixed, DARK_SURFACE) >= 4.5) return mixed;
  }
  return WHITE;
}

export type ContrastWarning = { color: 'primary' | 'accent'; ratio: number; message: string };

/**
 * AA needs 4.5:1 for text. The brand colours are used as text and link colour on the page
 * background and as button background, so both are checked. Warnings do not block saving.
 */
export function brandingWarnings(colors: {
  primaryColor?: string;
  accentColor?: string;
}): ContrastWarning[] {
  const warnings: ContrastWarning[] = [];
  for (const [color, hex] of [
    ['primary', colors.primaryColor],
    ['accent', colors.accentColor],
  ] as const) {
    if (!hex) continue;
    const onWhite = contrastRatio(hex, WHITE);
    const label = color === 'primary' ? 'principal' : 'de acento';
    if (onWhite < 4.5) {
      warnings.push({
        color,
        ratio: Math.round(onWhite * 10) / 10,
        message: `El color ${label} tiene poco contraste sobre fondo blanco (${onWhite.toFixed(1)}:1; lo recomendable es 4,5:1). Los enlaces y textos en ese color costarán de leer: prueba un tono más oscuro.`,
      });
    }
  }
  return warnings;
}
