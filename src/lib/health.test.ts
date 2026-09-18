import { describe, expect, it, vi } from 'vitest';
import { runHealthChecks } from './health';

describe('runHealthChecks', () => {
  it('is ok when every dependency answers', async () => {
    const report = await runHealthChecks({ db: async () => 1, redis: async () => 'PONG' });
    expect(report).toEqual({ status: 'ok', checks: { db: 'ok', redis: 'ok' } });
  });

  it('is degraded, without leaking the reason, when one fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const report = await runHealthChecks({
      db: async () => 1,
      storage: async () => {
        throw new Error('secret endpoint unreachable');
      },
    });
    expect(report).toEqual({ status: 'degraded', checks: { db: 'ok', storage: 'fail' } });
    expect(JSON.stringify(report)).not.toContain('secret');
  });

  it('treats a hanging dependency as failed', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const pending = runHealthChecks({ redis: () => new Promise(() => {}) });
    await vi.advanceTimersByTimeAsync(2500);
    expect((await pending).checks.redis).toBe('fail');
    vi.useRealTimers();
  });
});
