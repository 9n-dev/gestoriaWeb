import { describe, expect, it, vi } from 'vitest';

// A tiny sorted-set Redis: enough for the multi the limiter sends.
const sets = vi.hoisted(() => new Map<string, Array<[number, string]>>());
const redis = vi.hoisted(() => ({
  status: 'ready',
  failNext: false,
  multi() {
    const ops: Array<() => unknown> = [];
    const chain = {
      zremrangebyscore: (key: string, _min: number, max: number) => {
        ops.push(() =>
          sets.set(
            key,
            (sets.get(key) ?? []).filter(([score]) => score > max),
          ),
        );
        return chain;
      },
      zadd: (key: string, score: number, member: string) => {
        ops.push(() => sets.set(key, [...(sets.get(key) ?? []), [score, member]]));
        return chain;
      },
      zcard: (key: string) => {
        ops.push(() => sets.get(key)?.length ?? 0);
        return chain;
      },
      expire: () => {
        ops.push(() => 1);
        return chain;
      },
      exec: async () => {
        if (redis.failNext) {
          redis.failNext = false;
          throw new Error('ECONNREFUSED');
        }
        return ops.map((op) => [null, op()] as [null, unknown]);
      },
    };
    return chain;
  },
}));
vi.mock('./redis', () => ({ getRedis: () => redis }));
vi.mock('./request', () => ({ requestMeta: async () => ({ ip: '203.0.113.1', userAgent: null }) }));

import { rateLimit } from './rate-limit';

describe('rate limit', () => {
  it('lets the allowed number through, then answers 429 in Spanish, per key', async () => {
    for (let i = 0; i < 10; i++) await rateLimit('magicLink', 'a');
    await expect(rateLimit('magicLink', 'a')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      userMessage: expect.stringContaining('Demasiados intentos'),
    });
    await expect(rateLimit('magicLink', 'b')).resolves.toBeUndefined();
  });

  it('slides: attempts older than the window stop counting, without a boundary reset', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T10:00:00Z'));
    for (let i = 0; i < 10; i++) await rateLimit('magicLink', 'c'); // window: 600 s
    await expect(rateLimit('magicLink', 'c')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    vi.setSystemTime(new Date('2026-09-22T10:09:00Z')); // 9 minutes later: still all inside
    await expect(rateLimit('magicLink', 'c')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    vi.setSystemTime(new Date('2026-09-22T10:10:01Z')); // the first ten have expired, the two 429 tries have not
    await expect(rateLimit('magicLink', 'c')).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it('fails open when Redis is down', async () => {
    redis.failNext = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(rateLimit('login', 'x')).resolves.toBeUndefined();
    log.mockRestore();
  });
});
