# Foundation (CLAUDE.md §8.1)

Status: **approved 2026-09-18**. Folder structure, data model summary and permission matrix.
The rationale for each decision lives in `docs/adr/`. `permissions.ts` is the source of truth
for the matrix once it exists; keep this file in sync when it changes.

1. [Folder structure](#1-folder-structure)
2. [Data model](#2-data-model) → `prisma/schema.prisma` (validated with `prisma validate`, Prisma 6)
3. [Permissions](#3-permissions)
4. [Decisions](#4-decisions)

---

## 1. Folder structure

```
.
├── CLAUDE.md
├── README.md
├── docker-compose.yml            Postgres, Redis, MinIO, ClamAV
├── .env.example
├── .github/workflows/ci.yml      lint · typecheck · unit+integration · build ; e2e as separate job
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts                   demo tenant (§7) + system tax profiles + holidays + periods
├── data/
│   ├── tax-calendar-<year>.json  AEAT deadlines (source + update date in README)
│   ├── holidays-<year>.json
│   └── tax-profiles.json         system tax profile templates
├── fixtures/                     synthetic invoices/photos for seed and extraction test
├── content/help/*.md             /ayuda articles
├── docs/
│   ├── adr/NNNN-title.md
│   └── tech-debt.md
├── e2e/                          Playwright (3 critical flows)
├── public/                       PWA manifest, icons, service worker
└── src/
    ├── env.ts                    Zod-validated env; app refuses to boot if incomplete
    ├── middleware.ts             host → tenant resolution, security headers, auth gate
    ├── app/                      routes only: composition, no business logic
    │   ├── (auth)/               acceso · registro · verificar · invitacion · 2fa
    │   ├── (client)/             CLIENT_USER portal
    │   │   ├── inicio/  subir/  documentos/  plazos/
    │   │   └── mensajes/  entregas/  facturas/  perfil/
    │   ├── (staff)/panel/        MANAGER · SUPERVISOR · TENANT_ADMIN
    │   │   ├── bandeja/          document inbox (J/K/B/R/D/E/Enter)
    │   │   ├── clientes/[id]/    client file: data, docs, obligations, checklist, threads, deliveries
    │   │   ├── semaforo/  plazos/  mensajes/  metricas/
    │   │   └── ajustes/          TENANT_ADMIN: equipo · marca · dominio · plantillas ·
    │   │                         perfiles-fiscales · facturacion · datos (export/erasure) · soporte
    │   ├── (onboarding)/bienvenida/
    │   ├── (platform)/plataforma/   SUPERADMIN: tenants · jobs fallidos
    │   ├── ayuda/
    │   └── api/
    │       ├── auth/[...nextauth]/
    │       ├── health/
    │       ├── uploads/          multipart: create · sign-part · complete · abort
    │       ├── files/[id]/       permission check → audit → 5-min signed URL redirect
    │       └── webhooks/         resend-inbound · stripe · gocardless
    ├── modules/                  one folder per domain (as in CLAUDE.md §3)
    │   ├── tenants/  auth/  clients/  documents/  obligations/  checklists/
    │   ├── messaging/  deliveries/  billing/  audit/  branding/
    │   └── <module>/
    │       ├── schema.ts         Zod
    │       ├── service.ts        business logic, calls can()
    │       ├── repository.ts     data access, always tenant-scoped
    │       ├── actions.ts        thin server actions: validate → service → return
    │       ├── components/
    │       └── *.test.ts         colocated unit/integration tests
    ├── lib/
    │   ├── db.ts                 Prisma client + tenantDb(tenantId) scoped helper
    │   ├── errors.ts             AppError
    │   ├── storage/              S3 client (R2/MinIO), signed URLs, multipart
    │   ├── email/                EmailSender interface: Resend impl + EmailLog/console fallback
    │   ├── queue/                BullMQ connection, queue definitions, enqueue helpers
    │   ├── dates/                Europe/Madrid helpers, business days
    │   ├── tax-id.ts             NIF/CIF/NIE validation
    │   ├── rate-limit.ts
    │   └── i18n/                 es.json + empty ca/gl/eu/en with fallback
    ├── components/ui/            own primitives (button, table, dialog via Radix…)
    └── jobs/
        ├── worker.ts             entry point for Railway/Fly.io
        └── <job>.ts              one file per job; payload validated with Zod
```

Notes
- User-facing URLs are in Spanish (consistent with `/ayuda`); code identifiers stay English.
- Modules with external providers keep the interface + fake/real adapters inside the module:
  `documents/extraction/` (`DocumentExtractor`), `billing/payments/` (`PaymentProvider`),
  `billing/compliance/` (`InvoiceCompliance`), `documents/antivirus/`.
- Tenant isolation test lives in `src/modules/tenants/isolation.test.ts` and iterates over
  every repository and route handler.

---

## 2. Data model

See `prisma/schema.prisma` — 36 models. Everything listed in CLAUDE.md §5 is covered; models added
beyond that list, each tied to a requirement:

| Model | Why (spec section) |
|---|---|
| `UserSession` | Revocable sessions with 12 h / 30 d expiry (§6.13) |
| `VerificationToken` | Magic link, invitations, email verification (Auth.js) |
| `SupportAccessGrant` | "Modo soporte" with expiry (§4) |
| `LegalAcceptance` | DPA acceptance record (§6.13) |
| `ClientPeriod` | Per-client period state for "cerrar documentación" (§6.5) |
| `StoredFile` | One registry for all bucket objects: upload state, antivirus, hash (§6.3) |
| `MessageAttachment`, `ThreadRead` | Attachments and read state (§5 Thread/Message) |
| `Template` | Tenant message templates + editable email texts (§6.8, §6.12) |
| `RecurringFee`, `InvoiceSeries` | Monthly fee and gap-free numbering with row lock (§6.11) |
| `PushSubscription` | Web push (§6.8) |
| `SavedView` | Saved views per user (§6.10) |
| `WebhookEvent` | Webhook idempotency: Stripe, GoCardless, Resend inbound (§6.11, §8.5) |
| `ReminderLog` | Idempotent scheduled notices: deadlines, expiry, dunning, inactivity (§6.9) |
| `AiUsageLog` | Token cost per tenant (§6.4) |
| `DataExport` | Client/tenant export jobs (§6.13) |

Not modelled on purpose: a `Job` table (BullMQ already keeps failed jobs in Redis; the superadmin
panel reads them from there), an `Invitation` table (a `User` in `INVITED` status + verification
token does the job), a rejection-reason table (list lives in `Tenant.settings`, the label is
snapshotted on the document).

Raw SQL in the first migration (Prisma can't express it):
- Partial unique index on `users(email) WHERE "tenantId" IS NULL` (superadmins).
- Trigger on `audit_logs` rejecting `UPDATE`/`DELETE` unless the purge service sets a
  transaction-local flag during tenant offboarding.

---

## 3. Permissions

`can(user, action, resource?)` in `src/modules/auth/permissions.ts`. Pure function, no DB access:
the caller loads the resource through a tenant-scoped repository and passes it in.

### 3.1 Evaluation order

1. `user.status !== ACTIVE` → deny.
2. **Tenant gate**: `resource.tenantId !== user.tenantId` → deny. Only exception: `SUPERADMIN`
   with a non-expired, non-revoked `SupportAccessGrant` for that tenant → read-only actions.
3. **Role gate**: action must be in the role's list (table below).
4. **Scope gate**, based on the client the resource belongs to:
   - `CLIENT_USER`: `resource.clientId ∈ user.clientIds`
   - `MANAGER`: `client.assignedManagerId === user.id`
   - `SUPERVISOR`, `TENANT_ADMIN`: whole tenant
5. **State gates**:
   - Client `DELINQUENT` → `CLIENT_USER` loses `*.download` (can still upload).
   - `ClientPeriod` `CLOSED` → `CLIENT_USER` loses `document.upload` for that period.
   - File `status !== CLEAN` → nobody gets `*.download`.
   - Thread `INTERNAL` and the `client.internalNotes` field → never for `CLIENT_USER`.

### 3.2 Matrix

Scope: **own** = clients linked to the user · **assigned** = clients assigned to the manager ·
**all** = whole tenant · — = denied.

| Action | CLIENT_USER | MANAGER | SUPERVISOR | TENANT_ADMIN |
|---|---|---|---|---|
| **Clients** | | | | |
| `client.read` | own (no internal fields) | assigned | all | all |
| `client.create` (auto-assigned to the creator when a manager) | — | yes | all | all |
| `client.import` (bulk CSV/XLSX) | — | — | all | all |
| `client.update` | — | assigned | all | all |
| `client.delete` (soft) | — | — | all | all |
| `client.assignManager` | — | — | all | all |
| `client.assignTaxProfile` | — | assigned | all | all |
| `client.readInternalNotes` / `writeInternalNotes` | — | assigned | all | all |
| `client.inviteUser` / `removeUser` | — | assigned | all | all |
| **Documents** | | | | |
| `document.upload` | own | assigned | all | all |
| `document.read` / `document.download` | own | assigned | all | all |
| `document.process` (review, book, reject, duplicate, confirm/edit extraction) | — | assigned | all | all |
| `document.delete` (soft) | own, only while `RECEIVED` | assigned | all | all |
| `document.export` (CSV/XLSX) | — | assigned | all | all |
| `permanentDocument.read` / `download` | own | assigned | all | all |
| `permanentDocument.manage` | — | assigned | all | all |
| **Obligations & checklist** | | | | |
| `obligation.read` | own | assigned | all | all |
| `obligation.update` (status, estimate, file with receipt) | — | assigned | all | all |
| `checklist.read` | own | assigned | all | all |
| `checklist.manage` (add/remove items) | — | assigned | all | all |
| `period.close` / `period.reopen` | — | assigned | all | all |
| `reminder.sendManual` ("reclamar") | — | assigned | all | all |
| **Messaging** | | | | |
| `thread.read` / `thread.create` / `message.send` (non-internal) | own | assigned | all | all |
| `thread.readInternal` / `message.sendInternal` | — | assigned | all | all |
| `thread.close` | — | assigned | all | all |
| `messageTemplate.use` | — | yes | yes | yes |
| **Deliveries** | | | | |
| `delivery.read` / `delivery.download` | own, from `visibleFrom` | assigned | all | all |
| `delivery.sign` | own | — | — | — |
| `delivery.create` / `delete` / `viewHistory` | — | assigned | all | all |
| **Billing** (gestoría → client) | | | | |
| `invoice.read` / `invoice.download` | own | assigned | all | all |
| `invoice.pay` | own | — | — | — |
| `invoice.manage` (draft, issue, cancel, mark paid) | — | — | — | all |
| `recurringFee.manage` | — | — | — | all |
| **Dashboards** | | | | |
| `dashboard.viewOwn` (inbox, own clients' traffic light) | — | yes | yes | yes |
| `dashboard.viewGlobal` (tenant metrics, load per manager) | — | — | yes | yes |
| `savedView.manage` (own) | — | yes | yes | yes |
| **Tenant administration** | | | | |
| `user.manage` (staff: invite, role, disable, reset 2FA) | — | — | — | yes |
| `branding.manage` / `domain.manage` | — | — | — | yes |
| `template.manage` (messages, emails, reminders) | — | — | — | yes |
| `taxProfile.read` | — | yes | yes | yes |
| `taxProfile.manage` (clone, edit, archive) | — | — | — | yes |
| `tenantSettings.manage` (reminders, rejection reasons, retention, dunning) | — | — | — | yes |
| `audit.read` | — | — | — | yes |
| `data.exportClient` / `data.eraseClient` | — | — | — | yes |
| `data.exportTenant` / `tenant.cancel` | — | — | — | yes |
| `support.grant` / `support.revoke` | — | — | — | yes |
| `sampleData.delete` | — | — | — | yes |
| **Self-service** (any active user, own account only) | | | | |
| `account.update`, `account.manage2fa`, `account.revokeSessions`, `notification.read`, `notification.managePrefs`, `push.subscribe` | yes | yes | yes | yes |

### 3.3 SUPERADMIN (platform)

| Action | Condition |
|---|---|
| `platform.tenant.list` / `create` / `suspend` / `delete` | always (tenant metadata only, never client data) |
| `platform.jobs.viewFailed` / `retry` | always (payloads shown redacted: ids only) |
| `platform.health.view` | always |
| every `*.read` of the tenant matrix | **only** with an active `SupportAccessGrant`; read-only, `*.download` always denied; every access audited with `support=true` |

2FA: enforced at login for `MANAGER`, `SUPERVISOR`, `TENANT_ADMIN`, `SUPERADMIN` — a session
without completed TOTP enrolment can only reach the enrolment screen. Optional for `CLIENT_USER`.

---

## 4. Decisions

| ADR | Decision |
|---|---|
| 0001 | User email unique per tenant, custom Auth.js adapter, no `Account` table |
| 0002 | Auth.js JWT strategy + `UserSession` table for revocation and per-role expiry |
| 0003 | `Period` global, per-client state in `ClientPeriod` |
| 0004 | `StoredFile` as single registry of bucket objects |
| 0005 | Isolation by `tenantDb()` + tests; no composite FKs, no RLS in phase 1 |
| 0006 | Tenant FK `Restrict`; physical deletion only through the purge service |
| 0007 | Invoices survive client erasure; cancellation through rectifying invoices |
| 0008 | `AuditLog` without FKs, append-only by trigger; delivery history read from it |
| 0009 | `Obligation.model` is a `String` validated against the tax calendar |
| 0010 | Read state as per-thread pointer (`ThreadRead`) |
| 0011 | Tooling: Prisma 6, npm, Node 22 |
| 0012 | Permission defaults: managers create clients and read invoices of assigned clients; support mode is read-only without downloads |

Left as is until there is a requirement: `Tenant.plan` is a free `String` (no plan list defined);
holidays are national only (`Client` has no region; AEAT deadlines are national).
