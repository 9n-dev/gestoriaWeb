import { describe, expect, it } from 'vitest';
import { multipartSink, PART_SIZE, deleteObject } from './multipart';
import { getObjectBytes } from './objects';

// Against the real bucket of the development stack (MinIO in Docker), like CI's.
describe('multipartSink', () => {
  it('writes an object bigger than one part, chunk by chunk, and reads back identical', async () => {
    const key = `tests/multipart-${Date.now()}.bin`;
    const sink = multipartSink(key, 'application/octet-stream');
    const chunk = new Uint8Array(1_000_000).map((_, i) => (i * 7) % 256);
    const chunks = Math.ceil((PART_SIZE * 1.5) / chunk.length); // spans two parts
    for (let i = 0; i < chunks; i++) await sink.write(chunk);
    expect(await sink.close()).toBe(chunk.length * chunks);

    const stored = await getObjectBytes(key);
    expect(stored.byteLength).toBe(chunk.length * chunks);
    expect(Buffer.from(stored.subarray(PART_SIZE, PART_SIZE + 10))).toEqual(
      Buffer.from(chunk.subarray(PART_SIZE % chunk.length, (PART_SIZE % chunk.length) + 10)),
    );
    await deleteObject(key);
  }, 60_000);

  it('handles an object smaller than a part, and an empty one', async () => {
    const key = `tests/multipart-small-${Date.now()}.txt`;
    const sink = multipartSink(key, 'text/plain');
    await sink.write(new TextEncoder().encode('hola'));
    expect(await sink.close()).toBe(4);
    expect(Buffer.from(await getObjectBytes(key)).toString()).toBe('hola');
    await deleteObject(key);

    const empty = multipartSink(`${key}.empty`, 'text/plain');
    expect(await empty.close()).toBe(0);
    await deleteObject(`${key}.empty`);
  }, 30_000);
});
