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
| TD-006 | 2 | **No user management UI**: staff and clients only exist through the seed. Invitations reuse the magic-link flow (`User.status = INVITED`). |
| TD-007 | 9 | **Session list / revoke UI missing.** `revokeSession` and `revokeAllSessions` exist and are tested; nothing calls them except sign-out. |
| TD-008 | 9 | **Support mode has no UI and no cross-host session.** `can()` and `loadSessionUser` already honour `SupportAccessGrant`; granting, and how a superadmin enters a tenant host, are pending. |
| TD-009 | — | **`tenantDb` does not rewrite nested writes or `include` filters** (ADR 0005). Rule: ids coming from the user are first loaded through `tenantDb`. Optional hardening: Postgres RLS. |
| TD-010 | — | **Down migrations are manual.** Prisma has no native rollback: each migration folder carries a hand-written `down.sql`. CI does not verify them. |
| TD-011 | 10 | **Sentry not wired.** `SENTRY_DSN` is validated in `env.ts` but unused; errors go to stdout. |
| TD-012 | 3 | **E2E job is a placeholder** (`npm run test:e2e` echoes). Playwright arrives with the first real flow (client uploads, manager books). |
| TD-013 | 4 | **Expired `UserSession` and `VerificationToken` rows are never deleted.** Add a daily cleanup job with the workers. |
| TD-014 | — | **Prisma 6 → 8 upgrade** once v8 is stable (ADR 0011). ESLint 9 and TypeScript 5.9 are pinned for `eslint-config-next@15` compatibility. |
| TD-015 | — | **MinIO image comes from quay.io**: MinIO stopped publishing to Docker Hub. Revisit if quay.io images stop too (any S3-compatible server works). |

## Closed

_None yet._
