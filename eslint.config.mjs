import { FlatCompat } from '@eslint/eslintrc';
import prettier from 'eslint-config-prettier';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'coverage/**'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Role checks belong in modules/auth/permissions.ts, env access in src/env.ts.
      'no-restricted-properties': [
        'error',
        { object: 'process', property: 'env', message: 'Use the validated `env` from @/env.' },
      ],
    },
  },
  {
    files: ['src/env.ts', 'tests/setup/**', 'prisma/**', 'e2e/**', '*.config.*'],
    rules: { 'no-restricted-properties': 'off' },
  },
  prettier,
];

export default config;
