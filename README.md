# Portal de clientes para gestorías

[![CI](https://github.com/9n-dev/gestoriaWeb/actions/workflows/ci.yml/badge.svg)](https://github.com/9n-dev/gestoriaWeb/actions/workflows/ci.yml)

A multi-tenant, white-label SaaS for small Spanish accounting firms (_gestorías_, 1 to 10 people). It does
not replace their accounting program: it sits between the gestoría and its clients (freelancers and small
companies) and puts order in the three things that eat their week — chasing documents, tax deadlines and
scattered conversations. Each gestoría runs it on its own domain, with its logo and colours.

The interface, emails and help are in Spanish; code, commits and documentation are in English.

| The client photographs an invoice from the phone                                                                                                                                     | The manager works through the inbox with the keyboard only                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src="docs/screenshots/demo-cliente-sube.gif" alt="A client opens the portal on a phone, taps Subir documentos, the photo uploads and shows up in Mis documentos" width="260" /> | <img src="docs/screenshots/demo-gestor-teclado.gif" alt="A manager moves through the inbox with J and K, confirms the extracted data with Enter, books with B and opens the reject dialog with R" width="640" /> |

Both recorded from the demo data with `npm run demo:gifs`. Every name, tax id and document shown anywhere
in this repository is synthetic.

## What it does

- **Document intake** from the web, an installable PWA with camera access, or by forwarding an email.
  Uploads go straight to the bucket in resumable parts, survive a lost connection (IndexedDB queue) and pass
  an antivirus and duplicate check before anybody can open them.
- **A keyboard-driven inbox** for the gestoría: preview on the right, `J`/`K` to move, `B` book, `R` reject
  with a reason, `D` duplicate, `E` edit, `Enter` confirm, `L` read again with AI.
- **AI extraction** of supplier, tax id, number, date, base, VAT and total (Claude with vision behind a
  `DocumentExtractor` interface), validated, retried once, with a confidence indicator and token usage per
  tenant.
- **Tax calendar**: obligations generated from each client's tax profile (303, 130, 111, 115, 390, 180,
  200...), real deadlines on business days, checklists per period, a traffic light per client and
  escalating reminders that name exactly what is missing.
- **Conversations** per client and subject, internal threads with mentions, replies by email that land in
  the thread, in-app, email and web push notifications.
- **Deliveries with a simple signature**: timestamp, IP, user agent and the SHA-256 of the exact file, with
  a PDF certificate.
- **Billing of the gestoría to its clients**: monthly fees, gap-free numbering under a row lock, invoices
  chained by hash (Verifactu-ready), PDF with a vector QR, Stripe and GoCardless behind one interface,
  idempotent webhooks, dunning.
- **White label**: logo, colours with automatic contrast checks (and a dark-theme variant computed for
  them), custom domain verified by DNS, sending domain with SPF/DKIM/DMARC status, editable emails.
- **Security and GDPR**: tenant isolation proven by a test that enumerates every model, one `can()` for all
  permissions, TOTP 2FA with single-use codes, revocable sessions, nonce-based CSP, rate limiting,
  append-only audit log, data processing agreements on record, client export and erasure, retention with
  notice, tenant export and physical purge.

## In numbers

|                                     |                                                                                                                                                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application code                    | about 24,000 lines of TypeScript in `src/`, strict mode, no `any`, no `@ts-ignore`                                                                                                                                         |
| Tests                               | 491 unit and integration tests in 66 files (Vitest, real PostgreSQL) and 18 end-to-end tests in 10 specs (Playwright), also run against the production build                                                               |
| Data model                          | 36 Prisma models, 8 migrations, each with a hand-written `down.sql`                                                                                                                                                        |
| Decisions                           | 35 architecture decision records in [`docs/adr/`](docs/adr)                                                                                                                                                                |
| Runtime dependencies                | 17. PDF writer, PNG decoder, ZIP and XLSX reader and writer, TOTP, QR drawing, Markdown renderer and Sentry-compatible error reporting are written in-house on top of `node:crypto` and `node:zlib` (see the ADRs for why) |
| Lighthouse (mobile, client screens) | performance 97 to 100, accessibility 100, on the local production build (2026-09-21)                                                                                                                                       |
| Known shortcuts                     | listed one by one, open and closed, in [`docs/tech-debt.md`](docs/tech-debt.md)                                                                                                                                            |

## Stack

Next.js 15 (App Router, Server Components) · TypeScript · Tailwind CSS 4 · PostgreSQL with Prisma · Auth.js
v5 · S3-compatible storage (MinIO in development, Cloudflare R2 in production) · BullMQ on Redis · Resend ·
Anthropic API · Zod at every boundary · Vitest and Playwright · Docker Compose for development · GitHub
Actions.

## Contents

- [Screenshots](#screenshots)
- [Getting started](#getting-started) · [Scripts](#scripts) · [Environment variables](#environment-variables)
- [Architecture](#architecture) ([diagrams](docs/architecture.md))
- Modules: [Documents](#documents) · [Checklists, filings and reminders](#checklists-filings-and-reminders) ·
  [Messaging](#messaging-notifications-and-deliveries) · [Billing](#billing) ·
  [AI extraction and export](#ai-extraction-and-accounting-export) · [Security and GDPR](#security-and-gdpr) ·
  [PWA, offline and help](#pwa-offline-and-help) · [White label](#white-label)
- [Deployment](#deployment) · [Fiscal reference data](#fiscal-reference-data)
- [Definition of done](#definition-of-done) · [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) · [License](#license)

The product specification is [`CLAUDE.md`](CLAUDE.md). The approved folder structure, data model summary
and permission matrix are in [`docs/foundation.md`](docs/foundation.md).

## Screenshots

Taken from the demo data (`npm run db:seed`, `DEMO_MODE=true`) with `npm run screenshots`.

### The gestoría's panel

| Inbox with keyboard shortcuts and preview                                         | Documentation traffic light                                                |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| ![Inbox: documents to process with the PDF preview](docs/screenshots/bandeja.png) | ![Traffic light of the quarter, per client](docs/screenshots/semaforo.png) |

| Dashboard                                                                                                             | Client record                                                                               |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| ![Dashboard: clients in red, documents to process, filings of the week, load per manager](docs/screenshots/panel.png) | ![Client record with checklist, obligations and access](docs/screenshots/cliente-ficha.png) |

| Tax deadlines                                                                  | Conversation with a client                                                                                   |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| ![Upcoming tax deadlines of all clients](docs/screenshots/plazos-gestoria.png) | ![A tax-office requirement discussed between the gestoría and its client](docs/screenshots/conversacion.png) |

| Billing                                                                                              | Accounting export                                                                             |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| ![Invoices issued by the gestoría and the multi-line invoice form](docs/screenshots/facturacion.png) | ![Export of a period to XLSX or CSV with the tenant's columns](docs/screenshots/exportar.png) |

<details>
<summary>Settings: branding, domain, team, billing, reminders, tax profiles, data and privacy, support mode</summary>

|                                                                                                         |                                                                                                                      |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| ![Branding: logo, colours with contrast check, sender name](docs/screenshots/ajustes-marca.png)         | ![Custom domain and sending domain with DNS instructions](docs/screenshots/ajustes-dominio.png)                      |
| ![Team: roles, disabling with hand-over of clients, 2FA reset](docs/screenshots/ajustes-equipo.png)     | ![Billing settings: payment term, reminders, delinquency, series](docs/screenshots/ajustes-facturacion.png)          |
| ![Reminder wording per step, with preview](docs/screenshots/ajustes-recordatorios.png)                  | ![Tax profiles: system templates that the gestoría clones and edits](docs/screenshots/ajustes-perfiles-fiscales.png) |
| ![GDPR operations: export, client erasure, retention, cancellation](docs/screenshots/ajustes-datos.png) | ![Support mode: a read-only, expiring window for the platform's support](docs/screenshots/ajustes-soporte.png)       |

</details>

<details>
<summary>Platform: public sign-up and the superadmin's list of gestorías</summary>

|                                                                |                                                                                                     |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| ![Public sign-up of a gestoría](docs/screenshots/registro.png) | ![Superadmin: tenants, status, suspension, undo of a cancellation](docs/screenshots/plataforma.png) |

</details>

### The client's portal, on a phone

<p>
  <img src="docs/screenshots/movil-inicio.png" alt="Client home: what is missing and for when" width="230" />
  <img src="docs/screenshots/movil-subir.png" alt="Upload: camera or files, resumable" width="230" />
  <img src="docs/screenshots/movil-documentos.png" alt="The client's documents and their status" width="230" />
  <img src="docs/screenshots/movil-plazos.png" alt="The client's tax deadlines" width="230" />
</p>
<p>
  <img src="docs/screenshots/movil-mensajes.png" alt="Conversations with the gestoría" width="230" />
  <img src="docs/screenshots/movil-entregas.png" alt="Deliveries from the gestoría, some to sign" width="230" />
  <img src="docs/screenshots/movil-facturas.png" alt="Invoices of the gestoría, payable online" width="230" />
  <img src="docs/screenshots/movil-inicio-oscuro.png" alt="Dark theme: the brand colour is lightened until it reads" width="230" />
</p>

<details>
<summary>Account, two-step verification, help centre and login</summary>

<p>
  <img src="docs/screenshots/movil-cuenta.png" alt="Account: password, 2FA, open sessions, notification preferences" width="230" />
  <img src="docs/screenshots/movil-2fa.png" alt="Enrolling in two-step verification with a QR code" width="230" />
  <img src="docs/screenshots/movil-ayuda.png" alt="Help centre" width="230" />
  <img src="docs/screenshots/movil-ayuda-articulo.png" alt="A help article, rendered from Markdown" width="230" />
</p>

![Login page under the tenant's brand, with the demo users](docs/screenshots/acceso.png)

</details>

### Generated documents

| Invoice (own PDF writer, vector QR, tenant logo) | Signature certificate                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| ![Invoice PDF](docs/screenshots/factura-pdf.png) | ![Certificate of a simple electronic signature](docs/screenshots/certificado-pdf.png) |

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
| `npm run job:demo-reset`            | Deletes and re-seeds the demo tenants now (needs `DEMO_MODE=true`)                                                                                                                       |
| `npm run screenshots`               | Retakes `docs/screenshots` from the running app (production build, demo data)                                                                                                            |
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
| `DEMO_MODE`                                                                                          | no       | `true` shows the demo banner and demo users, resets the demo tenants at 04:00 and **turns 2FA enforcement off**                             |
| `SENTRY_DSN`                                                                                         | no       | Sentry-compatible DSN; server errors are POSTed to its envelope endpoint (no SDK)                                                           |

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

```mermaid
flowchart LR
  B[Browser: PWA, service worker, IndexedDB queue] --> A[Next.js on Vercel: middleware, pages, actions, routes]
  B -- multipart parts, presigned --> S[(S3: R2 / MinIO)]
  A --> P[(PostgreSQL via tenantDb)]
  A -- jobs, rate limits --> R[(Redis)]
  R --> W[BullMQ worker: files and scheduled queues]
  W --> P
  W --> S
  A & W --> X[Resend, Anthropic, Stripe, GoCardless, ClamAV: each behind an interface with a dev fake]
```

More diagrams (a request, a file, the daily job, an invoice) in [`docs/architecture.md`](docs/architecture.md).

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
Verifactu) and rendered to a designed PDF (tenant logo: PNG or JPEG, the branding form converts WebP before upload; tenant colour, VAT and IRPF breakdown, verification QR drawn as
vectors, as many pages as the lines need) with the legally required content. Cancelling issues a rectifying invoice. Clients
pay by card (Stripe Checkout) or SEPA debit (GoCardless) through `PaymentProvider`; webhooks
(`/api/webhooks/stripe`, `/api/webhooks/gocardless`) verify the signature and process each event once. Unpaid
invoices: overdue → reminders at 3/10/20 days → `DELINQUENT` at 30 (uploads allowed, downloads blocked except
their invoices). Payment term, reminder days, the delinquency threshold and the invoice series are edited in
Ajustes → Facturación (a new series starts its own numbering at 1; `R` is reserved for rectifying invoices).
See ADR 0027.

## AI extraction and accounting export

Once a document is clean, the worker asks the `DocumentExtractor` (Claude with vision and structured outputs,
or the development parser) for supplier, NIF, number, date, base, VAT and total. The answer is validated, retried
once with the list of problems, and falls back to manual entry. Managers see the proposal with its confidence in
the inbox and confirm it with `Enter`. Token usage is logged per tenant (Ajustes → Documentos).
`fixtures/invoices/` holds the 10 synthetic invoices of the acceptance test (`npx tsx fixtures/generate.ts`
regenerates them). `/panel/exportar` downloads a period as XLSX or CSV with the tenant's columns and decimal
separator. See ADR 0025–0026.
A read that failed or came out wrong can be repeated from the inbox ("Leer de nuevo", shortcut `L`): the
previous reading is discarded, and a document is never read more than three times (each read costs tokens).

## Security and GDPR

- **2FA** (TOTP + 10 single-use recovery codes) is mandatory for staff and superadmins and optional for
  clients ("Tu cuenta"). After the password a session can only reach `/acceso/2fa` until the code is in.
  A tenant admin resets a colleague's 2FA in Ajustes → Equipo. **Enforcement is off when `DEMO_MODE=true`**
  so the demo users work: never run real tenants in demo mode. Secrets are encrypted with a key derived
  from `AUTH_SECRET` — rotating it forces everybody to enrol again.
- **Team** (Ajustes → Equipo): change a colleague's role, disable them ("dar de baja": their clients must be
  handed to somebody else first, sessions are closed, the row stays for the audit trail) and reactivate
  them. Admins cannot change themselves, so a tenant always keeps an active admin. On a client's page,
  "Retirar acceso" unlinks a person; somebody left without clients is disabled until invited again.
  See ADR 0033.
- **Sessions**: listed and revocable in "Tu cuenta". **Rate limiting** in Redis (fails open) on login,
  2FA, magic links, sign-up, upload initiation and webhooks. **Headers**: `src/middleware.ts` sets a
  nonce-based CSP, HSTS and friends; the bucket (`S3_ENDPOINT`) is the only foreign origin allowed. The
  reverse proxy must overwrite `X-Forwarded-For` and `X-Forwarded-Host`.
- **Agreements**: the tenant admin (platform ↔ gestoría) and every client user (gestoría ↔ client) accept a
  data processing agreement before entering (pages, server actions and API routes alike); acceptances keep IP, user agent and the hash of the text.
  The wording in `src/modules/legal/dpa.ts` is a template: **have it reviewed by your lawyer** and bump
  `DPA_VERSION` when you change it (everybody is asked again).
- **Ajustes → Datos y privacidad**: export everything (ZIP of CSVs + files, built by the worker, link by
  email, 7 days), export or erase one client (30 days of grace, reversible; invoices are kept by law),
  document retention (default 6 years; the admins get a monthly notice and nothing is deleted that a
  notice at least 15 days old did not announce) and cancelling the gestoría (portal closes, export by email,
  physical purge of rows and bucket after 30 days; until then the platform's superadmin can undo it). The daily `cleanup` job runs the sweep.
- **Ajustes → Soporte**: opens a read-only, expiring, audited window for the platform's support team.

See ADR 0028–0030.

## PWA, offline and help

- **Installable** per tenant: `/manifest.webmanifest` carries the gestoría's name and colour, and
  `/api/branding/icon/<size>` draws its icon (initial on the brand colour). The manifest has a
  "Subir documentos" shortcut; from the home screen an invoice is three touches: open → Subir documentos →
  Hacer una foto.
- **Intermittent connection**: every chosen file is stored in IndexedDB before it is sent and removed when
  it arrives. Offline, files wait as "Pendiente de conexión"; they go out on the `online` event or the next
  time `/subir` opens, resuming multipart uploads where they stopped. The service worker (`public/sw.js`)
  caches hashed build assets and answers failed navigations with `/offline`. It never caches pages or API
  responses.
- **Help**: `/ayuda` renders `content/help/NN-slug.md` (public, under the tenant's logo). To add an
  article, drop a Markdown file there: `# Title`, `##`, paragraphs, lists, `**bold**` and links.
- **Errors**: with `SENTRY_DSN`, uncaught request errors, failed actions/API routes/webhooks, jobs that
  exhaust their retries and errors in the browser (through `/api/errors`) are reported. `error.tsx`/`not-found.tsx` give Spanish fallbacks.
- **Demo**: with `DEMO_MODE=true` a banner shows on every page and the worker runs `demo-reset` at 04:00
  (deletes tenants `perez` and `otra`, rows and bucket, and seeds them again).

See ADR 0031–0032.

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

## Definition of done

Checked against §9 of the spec (`CLAUDE.md`):

| Requirement                                                                                                                          | Where it is demonstrated                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A gestoría signs up, brands itself, imports and invites clients and receives documents on its own domain without manual intervention | `e2e/onboarding.spec.ts` (sign-up → agreement → wizard → 20 invited clients), `e2e/upload-and-book.spec.ts`; custom domains verify by DNS TXT and attach through `DomainProvider` (needs `VERCEL_*` keys in production, fake adapter otherwise)                                                                                         |
| No tenant-isolation test fails; no endpoint returns data without `can()`                                                             | `src/modules/tenants/isolation.test.ts` enumerates every tenant model from the Prisma schema and every listing service; all data access goes through services that call `assertCan` and `tenantDb`                                                                                                                                      |
| Lighthouse mobile ≥ 90 performance, ≥ 95 accessibility on client screens                                                             | Production build on localhost, 2026-09-21 (performance/accessibility): `/acceso` 97/100, `/inicio` 100/100, `/subir` 100/100, `/documentos` 100/100, `/plazos` 100/100, `/mensajes` 98/100, `/entregas` 99/100, `/facturas` 99/100, `/cuenta` 99/100. Re-run: `npx lighthouse <url> --form-factor=mobile --extra-headers=<cookie json>` |
| A manager processes 50 documents in a row with the keyboard only                                                                     | Inbox shortcuts (J/K move, B book, Enter confirm, R reject, D duplicate, E edit fields); `e2e/upload-and-book.spec.ts` books and rejects by keyboard                                                                                                                                                                                    |
| A whole tenant can be exported and deleted and the system is left clean                                                              | `src/modules/gdpr/gdpr.test.ts`: after the purge every tenant-owned model counts 0, the bucket prefix is empty and the neighbour tenant is untouched                                                                                                                                                                                    |
| Documented and demonstrable in demo mode                                                                                             | This file; `npm run db:seed` + `DEMO_MODE=true`                                                                                                                                                                                                                                                                                         |

## License

[MIT](LICENSE).
