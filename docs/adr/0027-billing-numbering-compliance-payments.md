# 0027. Billing: numbering under a row lock, rectifying invoices, compliance and payments behind interfaces

Date: 2026-09-19 · Status: accepted

## Context

§6.11: monthly fees, invoices with correlative numbering per series and tenant without gaps or duplicates, legal PDF, Verifactu-ready fields behind `InvoiceCompliance`, Stripe and GoCardless behind `PaymentProvider`, signed and idempotent webhooks, configurable dunning.

## Options

1. Number invoices when the draft is created: simple, but every deleted draft leaves a gap.
2. Number at issue time, inside one transaction that locks the series row.

## Decision

Number at issue. `issueInvoiceById` runs one transaction: `SELECT … FOR UPDATE` on the `InvoiceSeries` row, take `nextNumber`, read the previous hash of the series, seal (`InvoiceCompliance`), write the PDF, update invoice and series. Concurrent issuers queue on the lock; a failure rolls everything back, so no number is burnt (both covered by tests with 12 parallel issues). Issued invoices are immutable: cancelling issues a rectifying invoice with negative lines in the `R` series and marks the original `CANCELLED`. Issuer and recipient data are frozen in snapshots, which is also what lets invoices outlive a client's erasure (ADR 0007). **Compliance**: `hashChainCompliance` already chains every invoice to the previous one and produces the verification-QR payload; sending records to AEAT is a future implementation of the same interface. **Payments**: Stripe Checkout and GoCardless payments are called with `fetch` (no SDKs); without keys, development providers settle the payment at once. Webhooks verify the provider signature first and then insert each event into `WebhookEvent` (unique on provider + id): a replay is acknowledged and ignored. **Dunning** runs in the daily tenant job: overdue on the day after the due date, reminders at 3/10/20 days (`ReminderLog`), `DELINQUENT` at 30, back to `ACTIVE` when nothing is overdue.

## Consequences

- The PDF is written inside the transaction; a rollback can leave an orphan object in the bucket (never a wrong invoice). Swept by the retention job.
- A delinquent client cannot download documents but can download and pay its invoices (exception in `can()`).
- The counter does not restart each year (`A-2026-00012`, then `A-2027-00013`): legal, and one less thing to get wrong. A gestoría that wants yearly series changes `seriesCode`.
