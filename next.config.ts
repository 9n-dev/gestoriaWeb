import type { NextConfig } from 'next';
// Importing env here makes `next dev` and `next build` fail fast on incomplete configuration.
import './src/env';

const nextConfig: NextConfig = {
  poweredByHeader: false,
};

export default nextConfig;
