# 0010. Read state is a per-thread pointer

Date: 2026-09-18 · Status: accepted

## Context

Spec asks for "leído por" on messages and an unread counter.

## Options

1. One row per message and reader: grows with messages × participants.
2. `ThreadRead(threadId, userId, lastReadAt)`.

## Decision

`ThreadRead`. A message is read by every user whose `lastReadAt >= message.createdAt`.

## Consequences

- A message cannot be marked unread individually.
