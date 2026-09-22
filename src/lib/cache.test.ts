import { describe, expect, it, vi } from 'vitest';
import { cached } from './cache';

describe('cache', () => {
  it('computes once per key inside the TTL, and per key', async () => {
    const compute = vi.fn(async () => ({ at: Date.now() }));
    const key = `test:${Date.now()}:${Math.random()}`;
    const first = await cached(key, 5, compute);
    const second = await cached(key, 5, compute);
    expect(second).toEqual(first);
    expect(compute).toHaveBeenCalledTimes(1);
    await cached(`${key}:other`, 5, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
