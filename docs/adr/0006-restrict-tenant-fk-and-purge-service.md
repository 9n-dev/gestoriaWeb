# 0006. Tenant FKs are `Restrict`; physical deletion only through the purge service

Date: 2026-09-18 · Status: accepted

## Context

Spec requires soft delete for clients and documents, and physical deletion only on client erasure and tenant offboarding, leaving the system clean (including the bucket).

## Options

1. `onDelete: Cascade` from `Tenant`: one `DELETE` wipes everything, including by accident, and leaves orphan objects in the bucket.
2. Default `Restrict` + an explicit purge service.

## Decision

`Restrict`. The purge service deletes bucket objects first, then rows in dependency order, inside a transaction. `Cascade` is used only for compositional children (invoice lines, attachments, join rows) and for children of `Client`.

## Consequences

- Adding a tenant-owned table means adding it to the purge service; the offboarding test fails otherwise.
