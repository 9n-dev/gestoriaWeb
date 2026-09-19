# 0017. Uploads go from the browser straight to the bucket, in resumable parts

Date: 2026-09-19 · Status: accepted

## Context

§6.3 asks for resumable uploads over bad mobile connections, 20 MB files, and the app runs on Vercel, whose functions cap request bodies at a few MB.

## Options

1. Proxy the bytes through the app: simple permissions, but impossible on Vercel for 20 MB and doubles the traffic.
2. One presigned PUT per file: no resume; a dropped connection restarts the file.
3. S3 multipart with one presigned URL per part, requested from the app.

## Decision

Option 3. `initiateUpload` checks `can()`, creates the `StoredFile` (PENDING) **and its owner row** so the metadata chosen by the user survives until the bytes arrive, and opens the multipart upload. The browser signs each part just before sending it (URLs live 5 minutes), retries with backoff, and can resume by asking which parts the bucket already holds (`ListParts` is the source of truth, no client-side bookkeeping, no ETags crossing CORS). `completeUpload` trusts only `HeadObject` for the size and enqueues the file for processing. Documents whose file is still PENDING are invisible everywhere.

## Consequences

- S3 parts are at least 5 MiB, so after browser compression most photos are a single part; resumability matters for large PDFs and HEIC.
- The bucket needs CORS for `PUT` from the portal origins (MinIO allows it by default; R2 needs a rule, see README).
- Abandoned uploads leave PENDING rows and open multipart uploads until the cleanup job (TD-013).
