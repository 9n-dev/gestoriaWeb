/**
 * Locally the end-to-end suite runs against its own database, `gestoria_e2e`, so it never leaves
 * test tenants or uploads in the development one (TD-035). In CI the workflow provides the URL.
 * The bucket and Redis are shared: object keys and job ids are prefixed by tenant.
 */
export const E2E_DATABASE_URL =
  process.env.CI || process.env.E2E_DATABASE_URL
    ? (process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? '')
    : (
        process.env.DATABASE_URL ?? 'postgresql://gestoria:gestoria@localhost:5433/gestoria'
      ).replace(/\/[^/?]+(\?|$)/, '/gestoria_e2e$1');

/** Environment for every process of the suite: the app, the worker, the seed, the helpers. */
export const e2eEnv = {
  ...process.env,
  DATABASE_URL: E2E_DATABASE_URL,
  DIRECT_URL: E2E_DATABASE_URL,
  DEMO_MODE: 'true',
};
