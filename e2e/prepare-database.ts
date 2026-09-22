/**
 * Runs before the app starts (see `webServer` in playwright.config.ts): creates the E2E database
 * the first time and applies the migrations. In CI the workflow already did both.
 */
import { execSync } from 'node:child_process';
import { Client } from 'pg';
import { E2E_DATABASE_URL, e2eEnv } from './database';

async function ensureDatabase() {
  const url = new URL(E2E_DATABASE_URL);
  const name = url.pathname.slice(1);
  url.pathname = '/postgres';
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
}

(async () => {
  // In CI the workflow created and migrated the database; locally it is ours to prepare.
  if (process.env.E2E_DATABASE_URL || !process.env.CI) await ensureDatabase();
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: e2eEnv });
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
