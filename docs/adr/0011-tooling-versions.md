# 0011. Tooling: Prisma 6, npm, Node 22

Date: 2026-09-18 · Status: accepted

## Context

Prisma 8 is still a release candidate and moves datasource configuration out of the schema. The spec uses `npm run` scripts.

## Options

1. Prisma 8 RC.
2. Prisma 6.x (current stable line).

## Decision

Prisma 6.x, npm, Node 22 LTS (`engines` in package.json and the CI matrix).

## Consequences

- Upgrading Prisma is a tracked item in `docs/tech-debt.md`.
