# 0029. GDPR operations: agreements, export, erasure, retention and tenant purge

Date: 2026-09-19 · Status: accepted

## Context

§4: a data processing agreement generated from a template and accepted on record when a tenant signs up and when a client is invited; export and secure erasure of one client with 30 days of grace; full tenant export on cancellation and physical deletion after 30 days; configurable document retention (6 years by default). ADR 0006 made every tenant relation `Restrict` and promised a purge service; ADR 0007 keeps invoices; ADR 0008 lets audit rows be deleted only under `app.audit_purge`.

## Decision

- **Agreements** (`modules/legal/dpa.ts`): two plain-text templates (platform ↔ gestoría, gestoría ↔ client) filled with the parties' legal data. One gate for both cases: `requireArea` redirects to `/acceso/condiciones` while `pendingAgreements(user)` is not empty — the tenant admin at the first login, a client user once per client they represent, everybody again when `DPA_VERSION` changes. `LegalAcceptance` stores who, when, IP, user agent and the SHA-256 of the exact text.
- **Export** (`modules/gdpr/export.ts`) is generic over `Prisma.dmmf`: one CSV per tenant-owned table (a table added tomorrow is exported tomorrow), minus credentials and device secrets, plus the CLEAN files. Client scope = rows with that `clientId` and their children. It runs in the worker, lands in the bucket and is downloadable through two doors that share the audit entry and the 5-minute signed URL: the panel (permission) and an emailed token (hash stored), which is the only door left once a cancelled tenant cannot log in.
- **Client erasure**: `deletedAt` + `purgeAfter = now + 30 d`, reversible until then. The purge deletes the client (cascade), its files and objects; invoices stay with their snapshots and `clientId = null`; users who only represented that client are anonymised and disabled rather than deleted, so foreign keys from other rows keep resolving to nobody.
- **Tenant purge**: bucket prefix first (an orphan row is harmless, an orphan object is a leak), then `DELETE … WHERE tenantId` over every tenant table in an order computed from the model graph, audit log included under the purge flag, then the tenant. A test asserts that every tenant-owned model counts 0 afterwards and that a neighbour tenant is untouched.
- **Retention** (`Tenant.settings.retentionYears`, 4–15, default 6) and the 30-day sweep of soft-deleted and orphan files run in the daily cleanup job.

## Consequences

- The export was built in memory at first (TD-063); it is now streamed through `ZipStream` into a multipart upload, one file in memory at a time.
- Audit entries about an erased client remain (ids only): they are the evidence that the erasure happened.
- Reactivating a cancelled tenant is a manual operation (TD-068).
- Later addition: retention is announced before it acts. A monthly `RETENTION_NOTICE` tells the admins what will expire in the next 45 days, and `purgeOldDocuments` only deletes documents covered by a notice that is at least 15 days old; shortening the retention period deletes the notices, so the wait starts again. A cancellation can be undone by the superadmin while `purgeAfter` is in the future.
