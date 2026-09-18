# 0007. Invoices survive client erasure and are cancelled by rectifying invoices

Date: 2026-09-18 · Status: accepted

## Context

A client can exercise the right to erasure, but Spanish tax law obliges the gestoría to keep the invoices it issued. Issued invoices also cannot be edited or deleted.

## Options

1. Delete invoices with the client: illegal for the gestoría.
2. Block erasure while invoices exist: defeats the RGPD flow.
3. Keep the invoice, detach the client (`SetNull`), freeze legal data in `recipientSnapshot`.

## Decision

Option 3 (RGPD art. 17.3.b: legal obligation). Cancelling an issued invoice is done by issuing a rectifying invoice (`Invoice.rectifiesId`); the original moves to `CANCELLED`.

## Consequences

- Invoice PDFs and snapshots are excluded from client purge and follow the retention policy instead.
- Rectifying invoices use their own series; implemented in phase 8.
