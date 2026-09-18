# 0008. `AuditLog` has no foreign keys and is append-only by trigger

Date: 2026-09-18 · Status: accepted

## Context

Spec: insert only; no route may update or delete it. It must also survive deletion of the users and entities it refers to.

## Options

1. FKs to `User`/`Tenant`: cascades or `SetNull` would mutate audit rows.
2. Plain id columns, no FKs, and a DB trigger rejecting `UPDATE`/`DELETE`.

## Decision

Option 2. The trigger allows `DELETE` only when the purge service sets a transaction-local flag (`app.audit_purge`) during tenant offboarding. The audit repository exposes `record()` and read queries, nothing else. Delivery view/download history is read from here instead of a second log table.

## Consequences

- Actor names are resolved at read time and may be missing for deleted users.
