export type FileType = {
  mime: 'image/jpeg' | 'image/png' | 'application/pdf' | 'image/heic';
  extension: string;
};

const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.slice(start, end));

// ISO-BMFF brands used by HEIC/HEIF stills (iPhone photos).
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);

/**
 * Document type from the first bytes. The file name and the MIME type declared by the browser or
 * the mail client are never trusted. Returns null for anything we do not accept (§6.3).
 */
export function sniffDocumentType(bytes: Uint8Array): FileType | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { mime: 'image/jpeg', extension: 'jpg' };
  if (bytes[0] === 0x89 && ascii(bytes, 1, 4) === 'PNG')
    return { mime: 'image/png', extension: 'png' };
  // Some generators put a few bytes before the header; the spec allows it within the first 1024.
  if (ascii(bytes, 0, Math.min(bytes.length, 1024)).includes('%PDF-'))
    return { mime: 'application/pdf', extension: 'pdf' };
  if (ascii(bytes, 4, 8) === 'ftyp' && HEIC_BRANDS.has(ascii(bytes, 8, 12)))
    return { mime: 'image/heic', extension: 'heic' };
  return null;
}

export const ACCEPTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
  'image/heic',
  'image/heif',
] as const;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
