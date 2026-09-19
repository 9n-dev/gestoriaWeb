# 0030. Support mode is a read-only overview on the platform host

Date: 2026-09-19 · Status: accepted

## Context

§3: the superadmin has no access to client data unless the tenant admin turns on "modo soporte", with expiry and audit. `can()` already gives a superadmin read-only, no-download access to tenants with an open `SupportAccessGrant` (ADR 0012). Sessions are bound to a host: a superadmin session lives on the platform host, not on the tenant's.

## Options

1. Let the superadmin enter the tenant's panel (cross-host session, impersonation banner, every page aware of a foreign reader).
2. A dedicated read-only page on the platform host fed by one service.

## Decision

Option 2. The tenant admin opens the window in Ajustes → Soporte (reason, 4 h / 24 h / 3 days, early close). The superadmin sees "Modo soporte" next to that tenant and gets `supportOverview`: tenant status, figures (users, documents, infected files, failed extractions and emails) and the client list — no files, no internal notes. Grant, revoke and every view are written to the tenant's own audit log.

## Consequences

Support can diagnose most tickets without seeing documents. Anything deeper needs option 1 (TD-066).
