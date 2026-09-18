# 0015. Invitations and tenant verification reuse the login-token mechanism

Date: 2026-09-18 · Status: accepted

## Context

Staff invitations, client invitations, tenant email verification and magic links all need a single-use, expiring, emailed secret.

## Options

1. A dedicated `Invitation` table.
2. One mechanism: `issueLoginToken(tenantId, email, lifetime)` over `VerificationToken`, with a different lifetime per use (15 min login, 7 days invitation, 48 h tenant verification).

## Decision

One mechanism. An invited person is a `User` in status `INVITED`; accepting the link activates it. Tenant verification activates the tenant and then hands over a fresh 15-minute login token on the tenant's own host, so the session cookie is created on the right domain.

## Consequences

- Pending invitations are simply users in `INVITED` status; resending issues a new token.
- Expired tokens accumulate until the cleanup job (TD-013).
