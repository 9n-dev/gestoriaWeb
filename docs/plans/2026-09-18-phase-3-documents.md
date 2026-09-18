# Phase 3 — Document intake and manager inbox

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clients send documents from the web, the phone camera or by email; every file is scanned, normalised and checked for duplicates by a worker; managers process them from a keyboard-driven inbox.

**Architecture:** Browser → S3 directly through presigned multipart parts (the app server never proxies file bytes, which keeps it inside Vercel limits). `StoredFile` tracks the lifecycle `PENDING → UPLOADED → CLEAN | INFECTED`. A BullMQ worker (`src/jobs/worker.ts`) processes each file: type sniffing, ClamAV, HEIC → JPEG, SHA-256, exact-duplicate detection. Downloads always go through `/api/files/[id]`: `can()` → audit → 5-minute signed URL. External services sit behind adapters with development fakes: `VirusScanner` (clamd / EICAR-only fake), `InboundEmailProvider` (Resend / inline-attachment fake).

**Tech Stack:** + `bullmq`, `@aws-sdk/s3-request-presigner`, `heic-convert` (ADR 0016), `@playwright/test`.

**Spec:** `CLAUDE.md` §6.3, §6.10 (inbox, saved views), §6.2 (permanent documents), §8.5 (E2E) · ADR 0004 · TD-012, TD-017, TD-022

## Global Constraints

As previous phases, plus:
- Limits: 20 MB per file; jpg, png, pdf, heic. The type is decided from the bytes, never from the name or the declared MIME.
- Never a public URL: signed URLs live 5 minutes; every view/download is audited.
- A file that is not `CLEAN` is never served (enforced in `can()` since phase 1).
- Jobs are idempotent, retried with exponential backoff, payload validated with Zod.
- Out of scope: AI extraction (7) — fields are typed by hand for now and the field-duplicate check is already wired; checklist/period closing UI (4); notification centre UI and preferences (5); offline queue in IndexedDB (10).

## Tasks

1. **Storage and queue plumbing** — `lib/storage/multipart.ts` (create, presign part, list parts, complete, abort, head, delete, signed GET), `lib/queue/index.ts` (`enqueue`, `createWorker`, connection), `lib/files/sniff.ts` (magic bytes → jpg/png/pdf/heic). Tests: sniffing.
2. **Virus scanner adapter** — `modules/documents/antivirus/{index,clamd,fake}.ts`. clamd `INSTREAM` over `node:net`; fake flags the EICAR string. Tests: fake; clamd protocol against a local TCP stub.
3. **Upload service** — `modules/documents/uploads.ts`: `initiateUpload`, `signPart`, `uploadStatus`, `completeUpload`, `abortUpload` for purposes `DOCUMENT` and `PERMANENT_DOCUMENT`. Checks `can('document.upload')` with `periodClosed`, size, declared type; on complete verifies real size with `HeadObject`, creates the owner row, enqueues `file.process`. Tests with storage and queue mocked: permissions per role, closed period, oversize, foreign client, resume status, idempotent complete.
4. **File processing job** — `modules/documents/processing.ts` `processFile(fileId, deps)`: sniff → reject unsupported; scan → `INFECTED` blocks and rejects the document with a notification; HEIC → JPEG (replace object); hash; exact duplicate within the client → `DUPLICATE` + `duplicateOfId`. Idempotent. Tests with fake deps.
5. **Document workflow** — `modules/documents/service.ts`: `listInbox`, `listClientDocuments`, `getDocument`, `updateDocumentFields`, `confirmFields`, `bookDocument`, `rejectDocument` (tenant reason list + note, notifies client users in-app and by email), `markDuplicate`, `reopenDocument`, `deleteDocument`, `fileAccessUrl` (audit). Field duplicates: (supplierTaxId, invoiceNumber, invoiceDate) flags `duplicateOfId` without changing status. `modules/messaging/notifications.ts` `notify()`. Tests: transitions, permissions, duplicate detection (§8.5), notification on rejection, isolation cases.
6. **Inbound email** — `modules/documents/inbound/{provider,resend,fake,service}.ts`, `api/webhooks/resend-inbound`. Svix signature check by hand, idempotency through `WebhookEvent`, address `<slug>-<code>@…` → client, attachments → documents (`source = EMAIL`), no attachments → message in the client's general thread. Tests: signature, replay, routing, unknown address, oversized/unsupported attachment, no-attachment mail.
7. **Permanent documents** — service on top of the upload pipeline + section in the client file. Tests: staff manage, client reads, expiry stored.
8. **API routes** — `api/uploads`, `api/uploads/[fileId]/{parts,complete}`, `api/files/[id]`.
9. **UI** — client: `/subir` (multi-file, camera, browser compression 2500 px / 0.8, per-file progress, retry and resume), `/documentos`. Staff: `/panel/bandeja` (dense table, side preview, `J/K B R D E Enter`, saved views), documents tab in the client file, rejection reasons in settings.
10. **Worker, seed, E2E, docs** — `npm run worker`; seed with synthetic PDFs in every state; Playwright: onboarding, upload → book, 10 photos on throttled 3G; README, ADR 0016, tech debt.
