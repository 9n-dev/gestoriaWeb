# 0028. Second factor, rate limiting and CSP

Date: 2026-09-19 · Status: accepted

## Context

§4 asks for TOTP 2FA with recovery codes (mandatory for staff), rate limiting on authentication and upload endpoints, and a strict CSP. Sessions are JWT + `UserSession` rows (ADR 0002).

## Options

1. A 2FA library (`otplib`, `speakeasy`) against ~60 lines of RFC 6238 over `node:crypto`.
2. Where the "second factor passed" bit lives: in the JWT (needs re-issuing the cookie) or on the `UserSession` row.
3. Rate limiting with a library (`rate-limiter-flexible`, Upstash) or with `INCR` + `EXPIRE` on the Redis we already run.
4. CSP as static headers (needs `'unsafe-inline'` for Next's inline scripts) or per-request nonce in middleware.

## Decision

- **TOTP is our own code** (`modules/auth/two-factor/totp.ts`), tested against the RFC 6238 vectors, ±1 step of drift, constant-time comparison. The secret is stored encrypted (AES-256-GCM, key derived from `AUTH_SECRET`, `lib/crypto.ts`); recovery codes are stored as SHA-256 hashes and are single use. The only new dependency is `qrcode` (small, no native code) to draw the enrolment QR on the server as a data URL.
- **`UserSession.twoFactorVerifiedAt`** carries the bit. `loadSessionUser` reports `twoFactor: 'ok' | 'enrol' | 'challenge'`; `getSessionUser()` returns only fully verified users, so every page, action and API route is closed by default, and only `/acceso` and `/acceso/2fa` use `getPendingUser()`. Wrong codes count towards the same 5-attempts/15-minutes lockout as wrong passwords. Staff cannot turn 2FA off; a tenant admin can reset a colleague's (sessions are revoked and they enrol again).
- **Enforcement is skipped when `DEMO_MODE=true`** (the feature stays available): the published demo users must be able to log in. TD-062.
- **Rate limiting**: fixed window in Redis, keyed by bucket + IP (+ email or user id), applied in actions and route handlers, never in services. It fails open: if Redis is down people can still log in and the account lockout keeps protecting passwords.
- **CSP with a nonce per request** in `src/middleware.ts`: `script-src 'self' 'nonce-…' 'strict-dynamic'`, the bucket origin as the only foreign origin (direct uploads, previews), payment pages in `form-action`, `frame-ancestors 'none'`. `'unsafe-eval'` and `ws:` exist in development only. An E2E test walks the client area and fails on any violation.

## Consequences

- Every page is dynamic (it already was: the tenant comes from the host).
- A TOTP code can be replayed within its 30-second window (TD-061).
- `style-src` keeps `'unsafe-inline'` (TD-067).
