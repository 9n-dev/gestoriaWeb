import { describe, expect, it } from 'vitest';
import { needsReencoding, scaleToFit } from './normalise-logo';

const bytes = (...parts: Array<number[] | string>) =>
  new Uint8Array(
    parts.flatMap((part) => (typeof part === 'string' ? [...Buffer.from(part, 'latin1')] : part)),
  );

describe('logo normalisation (decisions)', () => {
  it('re-encodes WebP', () => {
    expect(needsReencoding(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '))).toBe(true);
  });

  it('re-encodes interlaced PNGs only', () => {
    const png = (interlace: number) =>
      bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13], 'IHDR', [
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        1,
        8,
        6,
        0,
        0,
        interlace,
      ]);
    expect(needsReencoding(png(1))).toBe(true);
    expect(needsReencoding(png(0))).toBe(false);
  });

  it('re-encodes CMYK JPEGs only, skipping the segments before the frame header', () => {
    const jpeg = (components: number) =>
      bytes(
        [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00],
        [0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x30, 0x01, 0x40, components],
      );
    expect(needsReencoding(jpeg(4))).toBe(true);
    expect(needsReencoding(jpeg(3))).toBe(false);
    expect(needsReencoding(jpeg(1))).toBe(false);
  });

  it('leaves unknown bytes alone', () => {
    expect(needsReencoding(new Uint8Array())).toBe(false);
    expect(needsReencoding(bytes('GIF89a'))).toBe(false);
  });

  it('shrinks only what exceeds the pixel budget, keeping proportions', () => {
    expect(scaleToFit(760, 140)).toBe(1);
    const scale = scaleToFit(6000, 3000);
    expect(scale).toBeLessThan(1);
    expect(6000 * scale * 3000 * scale).toBeLessThanOrEqual(4_000_000 + 1);
  });
});
