import { beforeEach, describe, expect, it, vi } from 'vitest';

const reportError = vi.hoisted(() => vi.fn());
const limited = vi.hoisted(() => ({ fail: false }));
vi.mock('@/lib/report-error', () => ({ reportError }));
vi.mock('@/lib/rate-limit', async () => {
  const { AppError } = await import('@/lib/errors');
  return {
    rateLimitByIp: vi.fn(async () => {
      if (limited.fail) throw new AppError('RATE_LIMITED', 'Demasiados intentos.');
    }),
  };
});

import { POST } from './route';

const post = (body: string) => POST(new Request('http://x/api/errors', { method: 'POST', body }));

describe('POST /api/errors', () => {
  beforeEach(() => {
    reportError.mockClear();
    limited.fail = false;
  });

  it('forwards a browser error with its path, as text only', async () => {
    const response = await post(
      JSON.stringify({
        message: 'x is undefined',
        stack: 'at a.js:1',
        path: '/subir',
        extra: 'ignored',
      }),
    );
    expect(response.status).toBe(204);
    const [error, context] = reportError.mock.calls[0]!;
    expect(error).toMatchObject({
      name: 'BrowserError',
      message: 'x is undefined',
      stack: 'at a.js:1',
    });
    expect(context).toEqual({ where: 'browser', tags: { path: '/subir' } });
  });

  it('refuses garbage and oversized fields, and honours the rate limit', async () => {
    expect((await post('not json')).status).toBe(400);
    expect((await post(JSON.stringify({ message: 'x'.repeat(501) }))).status).toBe(400);
    limited.fail = true;
    expect((await post(JSON.stringify({ message: 'x' }))).status).toBe(429);
    expect(reportError).not.toHaveBeenCalled();
  });
});
