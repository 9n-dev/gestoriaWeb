# 0005. Tenant isolation through scoped data access and tests, not RLS

Date: 2026-09-18 · Status: accepted

## Context

Every business table has `tenantId`. We need a guarantee that no query crosses tenants.

## Options

1. Composite foreign keys `(tenantId, id)` everywhere: DB-level guarantee, but very verbose in Prisma and awkward with nullable relations.
2. Postgres row-level security: strong, but needs a session variable per transaction, which fights Neon's pooled connections and Prisma's connection handling.
3. A `tenantDb(tenantId)` helper that injects the tenant filter into every operation, plus an isolation test suite over every repository and endpoint.

## Decision

Option 3 for phase 1. The tenant id always comes from the session, never from client input.

## Consequences

- Raw SQL must add the tenant filter by hand; raw queries are kept to a minimum and reviewed.
- RLS is recorded in `docs/tech-debt.md` as optional hardening.
