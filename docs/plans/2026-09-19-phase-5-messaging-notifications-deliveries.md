# Phase 5 — Messaging, notifications, deliveries and simple signature

> **Status: completed 2026-09-19** on branch `phase-5`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gestoría and client talk inside the portal (and by replying to its emails), everybody has a notification centre with a counter, preferences and web push, and the gestoría delivers documents that the client can sign with a verifiable certificate. Closes the minimum sellable product (phases 1–5).

**Architecture:** `modules/messaging` owns threads, messages, message templates and the notification centre; `notifyUsers` becomes the single fan-out to in-app, email and push, honouring per-user preferences. Replies by email reuse the inbound webhook of phase 3: `reply+<thread token>@…` routes to the thread. `modules/deliveries` reuses the upload pipeline (`DELIVERY`, `MESSAGE_ATTACHMENT` purposes) and the single download door, whose audit entries *are* the view/download history. The signature certificate is a PDF built with the project's own minimal PDF writer.

**Tech Stack:** + `web-push` (76 KB; VAPID + payload encryption are not worth re-implementing). Behind a `PushSender` adapter with a logging fake when no VAPID keys are configured.

**Spec:** `CLAUDE.md` §6.7, §6.8, §7 · TD-030 · ADR 0008 (history from the audit log), 0010 (read pointer)

## Global Constraints

As previous phases, plus:
- INTERNAL threads, their messages, attachments and notifications never reach a `CLIENT_USER` (tested at service level, not only hidden in the UI).
- Mentions only in internal threads, only to staff of the same tenant.
- A signature stores timestamp, IP, user agent and the SHA-256 of the exact file that was signed; the certificate states them.
- Email replies are accepted only from a user of the tenant who can read that thread.

## Tasks

1. **Notification centre** — `modules/messaging/notifications.ts` (extend): preferences (`email`, `push`, `mutedTypes`) in `User.notificationPrefs`; `listNotifications`, `unreadCount`, `markRead`, `markAllRead`, `updatePreferences`; push fan-out through `modules/messaging/push/{index,web-push,fake}.ts`; `subscribePush` / `unsubscribePush`; dead subscriptions (404/410) are deleted. Tests: preferences honoured per channel, in-app always written, only own notifications, push pruning.
2. **Threads and messages** — `modules/messaging/service.ts`: `listThreads`, `getThread` (marks read), `createThread`, `sendMessage`, `setThreadStatus`; who gets notified (other side; mentioned staff; participants of internal threads); reply-to per thread. Attachments: message first, then uploads with purpose `MESSAGE_ATTACHMENT` by the author within 15 minutes; `fileAccessUrl` branch. Tests: visibility per role, internal never leaks, mentions, unread state, notifications, attachments, isolation.
3. **Replies by email** — `inbound/service.ts`: `reply+<token>@` → message in the thread (quoted text stripped, sender must be able to read the thread, attachments kept). Tests: happy path, unknown sender, client replying to an internal thread token, replay.
4. **Message templates** — `modules/messaging/templates.ts`: CRUD (admin), `renderForClient` with `{{cliente}} {{plazo}} {{pendientes}}`. Tests.
5. **Deliveries and signature** — `modules/deliveries/{schema,service,certificate}.ts`, `lib/pdf.ts` (moved from the seed): upload purpose `DELIVERY`, `listDeliveries`, `signDelivery`, `deliveryHistory`, `deleteDelivery`; availability notice when the file is clean and `visibleFrom` has arrived (worker hook + daily job). Tests: visibility window, DELINQUENT, sign once with evidence, certificate content and hash, history, permissions, isolation.
6. **UI** — header bell with counter; `/notificaciones`; preferences and push in `/cuenta` + `public/sw.js`; client `/mensajes`, `/entregas` (+ signing page); staff `/panel/mensajes`, thread from the client file, deliveries section in the client file, `/panel/ajustes/plantillas`.
7. **Seed, E2E, docs** — half-way conversations, an open requirement from Hacienda, deliveries (one signed, one waiting); Playwright: conversation both ways + sign a delivery; README, ADRs, tech debt, MVP checklist against §9.
