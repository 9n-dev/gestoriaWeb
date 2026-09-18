# 0004. `StoredFile` is the single registry of bucket objects

Date: 2026-09-18 · Status: accepted

## Context

Seven entities own a file (documents, permanent documents, deliveries, signature certificates, obligation receipts, message attachments, invoice PDFs). All need storage key, size, mime, hash, upload lifecycle and antivirus state.

## Options

1. Repeat the fields on each table, as the literal field list in CLAUDE.md §5 suggests for `Document`.
2. One `StoredFile` table referenced one-to-one by each owner.

## Decision

`StoredFile`. Multipart upload state and ClamAV result are tracked once; `/api/files/[id]` is the single download path (permission check, audit, signed URL); the purge service walks one table to leave the bucket clean.

## Consequences

- Hash duplicate detection joins `Document` → `StoredFile` (indexed on `tenantId, sha256`).
- `sizeBytes` is `Int` (max 2 GB); tenant export archives use `DataExport.storageKey` with `BigInt` size instead.
