/**
 * Browser side of logo uploads. The portal shows any PNG, JPEG or WebP, but the PDFs we generate
 * (invoices, signature certificates) can only embed plain PNG and JPEG (ADR 0035). The browser can
 * decode everything, so the awkward cases are re-encoded as PNG here, before the upload.
 */
const MAX_PIXELS = 4_000_000; // same ceiling as lib/pdf-image.ts
const MAX_BYTES = 1024 * 1024; // same ceiling as the server

/** True for files `pdfImageFrom` would refuse: WebP, interlaced PNG, CMYK JPEG. Pure, for tests. */
export function needsReencoding(head: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return true;
  if (head[0] === 0x89 && ascii(1, 4) === 'PNG') return head[28] === 1; // IHDR interlace method
  if (head[0] === 0xff && head[1] === 0xd8) {
    // Walk the segments up to the frame header; four components means CMYK.
    for (let at = 2; at + 9 < head.length && head[at] === 0xff;) {
      const marker = head[at + 1]!;
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return head[at + 9] === 4;
      }
      at += 2 + ((head[at + 2]! << 8) | head[at + 3]!);
    }
  }
  return false;
}

/** Largest scale (≤ 1) that keeps an image inside the pixel budget. Pure, for tests. */
export const scaleToFit = (width: number, height: number, maxPixels = MAX_PIXELS): number =>
  Math.min(1, Math.sqrt(maxPixels / (width * height)));

const toPng = (bitmap: ImageBitmap, scale: number) =>
  new Promise<Blob | null>((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(resolve, 'image/png');
  });

/**
 * The file to upload: the same one when it is already fine, otherwise a PNG copy (transparency
 * kept), shrunk if it has to be. If the browser cannot decode it the original goes up untouched
 * and the server decides.
 */
export async function normaliseLogo(file: File): Promise<File> {
  try {
    const head = new Uint8Array(await file.slice(0, 65_536).arrayBuffer());
    const bitmap = await createImageBitmap(file);
    let scale = scaleToFit(bitmap.width, bitmap.height);
    if (scale === 1 && !needsReencoding(head)) return file;

    // A PNG of a photo-like logo can be heavy: shrink until the server will take it.
    for (let attempt = 0; attempt < 4; attempt++, scale *= 0.7) {
      const blob = await toPng(bitmap, scale);
      if (blob && blob.size <= MAX_BYTES) {
        return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.png', { type: 'image/png' });
      }
    }
    return file;
  } catch {
    return file;
  }
}

/** `onChange` for a file input: swaps the chosen file for its normalised version, in place. */
export async function normaliseLogoInput(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  if (!file) return;
  const normalised = await normaliseLogo(file);
  if (normalised === file) return;
  const transfer = new DataTransfer();
  transfer.items.add(normalised);
  input.files = transfer.files;
}
