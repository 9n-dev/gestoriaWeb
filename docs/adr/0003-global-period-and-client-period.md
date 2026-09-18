# 0003. `Period` is global; per-client state lives in `ClientPeriod`

Date: 2026-09-18 · Status: accepted

## Context

The spec defines `Period` as (year, quarter/month, type), but "cerrar documentación" changes the state of a period for one client.

## Options

1. `Period` rows per client: duplicates the calendar thousands of times.
2. Global `Period` + `ClientPeriod(clientId, periodId, status)`.

## Decision

Global `Period` reference table, `ClientPeriod` for OPEN/CLOSED state. `ClientPeriod` rows are created lazily.

## Consequences

- A missing `ClientPeriod` row means OPEN.
