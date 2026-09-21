## What and why

<!-- One paragraph. Link the section of CLAUDE.md or the tech-debt item this addresses. -->

## How it was verified

- [ ] `npm run lint && npm run typecheck && npm test`
- [ ] `npm run build && CI=1 npm run test:e2e`
- [ ] Tried by hand in the demo tenant (say what you did)

## Checklist

- [ ] Tenant data goes through `tenantDb`; new tenant-owned models have a row in `tests/setup/world.ts`
- [ ] Permissions go through `can()`; inputs are validated with Zod
- [ ] Interface copy in Spanish, no emojis; code and docs in English
- [ ] README, help articles, seed and `docs/tech-debt.md` updated where the change touches them
- [ ] ADR added or amended if a non-trivial decision was taken
