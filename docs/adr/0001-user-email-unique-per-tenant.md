# 0001. User email is unique per tenant

Date: 2026-09-18 · Status: accepted

## Context

The product is white label: each gestoría runs on its own domain and must look like an independent system. The same person can legitimately be a client of two gestorías.

## Options

1. Globally unique email: simplest, works with the stock Auth.js Prisma adapter, but tenant B learns that an email exists in tenant A ("email already in use") and one person cannot belong to two tenants.
2. Unique per tenant (`@@unique([tenantId, email])`).

## Decision

Unique per tenant. Login resolves the tenant from the request host before looking up the user. Verification token identifiers are `<tenantId|platform>:<email>`. We write a small custom Auth.js adapter; there is no `Account` table because there is no OAuth.

## Consequences

- Every user lookup by email needs the tenant. There is no `findByEmail(email)` without tenant.
- Superadmins have `tenantId = NULL`; Postgres treats NULLs as distinct, so the first migration adds a partial unique index on `users(email) WHERE "tenantId" IS NULL`.
