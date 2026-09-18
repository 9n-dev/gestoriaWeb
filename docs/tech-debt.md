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
| TD-012 | 3 | **E2E job is a placeholder** (`npm run test:e2e` echoes). Playwright arrives with the first real flow (client uploads, manager books). The onboarding flow (sign-up → verify → wizard → import 20 clients → bulk invite) was verified by hand against the dev server in phase 2 and must become the first Playwright spec. |
| TD-013 | 4 | **Expired `UserSession` and `VerificationToken` rows are never deleted.** Add a daily cleanup job with the workers. |
| TD-014 | — | **Prisma 6 → 8 upgrade** once v8 is stable (ADR 0011). ESLint 9 and TypeScript 5.9 are pinned for `eslint-config-next@15` compatibility. |
| TD-015 | — | **MinIO image comes from quay.io**: MinIO stopped publishing to Docker Hub. Revisit if quay.io images stop too (any S3-compatible server works). |
| TD-016 | — | **Client import is CSV only** (ADR 0014). XLSX needs a large dependency. |
| TD-017 | 3 | **Tenant logos are stored unscanned** (`StoredFile.status = UPLOADED`). Type is verified from magic bytes and SVG is refused; the ClamAV pipeline of phase 3 must cover `BRANDING` files too. |
| TD-018 | 9 | **`/registro` has no rate limit or captcha**: anyone can create pending tenants and trigger verification emails. Pending tenants that never verify are not cleaned up (add to the TD-013 job). |
| TD-019 | — | **K/L/M NIFs are accepted by format only** (`lib/tax-id.ts`); their control character is not checked. |
| TD-020 | 9 | **Staff cannot be disabled, re-roled or removed from the UI**, and client users cannot be unlinked (`client.removeUser` exists in the matrix, no service yet). Invitation and listing are done. |
| TD-021 | 4 | **Obligations cannot be created or removed by hand**, only through the tax profile (ADR 0013). Phase 4 adds manual handling together with status changes. |
| TD-022 | 3 | **Permanent documents (§6.2) not started**: they need the upload pipeline. Expiry notices (60/30/7) need the workers of phase 4. |
| TD-023 | 4 | **The December job is not scheduled yet.** `syncObligationsForClients({}, { today })` is built and tested; phase 4 wires it to BullMQ. |
| TD-024 | 6 | **Tenant colors are applied without contrast validation** and are not adapted to dark mode. |
| TD-025 | — | **`prisma migrate reset` refuses to run from an AI agent** (Prisma safety guard). `npm run db:reset` must be run by a person. |
| TD-026 | 10 | **Client list filters in memory** (`q` search over the scoped list). Fine for hundreds of clients per tenant; move to SQL with pagination if a tenant grows past that. |

## Closed

| Id | Closed in | Item |
|---|---|---|
| TD-006 | phase 2 | No user management UI: invitations for staff and client users, team page and client access section now exist (remaining gaps moved to TD-020). |
