# 0020. Reminders: one message per client and day, claimed in `ReminderLog` before sending

Date: 2026-09-19 · Status: accepted

## Context

§6.6 asks for reminders at 15, 7, 2 and 0 days with different templates, and for "missing documentation" reminders listing what is missing. A quarterly client has three or four forms due on the same day; jobs must be idempotent and retried.

## Options

1. One email per obligation and another per checklist: up to five emails on the same morning.
2. One message per client and day that names every form due and lists the missing documents.

## Decision

Option 2. The step is the closest configured offset already *reached*, not an exact day match, so a morning without worker or an obligation created late still gets its notice. Before sending, the job inserts `(kind, entityId, step)` rows and only proceeds with the ones that were new; if sending throws, those rows are deleted and the BullMQ retry delivers the message. The schedule is one repeatable `daily` job (08:00 Europe/Madrid) that fans out a `tenant-daily` job per tenant carrying the date, so tenants fail and retry independently and a retry after midnight still works for its own morning.

## Consequences

- At-least-once: a crash between sending and releasing the claim cannot lose a reminder, and a crash after sending but before the job completes cannot duplicate it (the rows are already there).
- Wording lives in code with per-tenant overrides in `Template` (kind EMAIL); the editor with preview is phase 6.
- Clients without any portal user get no reminders, and nothing is logged for them, so inviting them later still triggers the next step.
