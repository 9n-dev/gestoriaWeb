import { crc32, deflateRawSync } from 'node:zlib';

export type ZipEntry = { path: string; data: Uint8Array | string };

// MS-DOS date/time of 1980-01-01: archives are reproducible, and nobody reads these dates.
const DOS_TIME = 0;
const DOS_DATE = 0x21;
const UTF8_NAMES = 0x0800;

/**
 * Minimal ZIP writer (deflate, UTF-8 names, no zip64: up to 4 GB and 65 535 entries). Used for
 * XLSX exports and for the GDPR export archives, so no zip dependency is needed.
 */
export function zip(entries: ZipEntry[]): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const raw = Buffer.from(entry.data);
    const compressed = deflateRawSync(raw);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(UTF8_NAMES, 6);
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(crc32(raw), 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(name.length, 26);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4); // version made by
    header.copy(directory, 6, 4, 30); // same fields as the local header, from "version needed"
    directory.writeUInt32LE(offset, 42);

    local.push(header, name, compressed);
    central.push(directory, name);
    offset += header.length + name.length + compressed.length;
  }

  const directorySize = central.reduce((size, part) => size + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, ...central, end]));
}
