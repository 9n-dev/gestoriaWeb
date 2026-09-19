# 0022. Replies by email come back through the inbound webhook and the normal permission path

Date: 2026-09-19 · Status: accepted

## Context

§6.8: notification emails carry a unique reply-to per thread and answers must enter the thread.

## Options

1. A second inbound endpoint for replies.
2. The same webhook: `reply+<token>@…` is a thread, `<slug>-<code>@…` is a client's document address.

## Decision

Same webhook, same idempotency (`WebhookEvent`). A reply is accepted only when the sender's address is an active user of the thread's tenant, and the message is written by calling `sendMessage` as that user, so every rule of the web applies by construction: a client holding the token of an internal thread is refused, a manager without the client assigned is refused. Quoted text is stripped with a small set of line patterns (`>`, "El … escribió:", "On … wrote:", "-----Mensaje original-----", "De:"). Attachments of the reply become message attachments and go through the file pipeline.

## Consequences

- The sender check relies on the From address, which can be forged. The reply token is the second factor: unguessable and only present in emails sent to participants. DMARC enforcement on the inbound domain is a deployment recommendation.
- Attachments are added by the author right after sending a message (15-minute window) because the message must exist before its files are uploaded.
