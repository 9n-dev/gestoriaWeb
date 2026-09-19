# 0019. Checklist fulfilment is automatic with a manual override; the light counts down to the first filing

Date: 2026-09-19 · Status: accepted

## Context

§6.5 defines the traffic light by "days left" without saying to what, and says items can be fulfilled automatically or manually.

## Options

1. Managers tick everything by hand: accurate, but it is the very chasing work the product should remove.
2. Automatic only: cannot express "no payrolls this quarter".
3. Automatic from documents, plus a manual tick that automation never undoes.

## Decision

Option 3. An item is met when the client has at least one document of that type in that period that is not rejected or a duplicate (uploads still being scanned count; unfinished uploads do not). `refreshChecklist` is called from every place a document appears or changes. A manager's tick (`fulfilledManually`) survives any document change; unticking returns the item to automatic. Dismissed automatic items stay as rows so regeneration does not resurrect them. The deadline of a checklist is the earliest due date among the client's obligations for that period (day 20 of the following month when it has none), and the period shown by default is the one being *collected*: the quarter that just ended while its filing window is open.

## Consequences

- `getClientChecklist` creates the checklist on first read (a write during a GET). It is idempotent and keeps new clients from showing an empty screen until the nightly job.
- The tenant overview works by quarter; clients with monthly VAT have monthly checklists and appear when that month is selected (TD-037).
