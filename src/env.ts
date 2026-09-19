import { z } from 'zod';

// Empty strings in .env files mean "not set".
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  APP_DOMAIN: z.string().min(1),
  DEFAULT_TENANT_SLUG: optional(z.string()),

  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),

  RESEND_API_KEY: optional(z.string()),
  EMAIL_FROM: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().default('no-reply@localhost'),
  ),

  // Without CLAMAV_HOST the development fake scanner is used (flags only the EICAR test file).
  CLAMAV_HOST: optional(z.string()),
  CLAMAV_PORT: z.coerce.number().int().default(3310),

  // Svix-style signing secret of the Resend inbound webhook ("whsec_…").
  RESEND_WEBHOOK_SECRET: optional(z.string()),
  // Domain of the per-client inbound addresses: <slug>-<code>@<INBOUND_EMAIL_DOMAIN>
  INBOUND_EMAIL_DOMAIN: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().default('docs.localhost'),
  ),

  DEMO_MODE: z.preprocess((v) => v === 'true' || v === '1', z.boolean()),
  SENTRY_DSN: optional(z.url()),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}

export const env = parseEnv(process.env);
