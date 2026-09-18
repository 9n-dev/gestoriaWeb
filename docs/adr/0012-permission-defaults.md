# 0012. Permission defaults left open by the spec

Date: 2026-09-18 · Status: accepted

## Context

The role table in CLAUDE.md §4 does not say who creates clients, whether managers see billing, or what support mode can do.

## Options

1. Strict reading: only supervisors/admins create clients, managers see no billing.
2. Defaults tuned for gestorías of 1–10 people.

## Decision

Managers can create clients (auto-assigned to themselves); bulk import stays with supervisors and admins. Managers can read and download invoices of their assigned clients (they need to know why a client is `DELINQUENT`) but never manage or issue them. Support mode is read-only and `*.download` is always denied to superadmins.

## Consequences

- All three are single entries in `permissions.ts`; changing them is a one-line change plus its test.
