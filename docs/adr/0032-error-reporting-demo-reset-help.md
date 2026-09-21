# 0032. Small own pieces instead of libraries: error reporting, demo reset, help renderer

Date: 2026-09-19 · Status: accepted

## Context

§6.15 asks for "Sentry (o compatible)", §7 for a nightly reset of the demo, §6.14 for 8–10 help articles generated from Markdown. §8 forbids large libraries without justification.

## Decision

- **Error reporting**: `lib/report-error.ts` builds a Sentry envelope (three JSON lines) and POSTs it to the DSN's envelope endpoint, fire-and-forget with a 3-second timeout. It is called from Next's `onRequestError` hook, `runAction`, `apiRoute`, the webhooks and the worker (final failures only). `@sentry/nextjs` would add build plugins, client bundles and tracing we do not use. Events carry error type, message, stack and route — never bodies or user data. Works with Sentry and GlitchTip.
- **Demo reset**: the 04:00 job calls `resetDemo()`, which refuses to run without `DEMO_MODE`, deletes only the tenants the seed creates (`perez`, `otra`) with the same `deleteTenantData` the GDPR purge uses, and then runs the exported seed. A test proves a neighbour tenant survives.
- **Help**: `lib/markdown.tsx` renders the subset the articles use into React nodes (no HTML injection possible, only `/` and `https://` links). Articles are files in `content/help`, traced into the server bundle.

## Consequences

- Browser-side errors reach the same tracker through `/api/errors` (added later, still without SDK): message, stack and path only.
- Articles cannot use tables, images or nested lists until the renderer grows or is replaced.
