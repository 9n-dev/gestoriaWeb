# 0033. Team management: disable instead of delete, mandatory hand-over, no self-service

Date: 2026-09-19 · Status: accepted

## Context

TD-020: a tenant admin could invite staff but not change a role, take access away, or unlink a person from a client. `User` rows are referenced without cascade by documents, messages, deliveries, obligations and the audit log (ADR 0006), and every client has at most one assigned manager who receives its notifications.

## Options

1. Delete the user and null every reference: loses "who booked this document" and needs a purge path per relation.
2. Disable the user (`status = DISABLED`) and keep the row.

## Decision

- **Option 2.** "Dar de baja" sets `DISABLED` and revokes sessions; login, magic links and `loadSessionUser` already refuse disabled users. "Reactivar" restores `ACTIVE`, or `INVITED` if the person never verified an email, and clears the lockout counters.
- **Hand-over is mandatory**: a colleague with assigned clients cannot be disabled until an active staff member is chosen to receive all of them, in the same operation. No client is ever left without a manager by accident.
- **Nobody edits their own access** (role or status). Whoever makes a change is, by definition, an active admin who stays one, so the "last admin" problem cannot happen and needs no counting query.
- **A role change revokes the person's sessions**: permissions are read from the database on each request anyway, but navigation and landing page are not; a fresh login is the simple, visible cut.
- **Client users**: "Retirar acceso" deletes the `ClientUser` link (permission `client.removeUser`, scoped like every client action). A person left with no client is disabled; inviting the same email again to any client reactivates the account instead of failing on the unique email.

## Consequences

- Disabled people stay in the team list (marked "Desactivado"); there is no way to hide them.
- An email can never be reused for a different person inside a tenant; the admin reactivates or renames instead.
