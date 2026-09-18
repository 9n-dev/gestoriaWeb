# Phase 1 — Infrastructure Implementation Plan

> **Status: completed 2026-09-18** on branch `phase-1`. Deviation from the plan: no `src/middleware.ts` (TD-003) and no Auth.js adapter (ADR 0001).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bootable multi-tenant Next.js app with validated env, Dockerised services, the approved Prisma schema migrated, password + magic-link login with revocable sessions, centralised permissions, append-only audit log, a tenant-isolation test and CI.

**Architecture:** Domain modules under `src/modules/*` (schema/service/repository), thin routes under `src/app`. The tenant is resolved from the request host; every data access goes through `tenantDb(tenantId)`, whose tenant id comes from the session. Auth.js v5 runs with the JWT strategy; the JWT only points to a `UserSession` row that is checked on every `requireUser()`.

**Tech Stack:** Next.js 15.5, React 19, TypeScript 5.9 strict, Tailwind 4, Prisma 6.19 + PostgreSQL 16, next-auth 5 beta, Zod 4, Vitest, ESLint 9 + Prettier, ioredis, @aws-sdk/client-s3, Docker Compose.

**Spec:** `CLAUDE.md` (§2, §3, §4, §6.13, §6.15, §8) · `docs/foundation.md` · `docs/adr/0001`–`0012`

## Global Constraints

- UI copy, emails and user-facing errors in **Spanish**; code, commits and docs in **English**.
- TypeScript strict. No `any`, no `// @ts-ignore`.
- Zod at every boundary: env, forms, server actions, route handlers.
- Tenant id always comes from the session/host, never from client input.
- No role checks outside `src/modules/auth/permissions.ts`.
- Never expose Prisma messages or stack traces: throw `AppError`.
- Server Components by default; no `useEffect` data loading.
- Conventional Commits, small commits, branch `phase-1`.
- Pinned majors: `next@15`, `prisma@6`, `typescript@5.9`, `eslint@9` (TS 7 and ESLint 10 are not supported by `eslint-config-next@15`).
- Host Postgres already uses 5432 on the dev machine → Docker Postgres is published on **5433**.
- Out of scope (later phases): 2FA enrolment (9), rate limiting and CSP (9), BullMQ workers (4), uploads (3). Phase 1 only ships the clients needed by `/api/health`.

## File map

| File | Responsibility |
|---|---|
| `docker-compose.yml` | Postgres 16 (5433), Redis 7, MinIO, ClamAV |
| `.env.example`, `src/env.ts` | Env contract, Zod-validated at boot |
| `src/lib/errors.ts` | `AppError` + `toUserMessage()` |
| `src/lib/db.ts` | Prisma singleton + `tenantDb(tenantId)` |
| `src/lib/redis.ts`, `src/lib/storage/client.ts` | Lazy clients with `ping()` for health |
| `src/lib/email/index.ts` | `sendEmail()`: Resend if key present, else `EmailLog` + console |
| `src/modules/auth/permissions.ts` | `can(user, action, resource?)` and the matrix |
| `src/modules/auth/password.ts` | scrypt hash/verify (node:crypto) |
| `src/modules/auth/service.ts` | `verifyPasswordLogin`, `requestMagicLink`, `consumeMagicLink`, sessions |
| `src/modules/auth/session.ts` | `requireUser()`, `getSessionUser()` |
| `src/auth.ts` | Auth.js config: `password` and `magic-link` credentials providers |
| `src/modules/tenants/resolve.ts` | host → tenant |
| `src/modules/audit/service.ts` | `recordAudit()`, `listAudit()` |
| `src/modules/clients/repository.ts` | First tenant-scoped repository (used by the isolation test and the shells) |
| `src/app/(auth)/acceso/*` | Login page + actions |
| `src/app/(client)/inicio`, `src/app/(staff)/panel` | Role-guarded shells |
| `src/app/api/health/route.ts` | DB + Redis + storage check |
| `prisma/migrations/*`, `prisma/seed.ts` | Initial migration (+ raw SQL) and base demo seed |
| `tests/setup/*` | Test DB bootstrap and factories |
| `.github/workflows/ci.yml` | lint, typecheck, test, build |

---

### Task 1: Scaffold, tooling, Docker, env

**Files:** `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `.prettierrc`, `postcss.config.mjs`, `vitest.config.ts`, `.gitignore`, `docker-compose.yml`, `.env.example`, `src/env.ts`, `src/env.test.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`

**Produces:** `env` (typed object) and `parseEnv(source: Record<string, string | undefined>): Env` from `src/env.ts`. Scripts: `dev build start lint typecheck test test:e2e db:migrate db:seed db:reset format`.

- [ ] Write `src/env.test.ts`: (a) `parseEnv` with a complete source returns typed values (`DEMO_MODE` → boolean); (b) missing `DATABASE_URL` throws an error whose message lists `DATABASE_URL`; (c) `RESEND_API_KEY` is optional.
- [ ] Run `npm test` → fails (module missing).
- [ ] Implement `src/env.ts`. Required: `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, `AUTH_SECRET` (min 32), `APP_DOMAIN`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. Optional: `RESEND_API_KEY`, `EMAIL_FROM` (default `no-reply@localhost`), `DEFAULT_TENANT_SLUG`, `DEMO_MODE` (default false), `SENTRY_DSN`. `env` is parsed once from `process.env` at import; `next.config.ts` imports it so `next build`/`next dev` fail fast.
- [ ] `docker-compose.yml`: `postgres:16-alpine` (5433→5432, db `gestoria`, init script creating `gestoria_test`), `redis:7-alpine`, `minio/minio` (+ one-shot `mc` bucket creation), `clamav/clamav` (profile `antivirus` so it does not slow down every `up`).
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all green. Commit `chore: scaffold next.js app, tooling, docker and env validation`.

### Task 2: Database, errors, tenant-scoped access

**Files:** `prisma/migrations/<ts>_init/migration.sql`, `src/lib/errors.ts`, `src/lib/db.ts`, `tests/setup/global.ts`, `tests/setup/factories.ts`, `src/lib/db.test.ts`, `src/lib/errors.test.ts`

**Produces:**
```ts
class AppError extends Error { code: AppErrorCode; userMessage: string; status: number }
type AppErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION' | 'CONFLICT' | 'RATE_LIMITED' | 'INTERNAL'
function toUserMessage(e: unknown): string          // never leaks Prisma/stack
const prisma: PrismaClient
function tenantDb(tenantId: string): TenantDb        // Prisma client extension
// tests
createTenant(overrides?), createUser(tenantId, role, overrides?), createClient(tenantId, overrides?)
```
`tenantDb` is a Prisma `$extends` query extension over the tenant-owned models: injects `tenantId` into `where` for find*/update*/delete*/count/aggregate, and into `data` for create/createMany/upsert. `findUnique`-style calls are rewritten to `findFirst` semantics by adding the filter. Models without `tenantId` (Period, Holiday, VerificationToken, WebhookEvent) pass through. `AuditLog`, `EmailLog` are not exposed through it.

- [ ] Tests (`src/lib/db.test.ts`, integration): with tenants A and B and one client each — `tenantDb(A).client.findMany()` returns only A's; `findUnique({where:{id: clientB.id}})` → null; `update`/`delete` of B's client by id → throws not found and B's row is unchanged; `create` without tenantId gets A's tenantId; `create` with `tenantId: B` is overridden to A; `count()` is scoped.
- [ ] `npx prisma migrate dev --name init`, then append raw SQL: partial unique index `users_email_platform_key`, function + trigger `audit_logs_append_only` (allows DELETE only when `current_setting('app.audit_purge', true) = 'on'`).
- [ ] `tests/setup/global.ts`: points `DATABASE_URL` to `gestoria_test`, runs `prisma migrate deploy`; a `resetDb()` helper truncates all tables (sets `app.audit_purge` for `audit_logs`).
- [ ] Green → commit `feat(db): initial migration, AppError and tenant-scoped prisma client`.

### Task 3: Permissions

**Files:** `src/modules/auth/permissions.ts`, `src/modules/auth/permissions.test.ts`

**Produces:**
```ts
type SessionUser = { id: string; tenantId: string | null; role: Role; status: UserStatus; clientIds: string[]; supportTenantIds: string[] }
type Resource = { tenantId: string; clientId?: string; assignedManagerId?: string | null; clientStatus?: ClientStatus; periodClosed?: boolean; fileStatus?: FileStatus; internal?: boolean; visibleFrom?: Date; ownerUserId?: string }
type Action = keyof typeof MATRIX           // 'client.read' | 'document.upload' | ...
function can(user: SessionUser, action: Action, resource?: Resource): boolean
function assertCan(user, action, resource?): void   // throws AppError FORBIDDEN
```
`MATRIX: Record<Action, Partial<Record<Role, 'own' | 'assigned' | 'all' | 'self' | 'platform'>>>` transcribed from `docs/foundation.md` §3.

- [ ] Table-driven tests: inactive user denied; cross-tenant denied for every role; CLIENT_USER own vs other client; MANAGER assigned vs unassigned; SUPERVISOR all; `invoice.manage` only TENANT_ADMIN; MANAGER `client.create` allowed, `client.import` denied; DELINQUENT client user: `document.upload` yes, `document.download` no; closed period blocks client upload but not manager; infected file blocks download for everyone; internal thread never for CLIENT_USER; SUPERADMIN without grant denied, with grant `document.read` yes, `document.download` no, `client.update` no; `platform.tenant.create` only SUPERADMIN.
- [ ] Implement, green → commit `feat(auth): centralised permission matrix and can()`.

### Task 4: Audit log

**Files:** `src/modules/audit/schema.ts`, `src/modules/audit/service.ts`, `src/modules/audit/service.test.ts`

**Produces:** `recordAudit(entry: AuditEntry): Promise<void>` (`{ tenantId, actor?: SessionUser | null, action, entity, entityId?, diff?, ip?, userAgent? }`), `listAudit(user, filters)` (asserts `audit.read`). `requestMeta(): Promise<{ip, userAgent}>` reads Next headers.

- [ ] Tests: `recordAudit` inserts; raw `UPDATE audit_logs` rejects; raw `DELETE` rejects; `DELETE` inside a transaction with `SET LOCAL app.audit_purge = 'on'` succeeds; `listAudit` for tenant A never returns B's rows; MANAGER gets FORBIDDEN.
- [ ] Green → commit `feat(audit): append-only audit log service`.

### Task 5: Tenant resolution

**Files:** `src/modules/tenants/resolve.ts`, `src/modules/tenants/resolve.test.ts`

**Produces:** `parseHost(host: string, appDomain: string): { kind: 'platform' } | { kind: 'slug'; slug: string } | { kind: 'custom'; domain: string }` (pure) and `resolveTenant(host): Promise<Tenant | null>` (verified custom domain, or slug subdomain, or `DEFAULT_TENANT_SLUG` when host is the bare app domain in development), `getCurrentTenant()` (cached per request, reads `headers()`).

- [ ] Tests: `perez.app.test:3000` → slug `perez`; `app.test` → platform; `clientes.gestoriaperez.es` → custom; unverified custom domain → null; suspended/cancelled tenant → null; port and case are ignored.
- [ ] Green → commit `feat(tenants): resolve tenant from request host`.

### Task 6: Authentication

**Files:** `src/modules/auth/password.ts`, `src/modules/auth/schema.ts`, `src/modules/auth/service.ts`, `src/modules/auth/session.ts`, `src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/lib/email/index.ts`, tests next to each

**Produces:**
```ts
hashPassword(plain): Promise<string>; verifyPassword(plain, stored): Promise<boolean>     // scrypt, "scrypt$N$salt$hash"
verifyPasswordLogin(tenantId: string | null, email, password, meta): Promise<User>          // throws AppError
requestMagicLink(tenant: Tenant | null, email, baseUrl): Promise<void>                       // always resolves (no user enumeration)
consumeMagicLink(tenantId: string | null, token): Promise<User>
createSession(user, meta): Promise<UserSession>; revokeSession(id); revokeAllSessions(userId)
getSessionUser(): Promise<SessionUser | null>; requireUser(): Promise<SessionUser>          // redirects to /acceso
sendEmail({ tenantId, to, subject, text, html?, replyTo?, templateKey? }): Promise<void>
```
Rules: generic error "Correo o contraseña incorrectos" for unknown user / bad password / disabled; 5 failures → `lockedUntil = now + 15 min` and message "Cuenta bloqueada temporalmente…"; success resets the counter, sets `lastLoginAt`, promotes `INVITED` → `ACTIVE` on magic link, audits `auth.login` / `auth.login_failed`. Session expiry: 12 h staff, 30 d `CLIENT_USER`. Magic-link tokens: 32 random bytes, stored as SHA-256, identifier `<tenantId|platform>:<email>`, 15 min, single use. Auth.js: two Credentials providers (`password`, `magic-link`), `jwt` callback creates the `UserSession` on sign-in and stores `sid`; `events.signOut` revokes it.

- [ ] Tests (integration): correct password → user; wrong password increments counter; 5th failure locks, 6th with the right password still fails; lock expiry allows login; same email in tenants A and B logs into the right one only; user of tenant A cannot log in on tenant B's host; magic link: token works once, expired token fails, unknown email sends nothing but resolves; email fallback writes `EmailLog` with status `LOGGED_ONLY`; `getSessionUser` returns null for revoked/expired session.
- [ ] Green → commit `feat(auth): password and magic-link login with revocable sessions`.

### Task 7: UI shells and health endpoint

**Files:** `src/app/(auth)/acceso/page.tsx`, `src/app/(auth)/acceso/actions.ts`, `src/app/(auth)/acceso/login-form.tsx`, `src/app/(client)/layout.tsx`, `src/app/(client)/inicio/page.tsx`, `src/app/(staff)/panel/layout.tsx`, `src/app/(staff)/panel/page.tsx`, `src/app/page.tsx`, `src/components/ui/{button,input,field}.tsx`, `src/lib/redis.ts`, `src/lib/storage/client.ts`, `src/app/api/health/route.ts`, `src/app/api/health/route.test.ts`

- [ ] `/acceso`: password form + "Enviarme un enlace de acceso"; labelled inputs, visible focus, errors in an `aria-live` region; demo users listed only when `DEMO_MODE`. `/` redirects by role (`CLIENT_USER` → `/inicio`, staff → `/panel`). Layouts call `requireUser()` and redirect the wrong role. Staff panel lists the clients the user may see (through `clients/repository`), client home lists the user's clients. Logout button.
- [ ] `/api/health`: `{ status: 'ok' | 'degraded', checks: { db, redis, storage } }`, 200/503, each check with a 2 s timeout. Test with injected failing checks.
- [ ] Manual check with `npm run dev` on `perez.localhost:3000`. Commit `feat(app): login page, role shells and health endpoint`.

### Task 8: Clients repository + tenant isolation suite

**Files:** `src/modules/clients/repository.ts`, `src/modules/clients/service.ts`, `src/modules/tenants/isolation.test.ts`

**Produces:** `listClientsFor(user)`, `getClientFor(user, id)` — scope from role (own / assigned / all), client-facing select omits `internalNotes`.

- [ ] Isolation suite: for every tenant-owned Prisma model (enumerated from `Prisma.dmmf`, so new models are covered automatically) assert `tenantDb(A)` cannot read a row of B; for services: `listClientsFor`/`getClientFor`/`listAudit` with a user of A never return B; `getClientFor` for a CLIENT_USER has no `internalNotes` key.
- [ ] Green → commit `test(tenants): tenant isolation suite`.

### Task 9: Seed, CI, docs

**Files:** `prisma/seed.ts`, `.github/workflows/ci.yml`, `README.md`, `docs/tech-debt.md`

- [ ] Seed (idempotent, upserts): tenant "Gestoría Pérez & Asociados" (`perez`, ACTIVE), admin@demo.es, supervisor@demo.es, gestor@demo.es, gestor2@demo.es, cliente@demo.es (all `demo1234`), 2 clients assigned to the managers, second tenant `otra` with one user (manual isolation checks), one superadmin.
- [ ] CI: job `quality` (Postgres + Redis services; `npm ci`, `prisma migrate deploy`, lint, typecheck, test, build) and job `e2e` (placeholder that runs `npm run test:e2e --if-present`; Playwright arrives in phase 3).
- [ ] README: install, env vars table, architecture, tenant hosts in dev, external keys and their fakes. `docs/tech-debt.md` with phase-1 debts.
- [ ] Full verification: `npm run lint && npm run typecheck && npm test && npm run build`. Commit `chore: seed, ci workflow and docs`.
