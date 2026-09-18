import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const complete = {
  DATABASE_URL: 'postgresql://u:p@localhost:5433/db',
  DIRECT_URL: 'postgresql://u:p@localhost:5433/db',
  REDIS_URL: 'redis://localhost:6379',
  AUTH_SECRET: 'x'.repeat(32),
  APP_DOMAIN: 'localhost:3000',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'gestoria',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
};

describe('parseEnv', () => {
  it('returns typed values and applies defaults', () => {
    const env = parseEnv({ ...complete, DEMO_MODE: 'true' });
    expect(env.DEMO_MODE).toBe(true);
    expect(env.EMAIL_FROM).toBe('no-reply@localhost');
    expect(env.RESEND_API_KEY).toBeUndefined();
  });

  it('treats empty strings as missing', () => {
    const env = parseEnv({ ...complete, RESEND_API_KEY: '', DEMO_MODE: '' });
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.DEMO_MODE).toBe(false);
  });

  it('names every missing variable', () => {
    const { DATABASE_URL: _db, AUTH_SECRET: _secret, ...rest } = complete;
    expect(() => parseEnv(rest)).toThrowError(
      /DATABASE_URL[\s\S]*AUTH_SECRET|AUTH_SECRET[\s\S]*DATABASE_URL/,
    );
  });

  it('rejects a short AUTH_SECRET', () => {
    expect(() => parseEnv({ ...complete, AUTH_SECRET: 'short' })).toThrowError(/AUTH_SECRET/);
  });
});
