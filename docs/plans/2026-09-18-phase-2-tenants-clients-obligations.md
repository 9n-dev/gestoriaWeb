# Phase 2 — Tenants, Onboarding, Clients, Tax Profiles, Obligations

> **Status: completed 2026-09-18** on branch `phase-2`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A gestoría can register, walk through onboarding, import and invite its clients, assign tax profiles and get every upcoming tax obligation generated with the right deadline.

**Architecture:** Domain logic first, as pure functions with unit tests (tax id validation, business-day deadlines, obligation planning), then services that combine `can()` + `tenantDb()` + audit, then thin server actions and pages. Reference data (AEAT calendar, holidays, system tax profiles) lives in `data/*.json` and is loaded by the seed.

**Tech Stack:** as phase 1 + `date-fns`, `date-fns-tz`. No new large libraries: CSV is parsed by a small own parser; XLSX import is deferred (tech debt) because it needs a large dependency and therefore an ADR.

**Spec:** `CLAUDE.md` §6.1, §6.2, §6.6 (deadline calculation only), §7 · `docs/foundation.md`

## Global Constraints

Same as phase 1 (Spanish UI / English code, strict TS, Zod at every boundary, `can()` everywhere, `tenantDb()` for tenant data, `AppError` only, Conventional Commits, branch `phase-2`).

- Every mutation records an audit entry.
- Every new service that returns tenant data gets a case in `modules/tenants/isolation.test.ts`.
- Deferred to their owning phase: permanent documents (3: needs uploads), expiry/next-year jobs (4: needs workers; the functions they will call are built and tested here), contrast validation and custom domain (6), DPA acceptance (9).

## Tasks

### Task 1: Spanish tax id validation — `src/lib/tax-id.ts`
`validateTaxId(raw): { valid: true; normalized: string; kind: 'NIF' | 'NIE' | 'CIF' } | { valid: false }`. NIF: 8 digits + letter `TRWAGMYFPDXBNJZSQVHLCKE[n % 23]`. NIE: X/Y/Z → 0/1/2 then NIF rule. CIF: letter `ABCDEFGHJNPQRSUVW` + 7 digits + control (digit, letter `JABCDEFGHI`, or either, depending on the entity letter). Accepts spaces, dots, dashes and lowercase.
- [ ] Tests: valid/invalid NIF, NIE, CIF with digit control, CIF with letter control (P, Q, S, N, W…), K/L/M NIFs, garbage.

### Task 2: Reference data and deadlines
Files: `data/tax-calendar-{2025,2026,2027}.json`, `data/holidays.json`, `src/lib/dates/index.ts`, `src/modules/obligations/calendar.ts`, `src/modules/obligations/deadlines.ts`, `src/modules/obligations/deadlines.test.ts`.
- `todayInMadrid(): string` (ISO date), `toDateOnly(iso): Date` (UTC midnight), `isoDate(date): string`.
- `nextBusinessDay(iso, holidays: ReadonlySet<string>): string` — Saturdays, Sundays and national holidays are non-business days.
- `getTaxCalendar(year)`: Zod-validated JSON, `null` when the file does not exist. Shape: `{ year, source, updatedAt, models: { [model]: { name, periods: { QUARTER?: {ordinal, due}[]; MONTH?: …; YEAR?: … } } } }` with **nominal** due dates.
- `computeDueDate(nominalIso, holidays)`.
- [ ] `deadlines.test.ts` covers: holiday, weekend, leap year (347 of FY2027 → 29 Feb 2028), year change (Q4 303 → January of next year), consecutive non-business days, 20 Apr 2026 unchanged.

### Task 3: Tax profiles — `src/modules/clients/tax-profiles/{schema,service}.ts`, `data/tax-profiles.json`
`taxProfileRulesSchema` (`regime`, `vatPeriodicity`, `hasEmployees`, `withholdsRent`, `intraCommunity`, `models[]`, `checklist[]`). `suggestModels(flags)` prefills `models`. Service: `listTaxProfiles(user)` (system + tenant), `cloneTaxProfile`, `updateTaxProfile` (tenant-owned only), `archiveTaxProfile`. `seedSystemData(prisma)` in `prisma/system-data.ts` loads profiles and holidays (used by seed and tests).
- [ ] Tests: system profiles are read-only; clone belongs to tenant; tenant B cannot see A's clones; MANAGER can read, not manage; invalid rules rejected.

### Task 4: Obligation generation — `src/modules/obligations/{planner,service}.ts`
- Pure `planObligations(rules, calendars, holidays, fromIso): PlannedObligation[]` (`{ model, year, periodType, ordinal, dueDate }`), only deadlines `>= from`.
- `generateObligationsForClient(tenantId, clientId, { today })`: fiscal years `[Y-1, Y]` (+ `Y+1` in December), upserts `Period`s, `createMany skipDuplicates`. Idempotent.
- `regenerateForProfileChange(...)`: removes future `PENDING_DOCS` obligations that no longer apply, adds the new ones, returns `{ added, removed, kept }`.
- `generateNextYearForAllClients(year)` for the phase-4 December job.
- [ ] Tests: **acceptance §6.2** (EDS, quarterly, no employees, rented premises → 303, 130, 115, 390, 180, 100 with the right dates); idempotency; nothing in the past; monthly VAT; profile change keeps started/filed obligations and reports the diff; tenant isolation.

### Task 5: Clients — `src/modules/clients/{schema,service,repository}.ts`
`createClient` (manager → auto-assigned), `updateClient`, `softDeleteClient`, `assignManager`, `assignTaxProfile` (triggers Task 4), `updateInternalNotes`. Unique `(tenantId, taxId)` → `CONFLICT` with Spanish message.
- [ ] Tests: permissions per role, NIF validation, duplicate NIF, auto-assignment, notes invisible to client users, audit entries.

### Task 6: CSV import — `src/lib/csv.ts`, `src/modules/clients/import.ts`
Own RFC-4180 parser (`;` or `,` autodetected, quotes, BOM). `parseClientImport(text)` → row-by-row report `{ row, errors[] }`; `importClients(user, rows)` all-or-nothing per valid row set, duplicates within the file and against the DB reported. Template served at `/panel/clientes/importar/plantilla`.
- [ ] Tests: separators, quoted fields, BOM, invalid NIF rows, duplicate rows, 20-row happy path.

### Task 7: Invitations — `src/modules/auth/invitations.ts`
`inviteStaff(user, { email, name, role })`, `inviteClientUser(user, clientId, { email, name })`, `inviteClientsInBulk(user, clientIds)` (uses `Client.email`), `resendInvitation`. Reuses verification tokens with a 7-day expiry; landing page is the magic-link confirmation. `setPassword(user, password)` at `/cuenta`.
- [ ] Tests: INVITED user created + linked, email logged, existing user is linked not duplicated, role limits (admin only for staff), 7-day token works once.

### Task 8: Tenants — `src/modules/tenants/{schema,service}.ts`
`registerTenant({ name, slug, adminName, adminEmail })` (PENDING_VERIFICATION + admin INVITED + verification email; verifying activates the tenant), `createTenantAsSuperadmin`, `listTenants`, `setTenantStatus`, `updateTenantProfile`, `updateBranding` (logo upload → `StoredFile` BRANDING; colors), `completeOnboarding`, `createSampleData` / `deleteSampleData` (`Client.isSample`). Reserved slugs rejected.
- [ ] Tests: slug rules, verification activates, superadmin-only actions, sample data round trip leaves no rows behind.

### Task 9: UI
`/registro`, `/plataforma` (tenants), `/bienvenida` (wizard: gestoría → marca → equipo → clientes → invitaciones → fin), `/panel/clientes` (+ `nuevo`, `[id]`, `[id]/editar`, `importar`), `/panel/ajustes/{gestoria,equipo,perfiles-fiscales}`, `/cuenta`. Staff navigation. Tenant colors/logo applied through CSS variables.

### Task 10: Seed, docs, verification
12 demo clients with varied profiles and generated obligations; README ("how to add a tax profile", calendar source), ADRs, tech debt; lint, typecheck, tests, build; manual smoke test of the onboarding flow.
