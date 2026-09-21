# Architecture in diagrams

The prose lives in the [README](../README.md#architecture) and the reasons in the [ADRs](adr). These are
the pictures: who talks to whom, and what happens to a request, a file, a morning and an invoice.

## The pieces

```mermaid
flowchart LR
  subgraph Browser
    PWA[Client PWA and staff panel]
    SW[Service worker: asset cache, offline page, push]
    IDB[(IndexedDB upload queue)]
  end
  subgraph Vercel
    MW[middleware: CSP nonce, security headers]
    APP[Next.js App Router: pages, server actions, route handlers]
  end
  subgraph Worker[BullMQ worker on Railway or Fly]
    FILES[queue files: process, extract]
    SCHED[queue scheduled: daily, tenant-daily, cleanup, export, demo-reset]
  end
  PG[(PostgreSQL)]
  REDIS[(Redis)]
  S3[(S3 bucket: R2 or MinIO)]
  EXT[Resend, Anthropic, Stripe, GoCardless, ClamAV, Vercel domains]

  PWA --> MW --> APP
  PWA -- presigned multipart parts --> S3
  PWA <--> IDB
  SW -. push .-> PWA
  APP --> PG
  APP -- enqueue, rate limits --> REDIS
  APP -- signed URLs, 5 min --> S3
  REDIS --> FILES & SCHED
  FILES & SCHED --> PG
  FILES --> S3
  APP & FILES & SCHED --> EXT
  EXT -- webhooks: inbound email, payments --> APP
```

Every external service sits behind an interface with a development fake (`DocumentExtractor`,
`PaymentProvider`, `DomainProvider`, `EmailDomainProvider`, the antivirus scanner, the email sender), so the
whole product runs on `docker compose up` with no keys.

## A request: tenant, session, permission, data

```mermaid
sequenceDiagram
  participant B as Browser
  participant M as middleware
  participant P as page / action / route
  participant T as tenants/resolve
  participant A as auth/session
  participant C as can()
  participant D as tenantDb(tenantId)

  B->>M: GET clientes.gestoriaperez.es/documentos
  M->>P: request + CSP nonce
  P->>T: host -> tenant (subdomain or verified custom domain)
  P->>A: requireUser(): JWT carries only a UserSession id
  A-->>P: user of THIS tenant, 2FA passed, agreements accepted (or a redirect)
  P->>C: assertCan(user, 'document.read', resource)
  C-->>P: scope: own / assigned / all, plus state gates (file clean, client not delinquent...)
  P->>D: query
  Note over D: a Prisma extension forces tenantId into every where and data
  D-->>B: rows of this tenant only
```

`modules/tenants/isolation.test.ts` builds a full world of data for tenant B and proves that users of
tenant A cannot list, read, count, update or delete any of it, model by model (the list of models comes
from the Prisma schema, so a new table cannot be forgotten).

## A file: from the phone to the manager's inbox

```mermaid
flowchart TD
  pick[Client picks photos] --> idb[Saved in IndexedDB]
  idb --> compress[Resized to 2500 px, JPEG 0.8, in the browser]
  compress --> init[POST /api/uploads: permission, StoredFile PENDING, multipart upload]
  init --> parts[Parts PUT straight to the bucket with presigned URLs]
  parts -- connection lost --> resume[ListParts says what arrived, continue]
  resume --> parts
  parts --> complete[Complete: StoredFile UPLOADED, job enqueued, IndexedDB entry removed]
  complete --> sniff{Type from the bytes}
  sniff -- not accepted --> gone[Object deleted, document rejected, client told why]
  sniff --> av{ClamAV}
  av -- infected --> blocked[INFECTED: never served, client and manager told]
  av -- clean --> heic[HEIC to JPEG, SHA-256]
  heic --> dup{Same hash for this client?}
  dup -- yes --> flag[Marked as possible duplicate]
  dup --> clean[StoredFile CLEAN, document in the inbox]
  flag --> clean
  clean --> extract[extract job: Claude with vision, Zod validation, one corrective retry]
  extract --> fields[Fields with confidence, period suggested from the date, second duplicate check by supplier + number + date]
  fields --> inbox[Manager confirms or corrects with the keyboard and books]
```

Downloads have a single door, `/api/files/[id]`: permission check, audit entry, then a signed URL that
lives five minutes. There are no public URLs.

## A morning: the daily job

```mermaid
flowchart LR
  cron[08:00 Europe/Madrid] --> daily[daily]
  daily --> fan[one tenant-daily job per active tenant, date in the payload]
  daily --> cleanup[cleanup + GDPR sweep]
  fan --> r1[Deadline reminders at 15, 7, 2 and 0 days with the concrete missing list]
  fan --> r2[Expiring permanent documents at 60, 30 and 7 days]
  fan --> r3[Inactive clients, for their manager]
  fan --> r4[Day 1: monthly invoices. Every day: dunning at 3, 10, 20 and delinquent at 30]
  fan --> r5[December: next year's obligations]
  cleanup --> g1[Expired sessions and tokens, abandoned uploads]
  cleanup --> g2[Client erasures and tenant purges whose 30 days are over]
  cleanup --> g3[Retention: monthly notice, then only what a notice announced]
```

Every step is idempotent through `ReminderLog` (claim, send, release on failure) or a unique key, so a retry
or a double tick never sends anything twice, and a day without worker is caught up the next morning.

## An invoice: numbering without gaps

```mermaid
sequenceDiagram
  participant S as issueInvoiceById
  participant DB as PostgreSQL
  participant B as Bucket

  S->>B: read the tenant logo (before the transaction)
  S->>DB: BEGIN
  S->>DB: SELECT nextNumber FROM invoice_series ... FOR UPDATE
  Note over DB: concurrent issuers queue here
  S->>DB: previous hash of the series
  S->>S: totals in cents, seal: SHA-256 chained to the previous invoice + QR payload
  S->>S: PDF: own writer, vector QR, tenant logo and colour
  S->>B: put PDF
  S->>DB: invoice ISSUED with snapshots, series nextNumber + 1
  S->>DB: COMMIT
  Note over S,DB: any failure rolls back: no number is burnt
```

Issued invoices are immutable: cancelling issues a rectifying invoice in series `R`. Twelve concurrent
issues produce twelve consecutive numbers in the test suite.
