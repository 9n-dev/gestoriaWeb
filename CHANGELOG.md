# Changelog

What changed, in the order it was built. The product was developed in the ten phases of the specification
([`CLAUDE.md`](CLAUDE.md) §8.2), each on its own branch and merged into `main` with its tests, lint, typecheck,
seed, README and tech-debt list up to date; then a post-launch pass closed the most valuable items of
[`docs/tech-debt.md`](docs/tech-debt.md). Decisions are explained in [`docs/adr/`](docs/adr).

## Post-launch (2026-09-19 to 2026-09-21)

### Added

- Team management: change a colleague's role, disable them with a mandatory hand-over of their clients,
  reactivate them; remove a person's access to a client (ADR 0033).
- Billing settings screen: payment term, unpaid reminders, delinquency threshold, invoice series.
- Designed invoice PDF on the in-house writer: tenant logo and colour, VAT and IRPF breakdown, verification
  QR drawn as vectors, pagination (ADR 0034). Designed signature certificate with the same treatment.
- Images in PDFs without a library: own PNG decoder (all colour types, bit depths, transparency, Adam7
  interlacing), JPEG pass-through including CMYK, print-size downsampling (ADR 0035).
- Logos are normalised in the browser before upload (WebP, oversized images).
- Monthly retention notice to the tenant admins; retention only deletes what a notice at least 15 days old
  announced.
- The platform's superadmin can undo a tenant cancellation during its 30 days of grace.
- "Leer de nuevo": repeat the AI extraction of a document from the inbox, at most three reads per document.
- Manual invoices with up to 50 lines, VAT and withholding per line, live totals.
- Client list searched and paginated in SQL; the inbox says how long the queue is.
- Mute a conversation; header counters refresh by themselves.
- Client import from Excel (`.xlsx`) with an in-house reader, besides CSV.
- Browser errors reported to the same Sentry-compatible tracker as server errors.
- Brand colours adapted automatically for the dark theme.
- README with screenshots and recorded demos (`npm run screenshots`, `npm run demo:gifs`), architecture
  diagrams, this changelog and a contributing guide.

### Changed

- A TOTP code works once: the accepted 30-second step is stored and claimed atomically.
- The data processing agreement gate covers server actions and API routes, not only pages.
- Branding images are PNG or JPEG on the server; the form converts anything else first.
- The main navigation sits on one line and scrolls sideways on a phone.
- No emojis anywhere in the interface or the documentation.

### Fixed

- The euro sign came out as `?` in every generated PDF.
- WebP logos were accepted by the branding form and then deleted by the file pipeline seconds later.
- A logo-only branding update wiped the stored colours.
- LIKE wildcards typed in the client search were treated as patterns.
- Sign-up had no protection against form-filling bots (honeypot added on top of the rate limit).

## Phase 10: PWA, offline, help, demo mode, polish

Per-tenant web app manifest and generated icons, service worker (asset cache, offline page, web push, never
caches pages), upload queue in IndexedDB that survives a closed tab, help centre rendered from Markdown,
demo banner and nightly demo reset, Sentry-compatible error reporting without SDK, error and not-found pages,
Lighthouse pass on the client screens (ADR 0031, 0032).

## Phase 9: security and GDPR operations

TOTP two-factor authentication with recovery codes (mandatory for staff), session list and revocation, Redis
rate limiting, nonce-based Content Security Policy and security headers, data processing agreements with
recorded acceptance, client export and erasure with 30 days of grace, tenant cancellation with full export and
physical purge, document retention, support mode (ADR 0028 to 0030).

## Phase 8: billing and payments

Recurring fees, monthly invoicing, gap-free numbering under a row lock, rectifying invoices, hash chain and QR
payload ready for Verifactu behind `InvoiceCompliance`, Stripe and GoCardless behind `PaymentProvider`, signed
and idempotent webhooks, dunning and delinquency (ADR 0027).

## Phase 7: AI extraction and accounting export

`DocumentExtractor` over the Anthropic API with structured output, validation, one corrective retry, token
usage per tenant, period suggestion and second duplicate check; ten synthetic invoices as acceptance fixtures;
export of a period to CSV or XLSX with in-house ZIP and XLSX writers (ADR 0025, 0026).

## Phase 6: white label

Logo, favicon, colours with WCAG contrast warnings, sender name, custom domain verified by DNS TXT, sending
domain with SPF, DKIM and DMARC status, editable email templates with preview and branded HTML, i18n structure
(ADR 0024).

## Phase 5: messaging, notifications, deliveries and simple signature (MVP)

Threads per client and subject, internal threads with mentions, message templates, replies by email, in-app
notification centre, web push, per-user preferences, deliveries with visibility dates, simple signature with
evidence and PDF certificate (ADR 0021 to 0023).

## Phase 4: checklists, traffic light, filings, reminders

Checklists generated from the tax profile and ticked by the documents themselves, traffic light per client and
quarter with export, filing workflow with receipt and result, escalating reminders with the concrete missing
list, inactivity and expiry notices, BullMQ workers with idempotent daily jobs and a failed-jobs panel
(ADR 0019, 0020).

## Phase 3: document intake and manager inbox

Resumable multipart uploads straight to the bucket, browser-side image compression, HEIC conversion, type
sniffing, ClamAV, duplicate detection by hash, inbound email per client, rejection reasons, keyboard-driven
inbox with saved views, single audited download door with five-minute signed URLs (ADR 0016 to 0018).

## Phase 2: tenants, onboarding, clients, tax profiles, obligations

Self-service sign-up with email verification, onboarding wizard, CSV import with a row-by-row report, bulk
invitations, sample data, Spanish tax id validation, system tax profiles that tenants clone, obligation
generation from the tax calendar with business-day deadlines (ADR 0012 to 0015).

## Phase 1: infrastructure

Docker Compose (PostgreSQL, Redis, MinIO, ClamAV), validated environment, Prisma schema and migrations with
`down.sql`, Auth.js with revocable sessions, password and magic-link login, account lockout, tenant resolution
by host, `tenantDb` isolation extension and its test, single `can()` permission matrix, append-only audit log,
health endpoint, CI (ADR 0001 to 0011).
