# Contributing

How work is done in this repository. The rules come from the specification ([`CLAUDE.md`](CLAUDE.md) §3 and
§8) and from what the project learned on the way.

## Before writing code

- Read the section of `CLAUDE.md` that covers what you are touching. If it is ambiguous, ask; do not invent
  requirements.
- The stack is fixed. A new runtime dependency needs an ADR that explains why a few lines of our own would not
  do. Seventeen dependencies is a feature of this codebase.

## The rules that are never bent

- **Tenant isolation.** Tenant data is reached through `tenantDb(tenantId)`, with the id taken from the
  session. A new tenant-owned model needs a row in `tests/setup/world.ts`; the isolation suite fails until it
  has one.
- **Permissions.** One function, `can(user, action, resource)`. No role checks in components or services.
- **Boundaries are validated with Zod**: forms, API routes, jobs, webhooks, environment.
- **Errors** cross the server boundary only as `AppError` with a Spanish message for the person.
- **Files** are served through `/api/files/[id]` only: permission, audit entry, five-minute signed URL.
- **TypeScript strict**, no `any`, no `@ts-ignore`. **No TODO** without an entry in `docs/tech-debt.md`.
- **Migrations** are never edited once applied, and each ships a hand-written `down.sql`.
- Interface copy, emails and help in **Spanish**; code, commits and documentation in **English**. No emojis.
- Accessibility is WCAG AA: visible focus, labels, contrast, keyboard. The staff inbox has documented
  shortcuts; keep them working.

## Workflow

1. Branch from `main`: `feat/...`, `fix/...`, `docs/...`, `chore/...`.
2. Small commits, [Conventional Commits](https://www.conventionalcommits.org/): `feat(documents): ...`.
3. Write the test with the change. Services are tested against a real PostgreSQL (`gestoria_test`); flows that
   matter to a person get a Playwright test (it runs on `gestoria_e2e`, created on first run).
4. Before merging, all of this passes, chained with `&&` so a failure stops the merge:

   ```bash
   npm run lint && npm run typecheck && npm test && npm run build && CI=1 npm run test:e2e
   ```

5. Update what the change touches: the seed, the README, the help articles in `content/help`, and
   `docs/tech-debt.md` (close what you closed, open what you knowingly left).
6. A decision that was not obvious gets an ADR in `docs/adr/NNNN-title.md`: context, options, decision,
   consequences. Later changes to a decision are addenda, not rewrites.
7. Merge with `--no-ff` so the history keeps one merge commit per piece of work.

## Useful commands

| Command                                       | What it is for                                               |
| --------------------------------------------- | ------------------------------------------------------------ |
| `docker compose up -d`                        | PostgreSQL (5433), Redis, MinIO                              |
| `npm run dev` and `npm run worker`            | The app and the BullMQ worker                                |
| `npm run db:seed`                             | Idempotent demo data                                         |
| `npm run job:daily -- 2026-10-13`             | The morning job for any date                                 |
| `npm run job:demo-reset`                      | Delete and re-seed the demo tenants (needs `DEMO_MODE=true`) |
| `npm run screenshots` and `npm run demo:gifs` | Retake the README media from a production build              |
