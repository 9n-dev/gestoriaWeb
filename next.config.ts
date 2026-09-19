import type { NextConfig } from 'next';
// Importing env here makes `next dev` and `next build` fail fast on incomplete configuration.
import './src/env';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Loaded by Node at runtime instead of being bundled (dynamic requires, native bindings).
  serverExternalPackages: ['bullmq', 'ioredis'],
};

export default nextConfig;
