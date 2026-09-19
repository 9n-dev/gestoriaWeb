# Portal de clientes para gestorías

Multi-tenant, white-label client portal for small Spanish accounting firms (_gestorías_). It sits
between the gestoría and its clients to organise document intake, tax deadlines and communication.

The product specification is [`CLAUDE.md`](CLAUDE.md). The approved folder structure, data model
summary and permission matrix are in [`docs/foundation.md`](docs/foundation.md); the reasoning behind
each decision is in [`docs/adr/`](docs/adr). Known shortcuts live in
[`docs/tech-debt.md`](docs/tech-debt.md).

**Status: phase 8 of 10.** Sign-up and onboarding, clients and tax obligations,
document intake with a manager inbox, checklists with a traffic light, filings, daily reminders, messaging
(also by replying to emails), a notification centre with web push, and deliveries with simple signature.
White label is complete (logo, favicon, colours with contrast check, sender name, custom domain, sending domain, editable emails). AI extraction of invoices and the accounting export are in. Billing of the gestoría to its clients is in. Still to come:
2FA, rate limiting, CSP and GDPR operations (9), PWA/offline and polish (10). **Do not onboard real gestorías
before phase 9**: staff 2FA and rate limiting are not in place yet (TD-001, TD-002).

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
npm run dev                     # the app
npm run worker                  # in a second terminal: file pipeline (antivirus, HEIC, duplicates)
```

Without the worker, uploaded files stay in "Analizando…" and cannot be opened or processed.

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

| Script                              | What it does                                                                                                                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev` / `build` / `start`   | Next.js                                                                                                                                                                                  |
| `npm run lint`                      | ESLint + Prettier check (`npm run format` fixes formatting)                                                                                                                              |
| `npm run typecheck`                 | `tsc --noEmit`                                                                                                                                                                           |
| `npm test`                          | Vitest: unit + integration, against the `gestoria_test` database (migrated automatically)                                                                                                |
| `npm run worker`                    | BullMQ worker (`src/jobs/worker.ts`)                                                                                                                                                     |
| `npm run job:daily -- [YYYY-MM-DD]` | Runs the morning job (reminders, notices, upkeep) for every tenant, now                                                                                                                  |
| `npm run test:e2e`                  | Playwright: onboarding, upload → book/reject by keyboard, 10 photos over 3G. Starts the app and a worker itself; needs `docker compose up -d` and `npx playwright install chromium` once |
| `npm run db:migrate`                | `prisma migrate dev`                                                                                                                                                                     |
| `npm run db:seed`                   | Idempotent demo seed                                                                                                                                                                     |
| `npm run db:reset`                  | Drop, migrate and seed the development database. Run it yourself: Prisma blocks it for AI agents                                                                                         |

Tests need `docker compose up -d` (Postgres). They never touch the development database.

## Environment variables

Validated with Zod in [`src/env.ts`](src/env.ts); the app, the build and the tests refuse to start
with an incomplete configuration. Never read `process.env` elsewhere (ESLint enforces it).

| Variable                                                                                             | Required | Notes                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                       | yes      | Pooled connection in production (Neon)                                                                                                      |
| `DIRECT_URL`                                                                                         | yes      | Direct connection for migrations. Same as `DATABASE_URL` in development                                                                     |
| `REDIS_URL`                                                                                          | yes      | Redis in Docker / Upstash                                                                                                                   |
| `AUTH_SECRET`                                                                                        | yes      | ≥ 32 chars. `openssl rand -base64 32`                                                                                                       |
| `APP_DOMAIN`                                                                                         | yes      | Platform base domain. Tenants live on `<slug>.<APP_DOMAIN>`                                                                                 |
| `DEFAULT_TENANT_SLUG`                                                                                | no       | Serves one tenant on the bare `APP_DOMAIN` (which otherwise is the platform host)                                                           |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`                  | yes      | MinIO in development, Cloudflare R2 in production                                                                                           |
| `RESEND_API_KEY`                                                                                     | no       | Without it, emails go to `email_log` + console                                                                                              |
| `EMAIL_FROM`                                                                                         | no       | Default `no-reply@localhost`                                                                                                                |
| `CLAMAV_HOST`, `CLAMAV_PORT`                                                                         | no       | clamd address. Empty = development fake scanner                                                                                             |
| `RESEND_WEBHOOK_SECRET`                                                                              | no       | Signing secret of the Resend inbound webhook. Empty = only the unsigned development payload is accepted, and never in production            |
| `INBOUND_EMAIL_DOMAIN`                                                                               | no       | Domain of the per-client addresses `<slug>-<code>@…`. Default `docs.localhost`                                                              |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GOCARDLESS_ACCESS_TOKEN`, `GOCARDLESS_WEBHOOK_SECRET` | no       | Card and SEPA payments. Empty keys = payments are simulated; webhooks always require their secret                                           |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`                                                               | no       | AI extraction of invoice fields (default model `claude-opus-5`). Empty key = development parser that only reads the synthetic demo invoices |
| `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `PLATFORM_CNAME_TARGET`                                         | no       | Attach verified custom domains to the Vercel project (SSL). Empty = verified by TXT, attach by hand                                         |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`                                                              | no       | Web push. `npx web-push generate-vapid-keys`. Empty = pushes are only logged                                                                |
| `DEMO_MODE`                                                                                          | no       | `true` shows the demo banner and demo users on the login page                                                                               |
| `SENTRY_DSN`                                                                                         | no       | Not wired yet (TD-011)                                                                                                                      |

### External services and their development fakes

| Service        | Needed for                  | Without a key                                                                                                                                                                                           |
| -------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resend         | Sending email               | `sendEmail()` stores the message in `email_log` (status `LOGGED_ONLY`) and prints it                                                                                                                    |
| Cloudflare R2  | File storage                | MinIO from docker-compose (same S3 API)                                                                                                                                                                 |
| Neon / Upstash | Production Postgres / Redis | Docker containers                                                                                                                                                                                       |
| ClamAV         | Antivirus                   | Fake scanner: everything is clean except the [EICAR test file](https://www.eicar.org/download-anti-malware-testfile/). Real one: `docker compose --profile antivirus up -d` and `CLAMAV_HOST=localhost` |
| Resend inbound | Documents by email          | `POST /api/webhooks/resend-inbound` accepts a development payload with inline base64 attachments (see `modules/documents/inbound/fake.ts`)                                                              |

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

## Documents

```
browser ──(1) POST /api/uploads ─────────────► app: can() · StoredFile PENDING + Document · S3 multipart
        ──(2) PUT part (presigned, 5 min) ───► bucket            (retry with backoff, resumable)
        ──(3) POST …/complete ───────────────► app: real size · UPLOADED · enqueue
worker  ──(4) sniff bytes → ClamAV → HEIC→JPEG → SHA-256 → exact duplicate? ──► CLEAN | INFECTED
anyone  ──(5) GET /api/files/:id ────────────► app: can() · audit · 302 to a 5-minute signed URL
```

- Photos are resized in the browser to 2500 px / JPEG 0.8 before upload. Limits: 20 MB; JPG, PNG, PDF,
  HEIC, decided from the bytes.
- Inbound email: each client has an address `<tenant-slug>-<code>@INBOUND_EMAIL_DOMAIN`. Attachments
  become documents (`source = EMAIL`); an email without attachments becomes a message in the client's
  general thread.
- Duplicates: exact (hash, closed automatically) and by supplier NIF + number + date (flagged, the manager
  confirms).
- Inbox shortcuts (`/panel/bandeja`): `J`/`K` next/previous · `B` book · `R` reject · `D` duplicate ·
  `E` edit fields · `Enter` confirm data · `Esc` leave a field. Shortcuts are ignored while typing.
- Production bucket (R2) needs a CORS rule allowing `PUT` from the portal origins; MinIO allows it by default.

See ADR 0016–0018.

## Checklists, filings and reminders

- **Checklist**: generated per client and VAT period from the tax profile. Items tick themselves when a
  document of that type arrives for the period; a manager can tick ("no payrolls this quarter"), add or
  remove items. **Traffic light**: green = nothing missing · amber = missing, more than 7 days to the first
  filing of the period · red = missing and 7 days or fewer, or overdue. Overview with filters and CSV export
  in `/panel/semaforo`. "Cerrar documentación" blocks client uploads for that period.
- **Filings**: `PENDING_DOCS → IN_PROGRESS → FILED` with result (pay / refund / zero), amount, direct debit and
  receipt; the client is notified and sees it in `/plazos`. Calendar of what is due in `/panel/plazos`.
- **Every day at 08:00 Europe/Madrid** the worker runs, per tenant and idempotently (`ReminderLog`):
  one message per client with the forms due in 15, 7, 2 and 0 days and the concrete list of missing
  documents; a notice to the manager about clients silent for N days; expiry notices of permanent documents
  (60/30/7); checklist upkeep; obligations of the next year from 1 December. Offsets, on/off and N are
  tenant settings (`/panel/ajustes/recordatorios`). A `cleanup` job removes dead sessions, tokens, unverified
  sign-ups and abandoned uploads.
- **Dead letters**: jobs retry 5 times with exponential backoff and then stay in BullMQ's failed set, listed
  (ids only) with a retry button for superadmins in `/plataforma/jobs`.

To try the morning run without waiting for 08:00: `npm run job:daily -- 2026-10-13` (any date; omit it for
today). It is the same idempotent code the scheduler runs; read the result in the `email_log` table.

See ADR 0019–0020.

## Messaging, notifications and deliveries

- **Threads** per client: general, period, requirement (Hacienda) and internal. Internal threads, their
  attachments and their notifications never reach a client user — enforced in `can()` (`resource.internal`),
  not in the UI. `@Name Surname` mentions notify colleagues in internal threads. Canned replies with
  `{{cliente}}`, `{{plazo}}`, `{{pendientes}}` are managed in Ajustes → Plantillas.
- **Replies by email**: every notification email has `Reply-To: reply+<token>@INBOUND_EMAIL_DOMAIN`; the inbound
  webhook turns the answer into a message, through the same permission checks as the web (ADR 0022).
- **Notifications**: `notifyUsers()` is the only fan-out — in-app always, email and web push by user preference
  (`/cuenta`). The bell in the header shows the unread count.
- **Deliveries**: documents the gestoría hands to the client, optionally visible from a later date and
  optionally requiring conformity. Signing stores timestamp, IP, browser and the SHA-256 of the file and
  generates a PDF certificate (ADR 0023). Staff see who viewed, downloaded and signed.

Behind a reverse proxy other than Vercel, make sure it **overwrites `X-Forwarded-Host`**: tenant resolution
reads it before `Host` (TD-047).

See ADR 0021–0023.

## Billing

Monthly fees per client are invoiced by the daily job on day 1. Invoices are numbered when issued, inside a
transaction that locks the series row (no gaps, no duplicates), chained by hash (`InvoiceCompliance`, ready for
Verifactu) and rendered to PDF with the legally required content. Cancelling issues a rectifying invoice. Clients
pay by card (Stripe Checkout) or SEPA debit (GoCardless) through `PaymentProvider`; webhooks
(`/api/webhooks/stripe`, `/api/webhooks/gocardless`) verify the signature and process each event once. Unpaid
invoices: overdue → reminders at 3/10/20 days → `DELINQUENT` at 30 (uploads allowed, downloads blocked except
their invoices). See ADR 0027.

## AI extraction and accounting export

Once a document is clean, the worker asks the `DocumentExtractor` (Claude with vision and structured outputs,
or the development parser) for supplier, NIF, number, date, base, VAT and total. The answer is validated, retried
once with the list of problems, and falls back to manual entry. Managers see the proposal with its confidence in
the inbox and confirm it with `Enter`. Token usage is logged per tenant (Ajustes → Documentos).
`fixtures/invoices/` holds the 10 synthetic invoices of the acceptance test (`npx tsx fixtures/generate.ts`
regenerates them). `/panel/exportar` downloads a period as XLSX or CSV with the tenant's columns and decimal
separator. See ADR 0025–0026.

## White label

Ajustes → Marca / Dominio / Emails. A custom domain only resolves to its tenant after our DNS lookup finds the
TXT token; then it is attached to the deployment (`DomainProvider`). The sending domain shows SPF, DKIM and DMARC
with their status (`EmailDomainProvider`); once verified, emails leave from `no-reply@<domain>`. Every system
email has editable wording with a preview and is sent with a branded HTML version. `lib/i18n` holds the Spanish
dictionary and empty `ca`, `gl`, `eu`, `en` ones that fall back to it. See ADR 0024.

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
