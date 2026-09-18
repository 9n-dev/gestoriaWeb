# Portal de clientes para gestorías

Multi-tenant, white-label client portal for small Spanish accounting firms (_gestorías_). It sits
between the gestoría and its clients to organise document intake, tax deadlines and communication.

The product specification is [`CLAUDE.md`](CLAUDE.md). The approved folder structure, data model
summary and permission matrix are in [`docs/foundation.md`](docs/foundation.md); the reasoning behind
each decision is in [`docs/adr/`](docs/adr). Known shortcuts live in
[`docs/tech-debt.md`](docs/tech-debt.md).

**Status: phase 2 of 10.** A gestoría can sign up, go through onboarding, import and invite its clients,
assign tax profiles and get every upcoming tax obligation with its real deadline. Documents, checklists,
messaging and billing arrive in later phases.

## Requirements

- Node.js 22+, npm
- Docker with Compose v2

## Getting started

```bash
cp .env.example .env            # defaults work with docker-compose as is
docker compose up -d            # Postgres (5433), Redis, MinIO (+ bucket)
npm install
npm run db:migrate              # apply migrations to the development database
npm run db:seed                 # demo tenants and users
npm run dev
```

Every demo user has the password `demo1234`. Browsers resolve `*.localhost` on their own, no
`/etc/hosts` needed.

| Host                          | User                                | Role                                                            |
| ----------------------------- | ----------------------------------- | --------------------------------------------------------------- |
| <http://perez.localhost:3000> | `admin@demo.es`                     | TENANT_ADMIN                                                    |
|                               | `supervisor@demo.es`                | SUPERVISOR                                                      |
|                               | `gestor@demo.es`, `gestor2@demo.es` | MANAGER (6 clients each)                                        |
|                               | `cliente@demo.es`                   | CLIENT_USER                                                     |
| <http://otra.localhost:3000>  | `admin@demo.es`                     | TENANT_ADMIN of a second tenant (same email, different account) |
| <http://localhost:3000>       | `superadmin@demo.es`                | SUPERADMIN (platform). `/registro` is the public sign-up        |

The seed creates "Gestoría Pérez & Asociados" with 12 clients of varied tax profiles and their
obligations; the demo client always has one deadline four days ahead.

Magic links are printed in the `npm run dev` console and stored in the `email_log` table while
`RESEND_API_KEY` is empty.

ClamAV is heavy and not needed until phase 3: `docker compose --profile antivirus up -d`.

## Scripts

| Script                            | What it does                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm run dev` / `build` / `start` | Next.js                                                                                          |
| `npm run lint`                    | ESLint + Prettier check (`npm run format` fixes formatting)                                      |
| `npm run typecheck`               | `tsc --noEmit`                                                                                   |
| `npm test`                        | Vitest: unit + integration, against the `gestoria_test` database (migrated automatically)        |
| `npm run test:e2e`                | Placeholder until phase 3 (Playwright)                                                           |
| `npm run db:migrate`              | `prisma migrate dev`                                                                             |
| `npm run db:seed`                 | Idempotent demo seed                                                                             |
| `npm run db:reset`                | Drop, migrate and seed the development database. Run it yourself: Prisma blocks it for AI agents |

Tests need `docker compose up -d` (Postgres). They never touch the development database.

## Environment variables

Validated with Zod in [`src/env.ts`](src/env.ts); the app, the build and the tests refuse to start
with an incomplete configuration. Never read `process.env` elsewhere (ESLint enforces it).

| Variable                                                                            | Required | Notes                                                                             |
| ----------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                      | yes      | Pooled connection in production (Neon)                                            |
| `DIRECT_URL`                                                                        | yes      | Direct connection for migrations. Same as `DATABASE_URL` in development           |
| `REDIS_URL`                                                                         | yes      | Redis in Docker / Upstash                                                         |
| `AUTH_SECRET`                                                                       | yes      | ≥ 32 chars. `openssl rand -base64 32`                                             |
| `APP_DOMAIN`                                                                        | yes      | Platform base domain. Tenants live on `<slug>.<APP_DOMAIN>`                       |
| `DEFAULT_TENANT_SLUG`                                                               | no       | Serves one tenant on the bare `APP_DOMAIN` (which otherwise is the platform host) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | yes      | MinIO in development, Cloudflare R2 in production                                 |
| `RESEND_API_KEY`                                                                    | no       | Without it, emails go to `email_log` + console                                    |
| `EMAIL_FROM`                                                                        | no       | Default `no-reply@localhost`                                                      |
| `DEMO_MODE`                                                                         | no       | `true` shows the demo banner and demo users on the login page                     |
| `SENTRY_DSN`                                                                        | no       | Not wired yet (TD-011)                                                            |

### External services and their development fakes

| Service        | Needed for                  | Without a key                                                                        |
| -------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| Resend         | Sending email               | `sendEmail()` stores the message in `email_log` (status `LOGGED_ONLY`) and prints it |
| Cloudflare R2  | File storage                | MinIO from docker-compose (same S3 API)                                              |
| Neon / Upstash | Production Postgres / Redis | Docker containers                                                                    |

Later phases add Anthropic (extraction), Stripe and GoCardless, each behind an interface with a fake
implementation.

## Architecture

```
src/
  env.ts                 validated configuration
  auth.ts                Auth.js: `password` and `magic-link` credentials providers
  app/                   routes only: (auth) (client) (staff) (platform) api/
  modules/<domain>/      schema.ts (Zod) · service.ts (logic, calls can()) · repository.ts (data)
  lib/                   db, errors, email, redis, storage, health
tests/setup/             test database bootstrap, factories, full-tenant fixture world
prisma/                  schema, migrations (+ down.sql), seed
```

**Tenancy.** The tenant is resolved from the `Host` header
([`modules/tenants/resolve.ts`](src/modules/tenants/resolve.ts)): `<slug>.<APP_DOMAIN>` or a verified
custom domain. All tenant data is accessed through `tenantDb(tenantId)`
([`lib/db.ts`](src/lib/db.ts)), a Prisma extension that forces `tenantId` into every query; the id
always comes from the session, never from the client. The unscoped `prisma` client is reserved for
authentication, tenant resolution, platform code and tests.
[`modules/tenants/isolation.test.ts`](src/modules/tenants/isolation.test.ts) seeds one row of every
tenant-owned model and proves another tenant cannot list, count, modify or delete any of them; it
fails when a new model is not covered.

**Authentication.** Auth.js v5 with the JWT strategy. The JWT only carries the id of a `UserSession`
row, checked on every `requireUser()`: sessions are revocable and expire after 12 h (staff) or 30 d
(clients). A session is only valid on the host of its own tenant. Five failed passwords lock the
account for 15 minutes. Magic links are single-use, expire in 15 minutes and are consumed on POST.
Users are unique per tenant, not globally (ADR 0001).

**Authorization.** One function, `can(user, action, resource)`, and one matrix in
[`modules/auth/permissions.ts`](src/modules/auth/permissions.ts). No role checks anywhere else:
layouts use `requireArea()`, services use `assertCan()`, repositories get their filter from
`scopeFor()`.

**Audit.** `recordAudit()` is insert-only; a database trigger rejects `UPDATE` and `DELETE` on
`audit_logs` (ADR 0008).

**Errors.** Only `AppError` crosses the server boundary; `toUserMessage()` collapses anything else
into a generic Spanish message.

### Conventions

- UI copy, emails and user-facing errors in Spanish; code, commits and docs in English.
- In `tenantDb` writes use scalar foreign keys (`clientId: id`), not `connect`.
- Migrations are never edited once applied. Each one ships a hand-written `down.sql` (TD-010).
- Conventional Commits, one branch per phase, non-trivial decisions as ADRs.

## Health

`GET /api/health` → `{ status, checks: { db, redis, storage } }`, `200` or `503`. Failure details go
to the server log, never to the response.

## Deployment

Target: Vercel (app) + Neon (Postgres) + Upstash (Redis) + Cloudflare R2 (files); BullMQ workers on
Railway or Fly.io from phase 4. Run `npx prisma migrate deploy` against `DIRECT_URL` before promoting
a build. A wildcard domain `*.<APP_DOMAIN>` must point to the app for tenant subdomains. Detailed
steps will be added when the first deployable phase (5) is complete.

## Fiscal reference data

Everything lives in [`data/`](data) and is loaded by `seedSystemData()` (run by `npm run db:seed`;
idempotent, safe on every deploy).

| File                       | Content                                                                   | Source · last update                                                                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tax-calendar-<year>.json` | **Nominal** filing deadlines per form and period for fiscal year `<year>` | General statutory deadlines (LGT and the VAT, IRPF and IS regulations); to be reviewed every year against AEAT's [Calendario del contribuyente](https://sede.agenciatributaria.gob.es/Sede/ayuda/calendario-contribuyente.html) · 2026-09-18 |
| `holidays.json`            | National, non-replaceable holidays 2025-2028                              | BOE, yearly resolution of the Dirección General de Trabajo · 2026-09-18                                                                                                                                                                      |
| `tax-profiles.json`        | System tax profile templates                                              | Own                                                                                                                                                                                                                                          |

The real deadline is computed by the app: a nominal date that falls on Saturday, Sunday or national
holiday moves to the next business day (`modules/obligations/deadlines.ts`). Only deadlines that are
still ahead are generated (ADR 0013).

> The calendars were written from the general rules, not copied from AEAT's yearly publication.
> Check them against it before relying on them in production, especially years with moved dates.

### Adding a fiscal year

1. Copy the latest `data/tax-calendar-<year>.json`, adjust `year`, the dates and `updatedAt`.
2. Register it in `FILES` in [`modules/obligations/calendar.ts`](src/modules/obligations/calendar.ts).
3. Add that year's (and the following January's) holidays to `data/holidays.json`.
4. `npm test` (the deadline tests read the real files), then `npm run db:seed` on each environment.

Obligations for year N+1 are generated from 1 December of year N, so the file must exist before then.

### Adding a tax profile

- **For one gestoría**: Ajustes → Perfiles fiscales → clone a system profile and edit the copy. Saving
  re-syncs the obligations of every client that uses it.
- **For everybody (system template)**: add an entry to `data/tax-profiles.json` (`rules` must satisfy
  `taxProfileRulesSchema`: regime, VAT periodicity, flags, `models`, `checklist`) and run
  `npm run db:seed`. `models` is what drives generation; every model must exist in the tax calendars.
  Templates are matched by `name`, so renaming one creates a new template.
- **A new form (modelo)**: add it to every `tax-calendar-<year>.json` with its periods; it then shows up
  in the profile editor.
