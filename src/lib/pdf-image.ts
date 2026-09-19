import { deflateSync, inflateSync } from 'node:zlib';

/** An image ready to become a PDF XObject. `alpha` (deflated 8-bit mask) only when something is transparent. */
export type PdfImage = {
  width: number;
  height: number;
  colorSpace: 'DeviceRGB' | 'DeviceGray';
  filter: 'DCTDecode' | 'FlateDecode';
  data: Uint8Array;
  alpha?: Uint8Array;
};

/** Decoded pixels are held in memory: a logo has no business being larger than this. */
const MAX_PIXELS = 4_000_000;

/** JPEG goes into the PDF as it is (DCTDecode); we only need its size from the frame header. */
function fromJpeg(bytes: Uint8Array): PdfImage | null {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 9 < view.length && view[offset] === 0xff) {
    const marker = view[offset + 1]!;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      const components = view[offset + 9];
      // CMYK JPEGs need inverted decode arrays that depend on who wrote them: not worth guessing.
      if (components !== 1 && components !== 3) return null;
      return {
        width: view.readUInt16BE(offset + 7),
        height: view.readUInt16BE(offset + 5),
        colorSpace: components === 1 ? 'DeviceGray' : 'DeviceRGB',
        filter: 'DCTDecode',
        data: bytes,
      };
    }
    offset += 2 + view.readUInt16BE(offset + 2);
  }
  return null;
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Undoes the per-row PNG filters in place and returns the rows without their filter byte. */
function unfilter(raw: Buffer, rowBytes: number, height: number, bpp: number): Buffer {
  const out = Buffer.alloc(rowBytes * height);
  for (let row = 0; row < height; row++) {
    const type = raw[row * (rowBytes + 1)]!;
    const source = row * (rowBytes + 1) + 1;
    const target = row * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const left = i >= bpp ? out[target + i - bpp]! : 0;
      const up = row > 0 ? out[target - rowBytes + i]! : 0;
      const upLeft = row > 0 && i >= bpp ? out[target - rowBytes + i - bpp]! : 0;
      const predictor =
        type === 1
          ? left
          : type === 2
            ? up
            : type === 3
              ? (left + up) >> 1
              : type === 4
                ? paeth(left, up, upLeft)
                : 0;
      out[target + i] = (raw[source + i]! + predictor) & 0xff;
    }
  }
  return out;
}

/**
 * PNG decoder for logos: every colour type and bit depth, palette transparency, no interlacing.
 * PDF cannot take a PNG as it is when it has an alpha channel, so pixels are split into an RGB
 * image and a soft mask.
 */
function fromPng(bytes: Uint8Array): PdfImage | null {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let header: { width: number; height: number; depth: number; type: number } | null = null;
  let palette: Buffer | null = null;
  let paletteAlpha: Buffer | null = null;
  const idat: Buffer[] = [];

  for (let offset = 8; offset + 12 <= view.length;) {
    const length = view.readUInt32BE(offset);
    const type = view.toString('latin1', offset + 4, offset + 8);
    const data = view.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      if (data[12] !== 0) return null; // Adam7 interlacing
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8]!,
        type: data[9]!,
      };
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') paletteAlpha = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!header || idat.length === 0) return null;
  const { width, height, depth, type } = header;
  if (width * height === 0 || width * height > MAX_PIXELS) return null;

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels || (type === 3 && !palette)) return null;
  const rowBytes = Math.ceil((width * channels * depth) / 8);
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < (rowBytes + 1) * height) return null;
  const pixels = unfilter(raw, rowBytes, height, Math.max(1, (channels * depth) >> 3));

  /** Sample `index` of a row, as stored (palette index or intensity at the file's bit depth). */
  const sample = (row: number, index: number): number => {
    const base = row * rowBytes;
    if (depth === 8) return pixels[base + index]!;
    if (depth === 16) return pixels[base + index * 2]!; // high byte is enough for print
    const bit = index * depth;
    return (pixels[base + (bit >> 3)]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1;

  const rgb = Buffer.alloc(width * height * 3);
  const alpha = Buffer.alloc(width * height, 255);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const at = row * width + col;
      const first = col * channels;
      if (type === 3) {
        const index = sample(row, first);
        rgb.set(palette!.subarray(index * 3, index * 3 + 3), at * 3);
        alpha[at] = paletteAlpha?.[index] ?? 255;
      } else if (type === 0 || type === 4) {
        rgb.fill(Math.round(sample(row, first) * scale), at * 3, at * 3 + 3);
        if (type === 4) alpha[at] = sample(row, first + 1);
      } else {
        for (let c = 0; c < 3; c++) rgb[at * 3 + c] = sample(row, first + c);
        if (type === 6) alpha[at] = sample(row, first + 3);
      }
    }
  }

  return {
    width,
    height,
    colorSpace: 'DeviceRGB',
    filter: 'FlateDecode',
    data: deflateSync(rgb),
    ...(alpha.some((value) => value < 255) ? { alpha: deflateSync(alpha) } : {}),
  };
}

/**
 * JPEG or PNG bytes → something `PdfDocument.addImage` takes. Null for anything else (WebP has no
 * decoder in Node), for exotic variants and for broken files: callers simply go without the image.
 */
export function pdfImageFrom(bytes: Uint8Array): PdfImage | null {
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return fromJpeg(bytes);
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return fromPng(bytes);
    }
    return null;
  } catch {
    return null;
  }
}
