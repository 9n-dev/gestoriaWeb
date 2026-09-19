# 0018. Every file passes one worker pipeline and leaves through one door

Date: 2026-09-19 · Status: accepted

## Context

Files arrive from the web, from email and from staff (permanent documents, logos). All need the same guarantees: real type, antivirus, never served before being clean, every access audited.

## Options

1. Validate at each entry point.
2. One `processFile(fileId)` job for every `StoredFile`, and one route, `/api/files/[id]`, for every download.

## Decision

One pipeline: sniff the type from the bytes → ClamAV (`VirusScanner` adapter; development fake that only flags EICAR) → HEIC→JPEG → SHA-256 → exact-duplicate check for documents. Unsupported or infected files lose their object at once; the row stays as evidence. `can()` refuses any `*.download` while `fileStatus !== 'CLEAN'`, and `fileAccessUrl` records `file.view` / `file.download` before signing a 5-minute URL. A scanner failure throws, so BullMQ retries; an error is never read as clean.

## Consequences

- Without a running worker, uploads stay in "Analizando…" and cannot be opened or processed. `npm run worker` is part of the development setup.
- The second duplicate check (supplier NIF + number + date) only *flags* the document (`duplicateOfId`); a manager confirms with `D`. Exact hash matches are closed automatically.
