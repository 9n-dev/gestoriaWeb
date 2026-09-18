import { randomUUID } from 'node:crypto';
import { Prisma, type WebhookProvider } from '@prisma/client';
import { prisma, tenantDb } from '@/lib/db';
import { MAX_FILE_BYTES, sniffDocumentType } from '@/lib/files/sniff';
import { enqueue, QUEUES } from '@/lib/queue';
import { putObject } from '@/lib/storage/objects';
import { env } from '@/env';
import { recordAudit } from '@/modules/audit/service';
import type { InboundEmail } from './provider';

export type InboundResult = {
  status: 'duplicate' | 'unknown-address' | 'processed';
  documents: number;
  messages: number;
};

// ponytail: attachments under 5 KB are treated as signature logos and icons, and skipped.
// Upgrade path: honour Content-Disposition/Content-ID once the provider exposes them.
const MIN_ATTACHMENT_BYTES = 5 * 1024;
const GENERAL_THREAD_SUBJECT = 'Correos recibidos';

const addressOf = (value: string) => (/<([^>]+)>/.exec(value)?.[1] ?? value).trim().toLowerCase();

export const inboundAddressFor = (tenantSlug: string, inboundEmailCode: string) =>
  `${tenantSlug}-${inboundEmailCode}@${env.INBOUND_EMAIL_DOMAIN}`;

/** Personal inbound address of each client the user can see (shown in the portal and the client file). */
export async function listInboundAddresses(
  tenant: { id: string; slug: string },
  clientIds: string[],
) {
  const clients = await tenantDb(tenant.id).client.findMany({
    where: { id: { in: clientIds }, deletedAt: null },
    select: { id: true, legalName: true, inboundEmailCode: true },
    orderBy: { legalName: 'asc' },
  });
  return clients.map((client) => ({
    clientId: client.id,
    legalName: client.legalName,
    address: inboundAddressFor(tenant.slug, client.inboundEmailCode),
  }));
}

/** `<tenant-slug>-<code>@…` → client. Slugs may contain dashes, so every split point is tried. */
async function findClient(recipients: string[]) {
  const locals = recipients.map((recipient) => addressOf(recipient).split('@')[0] ?? '');
  const codes = locals.flatMap((local) =>
    [...local.matchAll(/-/g)].map((dash) => local.slice(dash.index + 1)),
  );
  if (codes.length === 0) return null;
  const candidates = await prisma.client.findMany({
    where: { inboundEmailCode: { in: codes }, deletedAt: null, tenant: { status: 'ACTIVE' } },
    select: {
      id: true,
      tenantId: true,
      inboundEmailCode: true,
      tenant: { select: { slug: true } },
    },
  });
  return candidates.find((c) => locals.includes(`${c.tenant.slug}-${c.inboundEmailCode}`)) ?? null;
}

/**
 * One inbound email → documents (one per usable attachment) or, without attachments, a message in
 * the client's general thread (§6.3). Idempotent per provider message id.
 */
export async function receiveInboundEmail(
  provider: WebhookProvider,
  email: InboundEmail,
): Promise<InboundResult> {
  const result: InboundResult = { status: 'processed', documents: 0, messages: 0 };
  let event;
  try {
    event = await prisma.webhookEvent.create({
      data: {
        provider,
        externalId: email.id,
        eventType: 'email.received',
        payload: {
          from: email.from,
          to: email.to,
          subject: email.subject,
          attachments: email.attachments.length,
        },
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ...result, status: 'duplicate' };
    }
    throw error;
  }

  const client = await findClient(email.to);
  if (!client) {
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date(), error: 'unknown address' },
    });
    return { ...result, status: 'unknown-address' };
  }

  const { tenantId } = client;
  const db = tenantDb(tenantId);
  const from = addressOf(email.from);
  const sender = await db.user.findFirst({
    where: { email: from, status: 'ACTIVE' },
    select: { id: true },
  });

  for (const attachment of email.attachments) {
    const bytes = await attachment.load();
    if (
      bytes.length < MIN_ATTACHMENT_BYTES ||
      bytes.length > MAX_FILE_BYTES ||
      !sniffDocumentType(bytes)
    )
      continue;

    const type = sniffDocumentType(bytes)!;
    const storageKey = `${tenantId}/clients/${client.id}/${randomUUID()}`;
    await putObject(storageKey, bytes, type.mime);
    const file = await db.storedFile.create({
      data: {
        tenantId,
        kind: 'DOCUMENT',
        status: 'UPLOADED',
        storageKey,
        originalName: attachment.filename.slice(0, 200),
        mimeType: type.mime,
        sizeBytes: bytes.length,
      },
    });
    await db.document.create({
      data: {
        tenantId,
        clientId: client.id,
        fileId: file.id,
        source: 'EMAIL',
        uploadedById: sender?.id,
      },
    });
    await enqueue(QUEUES.files, 'process', { tenantId, fileId: file.id }, file.id);
    result.documents++;
  }

  if (result.documents === 0) {
    const thread =
      (await db.thread.findFirst({
        where: { clientId: client.id, type: 'GENERAL', subject: GENERAL_THREAD_SUBJECT },
      })) ??
      (await db.thread.create({
        data: { tenantId, clientId: client.id, type: 'GENERAL', subject: GENERAL_THREAD_SUBJECT },
      }));
    await db.message.create({
      data: {
        tenantId,
        threadId: thread.id,
        authorId: sender?.id,
        senderEmail: from,
        source: 'EMAIL',
        body:
          [email.subject, email.text].filter(Boolean).join('\n\n').slice(0, 20_000) ||
          '(mensaje vacío)',
      },
    });
    await db.thread.update({
      where: { id: thread.id },
      data: { lastMessageAt: new Date(), status: 'OPEN' },
    });
    result.messages = 1;
  }

  await db.client.update({ where: { id: client.id }, data: { lastActivityAt: new Date() } });
  await recordAudit({
    tenantId,
    actor: sender ? { id: sender.id, role: 'CLIENT_USER' } : null,
    action: 'inbound.email',
    entity: 'Client',
    entityId: client.id,
    diff: { from, documents: result.documents, messages: result.messages },
  });
  await prisma.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
  return result;
}
