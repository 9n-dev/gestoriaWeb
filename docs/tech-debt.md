# Technical debt

Every `TODO` in the code must point to an entry here. Format: `TD-NNN` · phase that owns it · what and why.

## Open

| Id | Owner phase | Item |
|---|---|---|
| TD-001 | 9 | **2FA not enforced yet.** Staff roles log in with password only. Schema fields exist (`totpSecret`, `recoveryCodeHashes`); enrolment, challenge and enforcement arrive with the security phase. Do not onboard real tenants before. |
| TD-002 | 9 | **No rate limiting** on `/acceso`, magic-link requests or `/api/auth/*`. Account lockout (5 attempts / 15 min) is the only brake today. |
| TD-003 | 9 | **No security headers** (CSP, HSTS…). `src/middleware.ts` does not exist yet; there is no edge auth gate either — every layout and service calls `requireUser()`/`can()`. |
| TD-004 | 5 | **Magic-link email is hardcoded** in `modules/auth/service.ts`. Moves to the `Template` system (tenant-editable, key `auth.magic_link`) with the rest of the emails. |
| TD-005 | 6 | **Branding is static.** Colors are CSS variables in `globals.css`; per-tenant values, logo and favicon arrive with white label. |
| TD-007 | 9 | **Session list / revoke UI missing.** `revokeSession` and `revokeAllSessions` exist and are tested; nothing calls them except sign-out. |
| TD-008 | 9 | **Support mode has no UI and no cross-host session.** `can()` and `loadSessionUser` already honour `SupportAccessGrant`; granting, and how a superadmin enters a tenant host, are pending. |
| TD-009 | — | **`tenantDb` does not rewrite nested writes or `include` filters** (ADR 0005). Rule: ids coming from the user are first loaded through `tenantDb`. Optional hardening: Postgres RLS. |
| TD-010 | — | **Down migrations are manual.** Prisma has no native rollback: each migration folder carries a hand-written `down.sql`. CI does not verify them. |
| TD-011 | 10 | **Sentry not wired.** `SENTRY_DSN` is validated in `env.ts` but unused; errors go to stdout. |
| TD-013 | 4 | **No cleanup job yet**: expired `UserSession` and `VerificationToken` rows, tenants that never verified, uploads abandoned in `PENDING` (with their open S3 multipart uploads) and objects of soft-deleted files. One daily job with the workers. |
| TD-014 | — | **Prisma 6 → 8 upgrade** once v8 is stable (ADR 0011). ESLint 9 and TypeScript 5.9 are pinned for `eslint-config-next@15` compatibility. |
| TD-015 | — | **MinIO image comes from quay.io**: MinIO stopped publishing to Docker Hub. Revisit if quay.io images stop too (any S3-compatible server works). |
| TD-016 | — | **Client import is CSV only** (ADR 0014). XLSX needs a large dependency. |
| TD-018 | 9 | **`/registro` has no rate limit or captcha**: anyone can create pending tenants and trigger verification emails. Pending tenants that never verify are not cleaned up (add to the TD-013 job). |
| TD-019 | — | **K/L/M NIFs are accepted by format only** (`lib/tax-id.ts`); their control character is not checked. |
| TD-020 | 9 | **Staff cannot be disabled, re-roled or removed from the UI**, and client users cannot be unlinked (`client.removeUser` exists in the matrix, no service yet). Invitation and listing are done. |
| TD-021 | 4 | **Obligations cannot be created or removed by hand**, only through the tax profile (ADR 0013). Phase 4 adds manual handling together with status changes. |
| TD-023 | 4 | **The December job is not scheduled yet.** `syncObligationsForClients({}, { today })` is built and tested; phase 4 wires it to BullMQ. |
| TD-024 | 6 | **Tenant colors are applied without contrast validation** and are not adapted to dark mode. |
| TD-025 | — | **`prisma migrate reset` refuses to run from an AI agent** (Prisma safety guard). `npm run db:reset` must be run by a person. |
| TD-026 | 10 | **Client list filters in memory** (`q` search over the scoped list). Fine for hundreds of clients per tenant; move to SQL with pagination if a tenant grows past that. |
| TD-027 | 5 | **Resend inbound adapter is untested against a live account.** Signature verification and routing are covered; the attachment download endpoint in `inbound/resend.ts` was written from the published API and must be verified with the first real domain. |
| TD-028 | 7 | **Extraction is manual.** Managers type the invoice fields; `extractionStatus` stays `PENDING` for the AI job of phase 7, which will also suggest the period from the invoice date (today the client or manager chooses it). |
| TD-029 | 10 | **No offline upload queue.** Uploads retry and resume while the page is open; closing it loses the queue. IndexedDB + service worker arrive with the PWA. |
| TD-030 | 5 | **Notifications have no UI**: rows are written and emails sent (`notifyUsers`), but there is no bell, counter or preferences yet. Inbound emails without attachments create messages nobody can read in the portal until the messaging phase. |
| TD-031 | — | **Inbound attachments under 5 KB are skipped** as signature logos (`inbound/service.ts`). Replace with Content-Disposition/Content-ID once the provider exposes them. |
| TD-032 | 4 | **Permanent documents have no expiry notices yet** (60/30/7 days): they need the scheduled workers. |
| TD-033 | 10 | **The inbox loads at most 300 documents** and filters in one query without pagination. |
| TD-034 | 9 | **`/api/webhooks/resend-inbound` and `/api/uploads` are not rate limited.** |
| TD-035 | — | **E2E runs against the development database** locally (it re-seeds and leaves its uploads and test tenants behind). CI uses a fresh database. |

## Closed

| Id | Closed in | Item |
|---|---|---|
| TD-006 | phase 2 | No user management UI: invitations for staff and client users, team page and client access section now exist (remaining gaps moved to TD-020). |
| TD-012 | phase 3 | E2E placeholder: Playwright now covers onboarding (20 invited clients), upload → book / reject by keyboard, and 10 photos over throttled 3G. |
| TD-017 | phase 3 | Tenant logos unscanned: they now go through the same `processFile` pipeline. |
| TD-022 | phase 3 | Permanent documents: upload, list, download and delete are done (expiry notices moved to TD-032). |
