# Technical debt

Every `TODO` in the code must point to an entry here. Format: `TD-NNN` · phase that owns it · what and why.

## Open

| Id | Owner phase | Item |
|---|---|---|
| TD-009 | — | **`tenantDb` does not rewrite nested writes or `include` filters** (ADR 0005). Rule: ids coming from the user are first loaded through `tenantDb`. Optional hardening: Postgres RLS. |
| TD-010 | — | **Down migrations are manual.** Prisma has no native rollback: each migration folder carries a hand-written `down.sql`. CI does not verify them. |
| TD-014 | — | **Prisma 6 → 8 upgrade** once v8 is stable (ADR 0011). ESLint 9 and TypeScript 5.9 are pinned for `eslint-config-next@15` compatibility. |
| TD-015 | — | **MinIO image comes from quay.io**: MinIO stopped publishing to Docker Hub. Revisit if quay.io images stop too (any S3-compatible server works). |
| TD-016 | — | **Client import is CSV only** (ADR 0014). XLSX needs a large dependency. |
| TD-018 | — | **`/registro` has no captcha.** It is rate limited per IP since phase 9 (10 per hour) and pending tenants that never verify are swept after 7 days, but a distributed script can still create pending tenants and trigger verification emails. |
| TD-019 | — | **K/L/M NIFs are accepted by format only** (`lib/tax-id.ts`); their control character is not checked. |
| TD-025 | — | **`prisma migrate reset` refuses to run from an AI agent** (Prisma safety guard). `npm run db:reset` must be run by a person. |
| TD-026 | — | **Client list filters in memory** (`q` search over the scoped list). Fine for hundreds of clients per tenant; move to SQL with pagination if a tenant grows past that. |
| TD-027 | 5 | **Resend inbound adapter is untested against a live account.** Signature verification and routing are covered; the attachment download endpoint in `inbound/resend.ts` was written from the published API and must be verified with the first real domain. |
| TD-031 | — | **Inbound attachments under 5 KB are skipped** as signature logos (`inbound/service.ts`). Replace with Content-Disposition/Content-ID once the provider exposes them. |
| TD-033 | — | **The inbox loads at most 300 documents** and filters in one query without pagination. |
| TD-035 | — | **E2E runs against the development database** locally (it re-seeds and leaves its uploads and test tenants behind). CI uses a fresh database. |
| TD-037 | — | **The traffic-light overview is quarterly.** Clients with monthly VAT keep monthly checklists and are not listed in the quarter view. |
| TD-038 | — | **Dashboard numbers are computed on every visit** (overview of all clients in memory; average over the last 2 000 processed documents). Cache or pre-aggregate if a tenant grows large. |
| TD-041 | — | **Failed-jobs panel has no pagination or bulk retry**: first 100 per queue. |
| TD-042 | — | **Reply-by-email trusts the From address plus the thread token** (ADR 0022). Enforce DMARC on the inbound domain when it is connected. |
| TD-043 | — | **Counters refresh on navigation only**: the bell and unread threads are server-rendered, there is no polling or live update. |
| TD-044 | — | **Attachments are added after the message is sent** (15-minute window, author only). An attachment that fails leaves a message without it and a warning to the author. |
| TD-046 | — | **Every staff participant of a thread is notified of each new message**; there is no per-thread mute. |
| TD-047 | — | **The proxy in front of the app must overwrite `X-Forwarded-Host`** (tenant resolution reads it first). Vercel does; document it for any other deployment. |
| TD-048 | — | **i18n covers the shared header only.** `lib/i18n` and the five dictionaries exist; page copy is still inline Spanish and there is no locale switch (`User.locale` is stored but unused). |
| TD-049 | — | **Vercel and Resend domain adapters are untested against live accounts** (same situation as TD-027). The flows are covered with injected providers and DNS resolvers. |
| TD-050 | — | **Brand colours are validated against the light theme only**; in dark mode the tenant colours are used as they are. |
| TD-051 | — | **Notification and message emails keep fixed wording** (only invitations, magic links and reminders are in the editable registry). |
| TD-052 | — | **The real extractor is not exercised in CI** (needs a key and costs money): `RUN_AI_EXTRACTION_TEST=1 ANTHROPIC_API_KEY=… npx vitest run src/modules/documents/extraction`. Run it before each release and when changing the prompt or the model. |
| TD-053 | — | **One VAT rate per document.** Invoices with several rates store totals and the main rate. |
| TD-054 | — | **No "extract again" button** for a document that failed or was read badly; the manager edits the fields. |
| TD-055 | — | **Export has no vendor presets** (A3, Sage, Contasol…): columns and separator only. |
| TD-057 | — | **Stripe and GoCardless adapters are untested against live accounts**; signatures and idempotency are covered with the documented schemes. There is no SEPA mandate set-up flow: `Client.gocardlessMandateId` must be filled by hand. |
| TD-059 | — | **Verifactu submission is not implemented**: invoices carry the chained hash and QR payload (`InvoiceCompliance`), nothing is sent to AEAT. |
| TD-060 | — | **The new-invoice form takes three lines and one VAT rate**; the service accepts up to 50 lines with their own rates. |
| TD-061 | — | **A TOTP code can be replayed inside its 30-second window**: the last accepted step is not stored. Needs a `totpLastStep` column; the attacker would already need the password and a live code. |
| TD-062 | — | **2FA enforcement is off when `DEMO_MODE=true`** so the published demo users work. The feature itself stays on. Never run a real tenant with demo mode. |
| TD-063 | — | **Data exports are built in memory** (`buildExport`). Fine for a small gestoría; a tenant with many GB needs a streamed ZIP into a multipart upload. |
| TD-064 | — | **The DPA gate lives in the route-group layouts** (`requireArea`), not in server actions or API routes, and the text is a template that needs the platform owner's legal review. No PDF copy is emailed after accepting. |
| TD-065 | — | **Rate limiting is a fixed window keyed by `X-Forwarded-For`**: a 2x burst across the boundary is possible, and it trusts the proxy to overwrite that header (see TD-047). |
| TD-066 | — | **Support mode is one read-only overview page** (figures and client list). Browsing the tenant's panel as superadmin would need a cross-host session; not built. |
| TD-067 | — | **CSP keeps `style-src 'unsafe-inline'`**: tenant colours are CSS variables in a style attribute and Next inlines critical CSS. Scripts are nonce-only. |
| TD-070 | — | **Pages are never cached by the service worker** (personal data on possibly shared devices), so `/subir` cannot be opened from a cold start without network: the offline queue covers a connection lost while using it, or files left from a previous visit. |
| TD-071 | — | **The offline queue covers the client uploader only** (not staff uploads: receipts, deliveries, permanent documents). Safari may evict IndexedDB of a site unused for 7 days unless the PWA is installed. |
| TD-072 | — | **Help centre is fixed content**: ten Spanish articles for clients, no search, not editable per tenant, none for staff. |
| TD-073 | — | **Lighthouse is run by hand** against the local production build (scores in the README), not in CI, and not on a throttled real device. |
| TD-074 | — | **The demo reset only recreates `perez` and `otra`**: gestorías that visitors register in a demo environment stay (unverified ones are swept after 7 days). |
| TD-075 | — | **Only server-side errors are reported** (`onRequestError`, actions, API routes, webhooks, final job failures). Browser errors are not. |

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
| TD-001 | phase 9 | 2FA: TOTP enrolment with QR, challenge after the password, single-use recovery codes, lockout shared with passwords, admin reset; mandatory for staff and superadmins. |
| TD-002 | phase 9 | Rate limiting (Redis, fail-open) on login, 2FA, magic links, sign-up, upload initiation, export links and webhooks. |
| TD-003 | phase 9 | `src/middleware.ts`: nonce-based CSP, HSTS, nosniff, frame-ancestors, referrer and permissions policies; verified by an E2E test with zero violations. |
| TD-007 | phase 9 | Session list with revoke one / revoke the others in "Tu cuenta". |
| TD-008 | phase 9 | Support mode: grant with reason and expiry, early revoke, read-only overview for the superadmin, all audited (reduced scope: TD-066). |
| TD-039 | phase 9 | Daily sweep physically deletes soft-deleted documents and permanent documents after 30 days, files nothing references, and documents past the retention period. |
| TD-011 | phase 10 | Error reporting to any Sentry-compatible service through the envelope endpoint, without SDK (`lib/report-error.ts`, `instrumentation.ts`). |
| TD-029 | phase 10 | Offline upload queue in IndexedDB: files survive a lost connection, a closed page or a restart and are sent (resumed) on the next online visit. E2E covered. |
| TD-040 | phase 10 | `demo-reset` job at 04:00 when `DEMO_MODE`: physically deletes the demo tenants and runs the seed again. |
| TD-034 | phase 9 | `/api/uploads` (per user) and the three webhooks (per IP) are rate limited. |
| TD-020 | post-launch | Team management: re-role, disable with mandatory hand-over of clients, reactivate; "Retirar acceso" for client users (ADR 0033). |
| TD-058 | post-launch | Ajustes → Facturación: payment term, unpaid reminders, delinquency threshold and invoice series, validated and audited. |
| TD-056 | post-launch | Designed invoice PDF on the extended own writer: brand colour, aligned amounts, VAT/IRPF breakdown, real vector QR, pagination, `€` rendered correctly (ADR 0034). |
| TD-076 | post-launch | Tenant logo on the invoice PDF: own PNG decoder (all colour types, alpha as soft mask) and JPEG pass-through; only antivirus-clean files; never blocks issuing (ADR 0035). |
| TD-077 | post-launch | Awkward logos (WebP, interlaced PNG, CMYK JPEG, over 4 MP) become a plain PNG in the browser before upload; the PNG decoder honours colour-key transparency; the signature certificate has a designed layout with logo and brand colour (leftover: TD-078). |
| TD-078 | post-launch | Logos no longer need the browser to be PDF-ready: the server decodes interlaced (Adam7) PNGs, embeds CMYK JPEGs and shrinks big logos to print size. WebP is refused by the server (the worker's file pipeline never accepted it and was deleting such logos seconds after upload); the form converts it to PNG first. Also fixed: a logo-only branding update wiped the colours. |
| TD-069 | post-launch | Monthly retention notice to the tenant admins (in-app, email, push) with the number of documents due in the next 45 days; retention deletes only what a notice at least 15 days old announced; shortening the period restarts the clock. |
| TD-068 | post-launch | Platform support can undo a cancellation during its 30 days of grace from the tenants page ("Anular la baja"); the purge date is shown; audited on both sides. |
