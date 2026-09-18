# 0013. Obligations are generated only for deadlines still ahead

Date: 2026-09-18 · Status: accepted

## Context

§6.2 says assigning a tax profile generates "the obligations of the current year". A client that joins in September would get Q1 and Q2 forms that were filed long ago outside the portal, all of them overdue and red.

## Options

1. Generate the whole fiscal year: literal, but floods every new client with false overdue work.
2. Generate only obligations whose real deadline is today or later, looking at fiscal years Y-1 and Y (Y+1 from December).

## Decision

Option 2. `syncObligationsForClient` is the single entry point (assign, change or edit a profile, December job) and is idempotent through the unique key `(clientId, model, periodId)`. Fiscal year Y-1 is included because its annual forms (390, 190, 347, 100, 200) are due during Y.

## Consequences

- History before the client joined is not in the portal. A manager who wants it must create it by hand (not possible yet, see tech debt).
- On a profile change only future obligations in `PENDING_DOCS` are removed; anything started or filed stays.
