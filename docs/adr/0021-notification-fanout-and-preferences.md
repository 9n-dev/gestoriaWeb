# 0021. One notification fan-out; in-app is the record, email and push are preferences

Date: 2026-09-19 · Status: accepted

## Context

From phase 3 on, several modules notify people. §6.8 adds a counter, web push and per-user preferences.

## Options

1. Each module sends its own emails.
2. One `notifyUsers(tenantId, userIds, payload)` that every module calls.

## Decision

One fan-out. It always writes the in-app `Notification` (it is the record and feeds the counter), sends the email unless the user turned email off or muted that type, and pushes to every registered browser unless push is off. Push goes through a `PushSender` adapter (`web-push` with VAPID keys, or a logging fake); subscriptions the browser dropped (404/410) are deleted; a push failure never breaks the caller. `web-push` is 76 KB and spares us re-implementing VAPID and aes128gcm payload encryption.

## Consequences

- Reminders of deadlines can be muted by the user too. If a gestoría needs some notices to be mandatory, add a non-mutable list.
- The service worker (`public/sw.js`) only handles push for now; caching and offline arrive with the PWA (phase 10).
