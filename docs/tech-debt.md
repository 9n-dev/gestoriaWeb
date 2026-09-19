# Technical debt

Every `TODO` in the code must point to an entry here. Format: `TD-NNN` · phase that owns it · what and why.

## Open

| Id | Owner phase | Item |
|---|---|---|
| TD-001 | 9 | **2FA not enforced yet.** Staff roles log in with password only. Schema fields exist (`totpSecret`, `recoveryCodeHashes`); enrolment, challenge and enforcement arrive with the security phase. Do not onboard real tenants before. |
| TD-002 | 9 | **No rate limiting** on `/acceso`, magic-link requests or `/api/auth/*`. Account lockout (5 attempts / 15 min) is the only brake today. |
| TD-003 | 9 | **No security headers** (CSP, HSTS…). `src/middleware.ts` does not exist yet; there is no edge auth gate either — every layout and service calls `requireUser()`/`can()`. |
| TD-007 | 9 | **Session list / revoke UI missing.** `revokeSession` and `revokeAllSessions` exist and are tested; nothing calls them except sign-out. |
| TD-008 | 9 | **Support mode has no UI and no cross-host session.** `can()` and `loadSessionUser` already honour `SupportAccessGrant`; granting, and how a superadmin enters a tenant host, are pending. |
| TD-009 | — | **`tenantDb` does not rewrite nested writes or `include` filters** (ADR 0005). Rule: ids coming from the user are first loaded through `tenantDb`. Optional hardening: Postgres RLS. |
| TD-010 | — | **Down migrations are manual.** Prisma has no native rollback: each migration folder carries a hand-written `down.sql`. CI does not verify them. |
| TD-011 | 10 | **Sentry not wired.** `SENTRY_DSN` is validated in `env.ts` but unused; errors go to stdout. |
| TD-014 | — | **Prisma 6 → 8 upgrade** once v8 is stable (ADR 0011). ESLint 9 and TypeScript 5.9 are pinned for `eslint-config-next@15` compatibility. |
| TD-015 | — | **MinIO image comes from quay.io**: MinIO stopped publishing to Docker Hub. Revisit if quay.io images stop too (any S3-compatible server works). |
| TD-016 | — | **Client import is CSV only** (ADR 0014). XLSX needs a large dependency. |
| TD-018 | 9 | **`/registro` has no rate limit or captcha**: anyone can create pending tenants and trigger verification emails. Pending tenants that never verify are not cleaned up (add to the TD-013 job). |
| TD-019 | — | **K/L/M NIFs are accepted by format only** (`lib/tax-id.ts`); their control character is not checked. |
| TD-020 | 9 | **Staff cannot be disabled, re-roled or removed from the UI**, and client users cannot be unlinked (`client.removeUser` exists in the matrix, no service yet). Invitation and listing are done. |
| TD-025 | — | **`prisma migrate reset` refuses to run from an AI agent** (Prisma safety guard). `npm run db:reset` must be run by a person. |
| TD-026 | 10 | **Client list filters in memory** (`q` search over the scoped list). Fine for hundreds of clients per tenant; move to SQL with pagination if a tenant grows past that. |
| TD-027 | 5 | **Resend inbound adapter is untested against a live account.** Signature verification and routing are covered; the attachment download endpoint in `inbound/resend.ts` was written from the published API and must be verified with the first real domain. |
| TD-029 | 10 | **No offline upload queue.** Uploads retry and resume while the page is open; closing it loses the queue. IndexedDB + service worker arrive with the PWA. |
| TD-031 | — | **Inbound attachments under 5 KB are skipped** as signature logos (`inbound/service.ts`). Replace with Content-Disposition/Content-ID once the provider exposes them. |
| TD-033 | 10 | **The inbox loads at most 300 documents** and filters in one query without pagination. |
| TD-034 | 9 | **`/api/webhooks/resend-inbound` and `/api/uploads` are not rate limited.** |
| TD-035 | — | **E2E runs against the development database** locally (it re-seeds and leaves its uploads and test tenants behind). CI uses a fresh database. |
| TD-037 | — | **The traffic-light overview is quarterly.** Clients with monthly VAT keep monthly checklists and are not listed in the quarter view. |
| TD-038 | 10 | **Dashboard numbers are computed on every visit** (overview of all clients in memory; average over the last 2 000 processed documents). Cache or pre-aggregate if a tenant grows large. |
| TD-039 | 9 | **Soft-deleted files keep their objects in the bucket** (replaced receipts, deleted permanent documents). Physical removal belongs to the retention policy. |
| TD-040 | 10 | **No demo reset job yet** (04:00 re-seed when `DEMO_MODE`). |
| TD-041 | — | **Failed-jobs panel has no pagination or bulk retry**: first 100 per queue. |
| TD-042 | 9 | **Reply-by-email trusts the From address plus the thread token** (ADR 0022). Enforce DMARC on the inbound domain when it is connected. |
| TD-043 | 10 | **Counters refresh on navigation only**: the bell and unread threads are server-rendered, there is no polling or live update. |
| TD-044 | — | **Attachments are added after the message is sent** (15-minute window, author only). An attachment that fails leaves a message without it and a warning to the author. |
| TD-046 | — | **Every staff participant of a thread is notified of each new message**; there is no per-thread mute. |
| TD-047 | 9 | **The proxy in front of the app must overwrite `X-Forwarded-Host`** (tenant resolution reads it first). Vercel does; document it for any other deployment. |
| TD-048 | 10 | **i18n covers the shared header only.** `lib/i18n` and the five dictionaries exist; page copy is still inline Spanish and there is no locale switch (`User.locale` is stored but unused). |
| TD-049 | — | **Vercel and Resend domain adapters are untested against live accounts** (same situation as TD-027). The flows are covered with injected providers and DNS resolvers. |
| TD-050 | — | **Brand colours are validated against the light theme only**; in dark mode the tenant colours are used as they are. |
| TD-051 | — | **Notification and message emails keep fixed wording** (only invitations, magic links and reminders are in the editable registry). |
| TD-052 | — | **The real extractor is not exercised in CI** (needs a key and costs money): `RUN_AI_EXTRACTION_TEST=1 ANTHROPIC_API_KEY=… npx vitest run src/modules/documents/extraction`. Run it before each release and when changing the prompt or the model. |
| TD-053 | — | **One VAT rate per document.** Invoices with several rates store totals and the main rate. |
| TD-054 | — | **No "extract again" button** for a document that failed or was read badly; the manager edits the fields. |
| TD-055 | — | **Export has no vendor presets** (A3, Sage, Contasol…): columns and separator only. |

## Closed

| Id | Closed in | Item |
|---|---|---|
| TD-006 | phase 2 | No user management UI: invitations for staff and client users, team page and client access section now exist (remaining gaps moved to TD-020). |
| TD-012 | phase 3 | E2E placeholder: Playwright now covers onboarding (20 invited clients), upload → book / reject by keyboard, and 10 photos over throttled 3G. |
| TD-017 | phase 3 | Tenant logos unscanned: they now go through the same `processFile` pipeline. |
| TD-022 | phase 3 | Permanent documents: upload, list, download and delete are done (expiry notices moved to TD-032). |
| TD-013 | phase 4 | Cleanup job: expired sessions and tokens, unverified sign-ups, abandoned uploads (objects of soft-deleted files moved to TD-039). |
| TD-021 | phase 4 | Manual obligations: create from the calendar, delete while untouched. |
| TD-023 | phase 4 | December job: the daily tenant job syncs obligations on the 1st of every month. |
| TD-032 | phase 4 | Expiry notices for permanent documents at 60, 30 and 7 days. |
| TD-030 | phase 5 | Notifications without UI: bell with counter, notification centre, preferences and web push; inbound emails without attachments are readable as threads. |
| TD-004 | phase 6 | Magic-link email hardcoded: now in the editable registry, with the invitation. |
| TD-005 / TD-024 | phase 6 | Static branding without contrast validation: favicon, sender name, contrast warnings, automatic button text colour. |
| TD-036 / TD-045 | phase 6 | Reminder wording only editable in the database; plain-text emails: editor with preview and branded HTML for every email. |
| TD-028 | phase 7 | Manual extraction: AI extraction with confidence, period suggestion and duplicate check. |
