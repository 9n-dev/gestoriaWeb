# 0031. PWA: per-tenant manifest, drawn icons, IndexedDB upload queue, a service worker that caches no pages

Date: 2026-09-19 · Status: accepted

## Context

§6.14: installable on mobile with icon and home screen, works with an intermittent connection (pending uploads in IndexedDB), three touches to upload an invoice. The product is white label and multi-tenant by host; uploads are already resumable multipart (ADR 0017).

## Options

1. `next-pwa`/Workbox with precaching and runtime caching of pages, against a hand-written service worker.
2. Icons derived from the tenant's logo (needs an image library and square logos) against icons drawn from the name and the brand colour.
3. Background Sync API for the queue (Chromium only) against resending from the page.

## Decision

- **Manifest and icons are dynamic routes**: `app/manifest.ts` and `/api/branding/icon/[size]` (`next/og`, already in Next) read the tenant from the host. Every gestoría installs *its* app; no new dependency.
- **The queue lives in the page, not in the worker**: `components/uploader/offline-queue.ts` stores each chosen `File` with its metadata before the first byte leaves, keeps the server file id so a reload resumes the multipart upload, and deletes the entry when the upload completes or fails for good. The uploader pumps on mount and on the `online` event. Works the same on Safari, which has no Background Sync.
- **The service worker is 60 lines**: cache-first for `/_next/static/` (hashed, immutable), `/offline` as the answer to failed navigations, web push. **It never caches pages or API responses**: they are personal and fiscal data, and phones and office PCs are shared.

## Consequences

- `/subir` cannot be opened from a cold start without network (TD-070). The queue covers the real cases: coverage lost while uploading, tab closed, battery dead.
- Staff uploads are not queued (TD-071).
