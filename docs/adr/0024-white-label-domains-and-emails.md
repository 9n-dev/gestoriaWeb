# 0024. White label: verified domains behind provider adapters, one email template registry

Date: 2026-09-19 · Status: accepted

## Context

§6.12 asks for custom domains with TXT verification and automatic SSL, a verified sending domain (SPF, DKIM, DMARC) with visible status, editable emails with preview, contrast validation and an i18n skeleton.

## Options

1. Ask gestorías to email us their domain and configure it by hand.
2. Self-service with provider adapters and DNS checks done by the app.

## Decision

Self-service. **Portal domain**: the tenant saves the domain, we show a TXT record (`_portal-verify.<domain>`) and the CNAME target; only when our own DNS lookup sees the token is the domain marked verified, attached to the deployment through `DomainProvider` (Vercel API, or a logging fake) and allowed to resolve to the tenant. **Sending domain**: `EmailDomainProvider` (Resend, or a fake) returns SPF/DKIM records and status; DMARC is checked by us; once verified, emails leave from `no-reply@<domain>` with the tenant's sender name, otherwise from the platform address with that name. **Emails**: one registry of system emails with default wording and tenant overrides (`Template`, kind EMAIL); every email gets a branded HTML version generated from its text (escaped, links clickable), so tenants edit text, never HTML. **Contrast**: WCAG ratio of each brand colour against white is computed on save and reported as a warning; button text colour is chosen automatically. **i18n**: `lib/i18n` with Spanish and empty `ca`, `gl`, `eu`, `en` dictionaries that fall back to Spanish.

## Consequences

- Unverified domains never resolve, so nobody can claim a domain they do not control.
- Templates are text-only by design: no HTML injection surface, consistent branding, a smaller editor.
- Most UI copy is still inline Spanish; only the shared header goes through `t()` (TD-048).
