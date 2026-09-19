import { env } from '@/env';

type Context = { where: string; tags?: Record<string, string> };

/** `https://<key>@<host>/<project>` → envelope endpoint and auth header (Sentry, GlitchTip…). */
export function parseDsn(dsn: string): { url: string; auth: string } {
  const { protocol, username, host, pathname } = new URL(dsn);
  const project = pathname.replace(/^\/+|\/+$/g, '');
  return {
    url: `${protocol}//${host}/api/${project}/envelope/`,
    auth: `Sentry sentry_version=7, sentry_client=gestoria-portal/1.0, sentry_key=${username}`,
  };
}

export function buildEnvelope(
  error: unknown,
  context: Context,
  dsn: string,
  now = new Date(),
): string {
  const eventId = crypto.randomUUID().replace(/-/g, '');
  const failure = error instanceof Error ? error : new Error(String(error));
  const event = {
    event_id: eventId,
    timestamp: now.getTime() / 1000,
    platform: 'node',
    level: 'error',
    environment: env.NODE_ENV,
    tags: { where: context.where, ...context.tags },
    // Type, message and stack only: no request bodies, no user data (§4).
    exception: { values: [{ type: failure.name, value: failure.message }] },
    extra: { stack: failure.stack },
  };
  return [
    JSON.stringify({ event_id: eventId, sent_at: now.toISOString(), dsn }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');
}

/**
 * Logs always; with `SENTRY_DSN` also ships the error to any Sentry-compatible service through its
 * envelope endpoint. No SDK: one POST is all we need from it (ADR 0032). Never throws.
 */
export function reportError(error: unknown, context: Context): void {
  console.error(`[${context.where}]`, error);
  if (!env.SENTRY_DSN) return;
  try {
    const { url, auth } = parseDsn(env.SENTRY_DSN);
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': auth },
      body: buildEnvelope(error, context, env.SENTRY_DSN),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  } catch {
    // A broken DSN must not take the request down with it.
  }
}
