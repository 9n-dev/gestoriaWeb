# 0009. `Obligation.model` is a `String`

Date: 2026-09-18 · Status: accepted

## Context

The list of AEAT forms in the spec is open-ended and Prisma enum values cannot start with a digit.

## Options

1. Enum `M303`, `M130`…: needs a migration for every new form and a mapping layer.
2. `String` validated with Zod against `data/tax-calendar-<year>.json`.

## Decision

`String`.

## Consequences

- Adding a form is a data change, not a migration.
