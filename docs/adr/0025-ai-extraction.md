# 0025. AI extraction: Claude with structured outputs behind `DocumentExtractor`, validated twice

Date: 2026-09-19 · Status: accepted

## Context

§6.4: asynchronous extraction of invoice fields with Claude vision, JSON validated with Zod, one corrective retry, `FAILED` fallback, cost per tenant, provider swappable.

## Options

1. Free-text JSON in the prompt and parse it ourselves.
2. The official SDK with structured outputs (`messages.parse` + `zodOutputFormat`).

## Decision

Option 2 (`@anthropic-ai/sdk`, model from `ANTHROPIC_MODEL`, default `claude-opus-5`, effort `low`). The schema sent to the model holds only nullable strings and numbers; *business* validation happens after: ISO date not in the future, amounts coherent, something actually found. Problems are sent back once as a correction prompt; a second failure marks the document `FAILED` and a manager types the fields. A provider error (rate limit, overload) throws so BullMQ retries the job. Results never overwrite fields a manager typed or confirmed. The NIF is normalised when it passes its control letter; otherwise it is kept as read and confidence is capped at 0.5. The invoice date suggests the period when the client chose none, and the supplier NIF + number + date duplicate check of §6.3 runs again. Every call writes an `AiUsageLog` row (tokens per tenant). Without `ANTHROPIC_API_KEY` a deterministic parser of text PDFs is used: it understands the synthetic invoices of the seed and `fixtures/`, nothing else.

## Consequences

- The §6.4 acceptance test (≥ 9 of 10 sample invoices) runs against the development parser in CI; `RUN_AI_EXTRACTION_TEST=1` with a key runs it against Claude (a few cents).
- Refusals are treated as a failed extraction (manual processing); server-side model fallbacks are not enabled, since an invoice is an unlikely refusal trigger and the manual path already exists.
- One VAT rate per document, as in the spec; invoices with several rates get totals and the main rate (tech debt).

## Addendum (2026-09-22): several VAT rates

The scalar fields stay as the totals of the document; `vatBreakdown` (JSON, one `{ rate, base, vat }` per rate) exists only when there is more than one rate, so nothing changes for the common case. The extractor is asked for it, and the validation refuses breakdowns whose sums do not match the totals or whose VAT is not the stated percentage of its base. When the manager types rows, they win: the totals are recomputed from them. The export gets per-rate columns, which is how accounting programs take multi-rate invoices.
