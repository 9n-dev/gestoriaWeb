// Runs before every test file: a complete, test-only environment.
const TEST_DB = 'postgresql://gestoria:gestoria@localhost:5433/gestoria_test';

Object.assign(process.env, {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? TEST_DB,
  DIRECT_URL: process.env.TEST_DATABASE_URL ?? TEST_DB,
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
  AUTH_SECRET: 'test-secret-test-secret-test-secret-test',
  APP_DOMAIN: 'app.test',
  DEFAULT_TENANT_SLUG: '',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'gestoria',
  S3_ACCESS_KEY_ID: 'minioadmin',
  S3_SECRET_ACCESS_KEY: 'minioadmin',
  RESEND_API_KEY: '',
  // The real extractor only runs when asked for explicitly: it costs money.
  ANTHROPIC_API_KEY: process.env.RUN_AI_EXTRACTION_TEST ? process.env.ANTHROPIC_API_KEY : '',
  VERCEL_TOKEN: '',
  VAPID_PUBLIC_KEY: '',
  DEMO_MODE: 'false',
});
