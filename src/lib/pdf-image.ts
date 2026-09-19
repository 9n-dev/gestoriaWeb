import { deflateSync, inflateSync } from 'node:zlib';

/** An image ready to become a PDF XObject. `alpha` (deflated 8-bit mask) only when something is transparent. */
export type PdfImage = {
  width: number;
  height: number;
  colorSpace: 'DeviceRGB' | 'DeviceGray' | 'DeviceCMYK';
  filter: 'DCTDecode' | 'FlateDecode';
  data: Uint8Array;
  alpha?: Uint8Array;
  /** PDF `/Decode` array, when samples are stored inverted. */
  decode?: string;
};

/** Decoded pixels are held in memory: a logo has no business being larger than this. */
const MAX_PIXELS = 4_000_000;
/**
 * Logos print about 6 cm wide. Anything beyond ~300 dpi of that is weight added to every invoice,
 * so decoded images are box-filtered down to roughly this size before they are embedded.
 */
const TARGET = { width: 720, height: 200 };

/** JPEG goes into the PDF as it is (DCTDecode); we only need its size and channels from the frame header. */
function fromJpeg(bytes: Uint8Array): PdfImage | null {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 9 < view.length && view[offset] === 0xff) {
    const marker = view[offset + 1]!;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      const components = view[offset + 9];
      if (components !== 1 && components !== 3 && components !== 4) return null;
      return {
        width: view.readUInt16BE(offset + 7),
        height: view.readUInt16BE(offset + 5),
        colorSpace: components === 1 ? 'DeviceGray' : components === 3 ? 'DeviceRGB' : 'DeviceCMYK',
        filter: 'DCTDecode',
        data: bytes,
        // CMYK JPEGs come from print tools (Adobe), which store the four channels inverted.
        ...(components === 4 ? { decode: '[1 0 1 0 1 0 1 0]' } : {}),
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

/** Undoes the per-row PNG filters of `height` rows starting at `start`; rows come back without their filter byte. */
function unfilter(
  raw: Buffer,
  start: number,
  rowBytes: number,
  height: number,
  bpp: number,
): Buffer {
  const out = Buffer.alloc(rowBytes * height);
  for (let row = 0; row < height; row++) {
    const type = raw[start + row * (rowBytes + 1)]!;
    const source = start + row * (rowBytes + 1) + 1;
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

/** Adam7: seven reduced images, each `[xStart, yStart, xStep, yStep]`, that interleave into the full one. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

/**
 * Averages `factor`×`factor` blocks. Colour is weighted by alpha, so transparent pixels do not
 * bleed their (arbitrary) colour into the edges of the logo.
 */
function downsample(rgb: Buffer, alpha: Buffer, width: number, height: number, factor: number) {
  const outWidth = Math.ceil(width / factor);
  const outHeight = Math.ceil(height / factor);
  const outRgb = Buffer.alloc(outWidth * outHeight * 3);
  const outAlpha = Buffer.alloc(outWidth * outHeight);
  for (let oy = 0; oy < outHeight; oy++) {
    for (let ox = 0; ox < outWidth; ox++) {
      const sum = [0, 0, 0];
      let alphaSum = 0;
      let count = 0;
      for (let y = oy * factor; y < Math.min((oy + 1) * factor, height); y++) {
        for (let x = ox * factor; x < Math.min((ox + 1) * factor, width); x++) {
          const at = y * width + x;
          const a = alpha[at]!;
          for (let c = 0; c < 3; c++) sum[c]! += rgb[at * 3 + c]! * a;
          alphaSum += a;
          count++;
        }
      }
      const out = oy * outWidth + ox;
      for (let c = 0; c < 3; c++)
        outRgb[out * 3 + c] = alphaSum ? Math.round(sum[c]! / alphaSum) : 0;
      outAlpha[out] = Math.round(alphaSum / count);
    }
  }
  return { rgb: outRgb, alpha: outAlpha, width: outWidth, height: outHeight };
}

/**
 * PNG decoder for logos: every colour type, bit depth and kind of transparency, interlaced or not.
 * PDF cannot take a PNG as it is when it has an alpha channel, so pixels are split into an RGB
 * image and a soft mask.
 */
function fromPng(bytes: Uint8Array): PdfImage | null {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let header: {
    width: number;
    height: number;
    depth: number;
    type: number;
    interlaced: boolean;
  } | null = null;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const idat: Buffer[] = [];

  for (let offset = 8; offset + 12 <= view.length;) {
    const length = view.readUInt32BE(offset);
    const type = view.toString('latin1', offset + 4, offset + 8);
    const data = view.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8]!,
        type: data[9]!,
        interlaced: data[12] === 1,
      };
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!header || idat.length === 0) return null;
  const { width, height, depth, type } = header;
  if (width * height === 0 || width * height > MAX_PIXELS) return null;

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels || (type === 3 && !palette)) return null;
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = Math.max(1, (channels * depth) >> 3);

  /** The same sample as 8 bits: the high byte of 16, the low depths stretched to 0–255. */
  const to8 = (value: number) =>
    depth === 16 ? value >> 8 : depth < 8 ? Math.round((value * 255) / ((1 << depth) - 1)) : value;
  // Without an alpha channel, tRNS names the one colour (at file depth) that is fully transparent.
  const keyed =
    (type === 0 || type === 2) && transparency && transparency.length >= (type === 0 ? 2 : 6);
  const key = keyed ? [0, 2, 4].map((at) => transparency!.readUInt16BE(type === 0 ? 0 : at)) : null;

  const rgb = Buffer.alloc(width * height * 3);
  const alpha = Buffer.alloc(width * height, 255);
  let consumed = 0;
  const passes = header.interlaced ? ADAM7 : ([[0, 0, 1, 1]] as const);
  for (const [xStart, yStart, xStep, yStep] of passes) {
    const passWidth = Math.ceil((width - xStart) / xStep);
    const passHeight = Math.ceil((height - yStart) / yStep);
    if (passWidth <= 0 || passHeight <= 0) continue;
    const rowBytes = Math.ceil((passWidth * channels * depth) / 8);
    if (raw.length < consumed + (rowBytes + 1) * passHeight) return null;
    const pixels = unfilter(raw, consumed, rowBytes, passHeight, bpp);
    consumed += (rowBytes + 1) * passHeight;

    /** Sample `index` of a row exactly as stored: palette index, or intensity at the file's bit depth. */
    const stored = (row: number, index: number): number => {
      const base = row * rowBytes;
      if (depth === 8) return pixels[base + index]!;
      if (depth === 16) return pixels.readUInt16BE(base + index * 2);
      const bit = index * depth;
      return (pixels[base + (bit >> 3)]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    };

    for (let row = 0; row < passHeight; row++) {
      for (let col = 0; col < passWidth; col++) {
        const at = (yStart + row * yStep) * width + xStart + col * xStep;
        const first = col * channels;
        if (type === 3) {
          const index = stored(row, first);
          rgb.set(palette!.subarray(index * 3, index * 3 + 3), at * 3);
          alpha[at] = transparency?.[index] ?? 255;
          continue;
        }
        const grey = type === 0 || type === 4;
        const colour = [0, 1, 2].map((c) => stored(row, first + (grey ? 0 : c)));
        colour.forEach((value, c) => (rgb[at * 3 + c] = to8(value)));
        if (type === 4 || type === 6) alpha[at] = to8(stored(row, first + (grey ? 1 : 3)));
        else if (key && colour.every((value, c) => value === key[c])) alpha[at] = 0;
      }
    }
  }

  const factor = Math.floor(Math.max(width / TARGET.width, height / TARGET.height));
  const image =
    factor > 1 ? downsample(rgb, alpha, width, height, factor) : { rgb, alpha, width, height };
  return {
    width: image.width,
    height: image.height,
    colorSpace: 'DeviceRGB',
    filter: 'FlateDecode',
    data: deflateSync(image.rgb),
    ...(image.alpha.some((value) => value < 255) ? { alpha: deflateSync(image.alpha) } : {}),
  };
}

/**
 * JPEG or PNG bytes → something `PdfDocument.addImage` takes. Null for anything else (WebP has no
 * decoder in Node) and for broken files: callers simply go without the image.
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
