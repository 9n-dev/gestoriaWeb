import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PdfDocument } from './pdf';
import { pdfImageFrom } from './pdf-image';

// ── A tiny PNG encoder, so every filter type and colour type can be exercised on purpose ──
const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
};
const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
function png(options: {
  width: number;
  height: number;
  depth: number;
  type: number;
  rows: number[][]; // raw bytes of each row, before filtering
  filters?: number[];
  bpp?: number;
  interlace?: number;
  extra?: Buffer[];
}): Uint8Array {
  const {
    width,
    height,
    depth,
    type,
    rows,
    filters = [],
    bpp = 1,
    interlace = 0,
    extra = [],
  } = options;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([depth, type, 0, 0, interlace], 8);
  const filtered = rows.flatMap((row, r) => {
    const filter = filters[r] ?? 0;
    const previous = rows[r - 1];
    return [
      filter,
      ...row.map((value, i) => {
        const left = i >= bpp ? row[i - bpp]! : 0;
        const up = previous ? previous[i]! : 0;
        const upLeft = previous && i >= bpp ? previous[i - bpp]! : 0;
        const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter]!;
        return (value - predictor) & 0xff;
      }),
    ];
  });
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      ...extra,
      chunk('IDAT', deflateSync(Buffer.from(filtered))),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}
const pixels = (data: Uint8Array) => [...inflateSync(data)];

describe('pdf images', () => {
  it('decodes RGBA through every PNG filter and splits colour from alpha', () => {
    // 2 px wide, 5 rows, one filter type each.
    const rows = [
      [255, 0, 0, 255, 0, 255, 0, 128],
      [0, 0, 255, 0, 10, 20, 30, 255],
      [200, 100, 50, 255, 201, 101, 51, 254],
      [1, 2, 3, 4, 250, 251, 252, 253],
      [90, 91, 92, 93, 94, 95, 96, 97],
    ];
    const image = pdfImageFrom(
      png({ width: 2, height: 5, depth: 8, type: 6, rows, filters: [0, 1, 2, 3, 4], bpp: 4 }),
    )!;
    expect(image).toMatchObject({
      width: 2,
      height: 5,
      colorSpace: 'DeviceRGB',
      filter: 'FlateDecode',
    });
    expect(pixels(image.data)).toEqual(
      rows.flatMap((row) => [...row.slice(0, 3), ...row.slice(4, 7)]),
    );
    expect(pixels(image.alpha!)).toEqual(rows.flatMap((row) => [row[3], row[7]]));
  });

  it('decodes a 2-bit palette with transparency', () => {
    const image = pdfImageFrom(
      png({
        width: 4,
        height: 1,
        depth: 2,
        type: 3,
        rows: [[0b00_01_10_11]],
        extra: [
          chunk('PLTE', Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9])),
          chunk('tRNS', Buffer.from([255, 0])), // index 1 is transparent, the rest opaque
        ],
      }),
    )!;
    expect(pixels(image.data)).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9]);
    expect(pixels(image.alpha!)).toEqual([255, 0, 255, 255]);
  });

  it('decodes greyscale at 1, 8 and 16 bits and leaves opaque images without a mask', () => {
    const oneBit = pdfImageFrom(
      png({ width: 3, height: 1, depth: 1, type: 0, rows: [[0b101_00000]] }),
    )!;
    expect(pixels(oneBit.data)).toEqual([255, 255, 255, 0, 0, 0, 255, 255, 255]);
    expect(oneBit.alpha).toBeUndefined();

    const sixteen = pdfImageFrom(
      png({ width: 1, height: 1, depth: 16, type: 0, rows: [[0x80, 0x12]], bpp: 2 }),
    )!;
    expect(pixels(sixteen.data)).toEqual([0x80, 0x80, 0x80]);

    const greyAlpha = pdfImageFrom(
      png({ width: 1, height: 1, depth: 8, type: 4, rows: [[40, 7]], bpp: 2 }),
    )!;
    expect(pixels(greyAlpha.data)).toEqual([40, 40, 40]);
    expect(pixels(greyAlpha.alpha!)).toEqual([7]);
  });

  it('honours the single transparent colour of PNGs without an alpha channel', () => {
    const rgbKey = pdfImageFrom(
      png({
        width: 2,
        height: 1,
        depth: 8,
        type: 2,
        rows: [[255, 255, 255, 10, 20, 30]],
        bpp: 3,
        extra: [chunk('tRNS', Buffer.from([0, 255, 0, 255, 0, 255]))], // white is the key
      }),
    )!;
    expect(pixels(rgbKey.alpha!)).toEqual([0, 255]);

    // At 16 bits the key must match both bytes: 0x8012 is transparent, 0x8013 is not.
    const greyKey = pdfImageFrom(
      png({
        width: 2,
        height: 1,
        depth: 16,
        type: 0,
        rows: [[0x80, 0x12, 0x80, 0x13]],
        bpp: 2,
        extra: [chunk('tRNS', Buffer.from([0x80, 0x12]))],
      }),
    )!;
    expect(pixels(greyKey.data)).toEqual([0x80, 0x80, 0x80, 0x80, 0x80, 0x80]);
    expect(pixels(greyKey.alpha!)).toEqual([0, 255]);
  });

  it('reads the size of a JPEG and passes its bytes through untouched', () => {
    const jpeg = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xe0,
      0x00,
      0x04,
      0x00,
      0x00, // APP0 to skip
      0xff,
      0xc2,
      0x00,
      0x11,
      0x08,
      0x00,
      0x30,
      0x01,
      0x40,
      0x03,
      0x01,
      0x11,
      0x00, // progressive frame, 320x48, 3 components
      0xff,
      0xd9,
    ]);
    const image = pdfImageFrom(jpeg)!;
    expect(image).toMatchObject({
      width: 320,
      height: 48,
      colorSpace: 'DeviceRGB',
      filter: 'DCTDecode',
    });
    expect(image.data).toBe(jpeg);

    const cmyk = jpeg.slice();
    cmyk[17] = 4;
    expect(pdfImageFrom(cmyk)).toBeNull();
  });

  it('answers null, never throws, for what it cannot handle', () => {
    const interlaced = png({ width: 1, height: 1, depth: 8, type: 0, rows: [[1]], interlace: 1 });
    const truncated = png({
      width: 1,
      height: 1,
      depth: 8,
      type: 2,
      rows: [[1, 2, 3]],
      bpp: 3,
    }).slice(0, 40);
    const webp = new Uint8Array(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'));
    const huge = png({ width: 5000, height: 5000, depth: 8, type: 0, rows: [[1]] });
    for (const bytes of [
      interlaced,
      truncated,
      webp,
      huge,
      new Uint8Array([1, 2, 3]),
      new Uint8Array(),
    ]) {
      expect(pdfImageFrom(bytes)).toBeNull();
    }
  });

  it('embeds the image and its soft mask as objects every page can use, with valid offsets', () => {
    const image = pdfImageFrom(
      png({ width: 1, height: 1, depth: 8, type: 6, rows: [[1, 2, 3, 4]], bpp: 4 }),
    )!;
    const document = new PdfDocument();
    const name = document.addImage(image);
    document.addPage().image(name, 10, 10, 100, 50);
    document.addPage();
    const out = Buffer.from(document.build()).toString('latin1');

    expect(out).toContain(
      '/Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode /SMask 6 0 R',
    );
    expect(out).toContain('/ColorSpace /DeviceGray /Filter /FlateDecode');
    expect(out.match(/\/XObject << \/Im1 5 0 R >>/g)).toHaveLength(2);
    expect(out).toContain('q 100.00 0 0 50.00 10.00 782.00 cm /Im1 Do Q');
    [...out.matchAll(/^(\d{10}) 00000 n /gm)].forEach(([, offset], index) =>
      expect(out.slice(Number(offset)).startsWith(`${index + 1} 0 obj`)).toBe(true),
    );
  });
});
