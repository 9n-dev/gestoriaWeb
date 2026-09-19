import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@tests': fileURLToPath(new URL('./tests', import.meta.url)),
      // `server-only` throws outside the Next.js bundler.
      'server-only': fileURLToPath(new URL('./tests/setup/empty.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
    globalSetup: ['./tests/setup/global.ts'],
    setupFiles: ['./tests/setup/env.ts'],
    // Integration tests share one database.
    fileParallelism: false,
  },
});
