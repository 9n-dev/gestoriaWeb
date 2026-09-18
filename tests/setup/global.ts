import { execSync } from 'node:child_process';

const TEST_DB =
  process.env.TEST_DATABASE_URL ?? 'postgresql://gestoria:gestoria@localhost:5433/gestoria_test';

// Brings the integration database up to date once per run.
export default function setup() {
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DB, DIRECT_URL: TEST_DB },
    stdio: 'pipe',
  });
}
