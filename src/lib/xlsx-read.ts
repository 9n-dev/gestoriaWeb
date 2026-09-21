import { inflateRawSync } from 'node:zlib';

/** A spreadsheet of clients is kilobytes. Anything that inflates beyond this is not one. */
const MAX_ENTRY_BYTES = 20 * 1024 * 1024;

/** Entries of a ZIP, through its central directory. Stored and deflated entries only. */
function unzip(archive: Uint8Array, wanted: (path: string) => boolean): Map<string, Buffer> {
  const buffer = Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength);
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('not a zip');
  const count = buffer.readUInt16LE(end + 10);
  let pointer = buffer.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) throw new Error('bad central directory');
    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const size = buffer.readUInt32LE(pointer + 24);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const path = buffer.toString('utf8', pointer + 46, pointer + 46 + nameLength);
    pointer += 46 + nameLength + extraLength + commentLength;
    if (!wanted(path)) continue;
    if (size > MAX_ENTRY_BYTES) throw new Error('entry too large');
    const start =
      localOffset +
      30 +
      buffer.readUInt16LE(localOffset + 26) +
      buffer.readUInt16LE(localOffset + 28);
    const data = buffer.subarray(start, start + compressedSize);
    files.set(
      path,
      // The declared size can lie: the inflater enforces the ceiling too (zip bombs).
      method === 0 ? data : inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }),
    );
  }
  return files;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (xml: string) =>
  xml.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, entity: string) =>
    entity[0] === '#'
      ? String.fromCodePoint(
          entity[1]?.toLowerCase() === 'x'
            ? parseInt(entity.slice(2), 16)
            : Number(entity.slice(1)),
        )
      : (ENTITIES[entity] ?? whole),
  );

/** All the text runs of a string item (rich text splits one cell into several `<t>`). */
const textOf = (xml: string) =>
  [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((run) => decode(run[1]!)).join('');

/** "A" → 0, "Z" → 25, "AA" → 26. */
const columnIndex = (ref: string) =>
  [...ref.replace(/\d+$/, '')].reduce(
    (index, letter) => index * 26 + letter.charCodeAt(0) - 64,
    0,
  ) - 1;

/**
 * The first sheet of an .xlsx as rows of strings, like `parseCsv` gives: enough to import a list of
 * clients without a spreadsheet library (ADR 0014). Shared, inline and formula strings, numbers and
 * booleans as typed; dates come as Excel serial numbers (the client template has none).
 * ponytail: "first sheet" is the lowest-numbered sheetN.xml, not the workbook's tab order.
 */
export function readXlsx(bytes: Uint8Array): string[][] {
  const files = unzip(
    bytes,
    (path) => path === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(path),
  );
  const sheetPath = [...files.keys()]
    .filter((path) => path.startsWith('xl/worksheets/'))
    .sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]))[0];
  if (!sheetPath) throw new Error('no worksheet');

  const shared = [
    ...(files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '').matchAll(
      /<si>([\s\S]*?)<\/si>/g,
    ),
  ].map((item) => textOf(item[1]!));

  const rows: string[][] = [];
  const sheet = files.get(sheetPath)!.toString('utf8');
  for (const row of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cell of row[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cell[1]!;
      const body = cell[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attributes)?.[1];
      const type = /\bt="(\w+)"/.exec(attributes)?.[1];
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
      const text =
        type === 's'
          ? (shared[Number(value)] ?? '')
          : type === 'inlineStr'
            ? textOf(body)
            : decode(value);
      cells[ref ? columnIndex(ref) : cells.length] = text.trim();
    }
    // Sparse rows have holes: make them empty strings, and drop rows that are entirely empty.
    const filled = Array.from(cells, (text) => text ?? '');
    if (filled.some((text) => text !== '')) rows.push(filled);
  }
  return rows;
}
