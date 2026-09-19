import { describe, expect, it } from 'vitest';
import { buildEnvelope, parseDsn } from './report-error';

describe('error reporting', () => {
  const dsn = 'https://abc123@errors.example.com/42';

  it('derives the envelope endpoint and auth header from the DSN', () => {
    expect(parseDsn(dsn)).toEqual({
      url: 'https://errors.example.com/api/42/envelope/',
      auth: expect.stringContaining('sentry_key=abc123'),
    });
  });

  it('builds a three-line envelope with the error and where it happened', () => {
    const lines = buildEnvelope(new TypeError('boom'), { where: 'api' }, dsn).split('\n');
    expect(lines).toHaveLength(3);
    const [header, item, event] = lines.map((line) => JSON.parse(line));
    expect(header.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(item).toEqual({ type: 'event' });
    expect(event.exception.values[0]).toEqual({ type: 'TypeError', value: 'boom' });
    expect(event.tags.where).toBe('api');
  });
});
