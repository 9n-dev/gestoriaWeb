# 0023. Simple signature: evidence in the row, certificate as a generated PDF

Date: 2026-09-19 · Status: accepted

## Context

§6.7 asks for a simple signature: the client reads, agrees, and we keep timestamp, IP, user agent and document hash, plus a PDF certificate.

## Options

1. A third-party signature provider: qualified signatures are out of scope and cost per signature.
2. Our own record + certificate.

## Decision

Our own. Signing requires a CLEAN file with its SHA-256 computed by the worker; the delivery row is claimed with a conditional update (two clicks, one signature) and stores `signedAt`, signer, IP, user agent and `signedFileHash`. The certificate is a text PDF written by `lib/pdf.ts` (no PDF dependency) stating all of it, stored as a `SIGNATURE_CERTIFICATE` file and served through the same audited door. A signed delivery cannot be deleted. View/download history is read from the audit log (ADR 0008).

## Consequences

- This is a *simple* electronic signature (eIDAS art. 3.10): adequate for conformity with drafts and engagement letters, not for documents that legally require an advanced or qualified one.
- `lib/pdf.ts` writes one page of Latin-1 text. Invoices (phase 8) need real layout and will justify a PDF library then.
