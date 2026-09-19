import { describe, expect, it, vi } from 'vitest';

const counters = vi.hoisted(() => new Map<string, number>());
const redis = vi.hoisted(() => ({
  status: 'ready',
  incr: vi.fn(async (key: string) => {
    counters.set(key, (counters.get(key) ?? 0) + 1);
    return counters.get(key)!;
  }),
  expire: vi.fn(async () => 1),
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
    expect(redis.expire).toHaveBeenCalledTimes(2); // only when a window opens
  });

  it('fails open when Redis is down', async () => {
    redis.incr.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(rateLimit('login', 'x')).resolves.toBeUndefined();
    log.mockRestore();
  });
});
