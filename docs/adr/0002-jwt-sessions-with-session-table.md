# 0002. JWT sessions backed by a `UserSession` table

Date: 2026-09-18 · Status: accepted

## Context

Spec requires password credentials, revocable sessions, and different expiry per role (12 h staff, 30 d clients). The Auth.js Credentials provider only supports the JWT session strategy.

## Options

1. Database sessions with workarounds for Credentials: unsupported, fragile across Auth.js releases.
2. Plain JWT: no revocation.
3. JWT carrying a session id that is checked against a `UserSession` row on every server-side `auth()` call.

## Decision

JWT + `UserSession`. The row holds `expiresAt` and `revokedAt`; the JWT is only a pointer.

## Consequences

- One indexed primary-key lookup per authenticated request.
- Edge middleware cannot hit Postgres, so it only checks that a token exists; the authoritative check happens in the Node runtime (`requireUser()`).
