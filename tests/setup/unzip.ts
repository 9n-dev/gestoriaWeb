import { inflateRawSync } from 'node:zlib';

/** Reads a ZIP back through its central directory, like any unzip tool. Text entries only. */
export function unzipForTests(archive: Uint8Array): Record<string, string> {
  const buffer = Buffer.from(archive);
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let pointer = buffer.readUInt32LE(end + 16);
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.subarray(pointer + 46, pointer + 46 + nameLength).toString('utf8');
    const dataStart =
      localOffset +
      30 +
      buffer.readUInt16LE(localOffset + 26) +
      buffer.readUInt16LE(localOffset + 28);
    files[name] = inflateRawSync(buffer.subarray(dataStart, dataStart + compressedSize)).toString(
      'utf8',
    );
    pointer += 46 + nameLength;
  }
  return files;
}
