# Phase 4 — Checklists, traffic light, filings, reminders and scheduled workers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The gestoría sees at a glance which clients still owe documentation for the period, files each obligation with its result and receipt, and the system chases clients and managers on its own every morning.

**Architecture:** Pure functions decide (traffic light, which reminders are due); services apply them with `can()` + `tenantDb()` + audit; one BullMQ scheduler fires `daily` at 08:00 Europe/Madrid and fans out one idempotent `tenant-daily` job per tenant. Idempotency of every notice is a row in `ReminderLog`, never in-memory state.

**Tech Stack:** no new dependencies.

**Spec:** `CLAUDE.md` §6.5, §6.6, §6.9, §6.10 (dashboard), §8.5 (E2E filing flow) · TD-013, TD-021, TD-023, TD-032

## Global Constraints

As previous phases, plus:
- Traffic light: green = nothing missing; amber = items missing and more than 7 days left; red = items missing and 7 days or fewer, or overdue.
- Reminder offsets 15, 7, 2 and 0 days, configurable per tenant, with a different template per step; "missing documentation" text lists exactly what is missing.
- Jobs: idempotent, exponential retries, failed jobs kept as dead letters, payloads validated with Zod, dates passed in the payload (a retry after midnight must not change the day it works for).
- New migration for schema changes; applied migrations are never edited.
- Out of scope: template editor with preview (6), in-app notification centre (5), demo reset job (10).

## Tasks

1. **Schema** — migration `checklist_manual_fulfilment`: `ChecklistItem.fulfilledManually`. New action `obligationReceipt.download`.
2. **Checklist + traffic light** — `modules/checklists/{light,service}.ts`. Pure `trafficLight(missing, deadline, today)`. `ensureChecklist` (from the tax profile, idempotent, respects dismissed items), `refreshChecklist` (auto-fulfilment from documents of that type and period; never undoes a manual tick), `addItem`, `dismissItem`, `setItemFulfilled`, `closePeriod` / `reopenPeriod`, `getClientChecklist`, `tenantOverview(user, period, filters)` + CSV. Hooks: profile assignment, document upload/processing/transitions. Tests: light boundaries (8/7/0/-1 days), generation, dismissal survives regeneration, auto/manual fulfilment, closing blocks client uploads, manager scope, isolation.
3. **Filing workflow** — `modules/obligations/workflow.ts`: `startObligation`, `setEstimate`, `fileObligation` (result, amount, direct debit, optional receipt; notifies the client), `reopenObligation`, `createObligation` (manual, deadline from the calendar), `deleteObligation` (only untouched). Upload purpose `OBLIGATION_RECEIPT`; `fileAccessUrl` serves receipts. `listUpcomingObligations` for staff and client. Tests: transitions, permissions, notification, receipt access incl. DELINQUENT, manual create/delete, isolation.
4. **Reminders** — `modules/obligations/reminders/{templates,planner,service}.ts`. Defaults in code, tenant overrides from `Template` (kind EMAIL, keys `reminder.deadline.15d|7d|2d|0d`, `reminder.inactivity`, `reminder.permanent_expiry`), `{{cliente}} {{plazo}} {{modelos}} {{pendientes}}` rendering. `runTenantDaily(tenantId, today)`: deadline + missing-docs reminders grouped in one message per client and day, inactivity notice to the manager, permanent-document expiry (60/30/7), checklist upkeep; obligations sync on the 1st of the month (covers 1 December). Tests: each offset fires once, re-run sends nothing, filed obligations are silent, missing list is concrete, tenant settings (disabled, custom offsets, inactivity days), isolation.
5. **Scheduler, cleanup, dead letters** — `jobs/` split: `files.ts`, `scheduled.ts`; `upsertJobScheduler('daily', '0 8 * * *', tz Europe/Madrid)`; `cleanup` (expired sessions and tokens, unverified tenants > 7 days, PENDING uploads > 24 h with their multipart uploads). `modules/platform/jobs.ts`: failed jobs list (payload reduced to ids) and retry, superadmin only. Tests: cleanup, permissions.
6. **UI** — client: `/plazos`, "Nos falta…" on `/inicio`. Staff: checklist and filing actions in the client file, `/panel/semaforo` (sortable, filters, CSV export), `/panel/plazos`, dashboard on `/panel`, reminder settings. Platform: `/plataforma/jobs`.
7. **Seed, E2E, docs** — obligations in several states, checklists; Playwright "manager files an obligation and the client sees it"; README, ADRs, tech debt.
