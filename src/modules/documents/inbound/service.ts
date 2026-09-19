import { randomUUID } from 'node:crypto';
import { Prisma, type WebhookProvider } from '@prisma/client';
import { prisma, tenantDb } from '@/lib/db';
import { MAX_FILE_BYTES, sniffDocumentType } from '@/lib/files/sniff';
import { enqueue, QUEUES } from '@/lib/queue';
import { putObject } from '@/lib/storage/objects';
import { env } from '@/env';
import { recordAudit } from '@/modules/audit/service';
import { AppError } from '@/lib/errors';
import { sendMessage } from '@/modules/messaging/service';
import type { InboundEmail } from './provider';

export type InboundResult = {
  status: 'duplicate' | 'unknown-address' | 'unknown-sender' | 'reply' | 'processed';
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

  const replyToken = email.to
    .map((recipient) => /^reply\+([a-z0-9]+)@/.exec(addressOf(recipient))?.[1])
    .find(Boolean);
  if (replyToken) {
    const reply = await receiveReply(replyToken, email);
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date(), error: reply.status === 'reply' ? null : reply.status },
    });
    return reply;
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

/** Everything from the first quoted line on is the previous conversation, not the answer. */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const cut = lines.findIndex(
    (line) =>
      /^\s*>/.test(line) ||
      /^\s*El .{5,200} escribió:\s*$/i.test(line) ||
      /^\s*On .{5,200} wrote:\s*$/i.test(line) ||
      /^\s*-{2,}\s*(Mensaje original|Original Message)/i.test(line) ||
      /^\s*(De|From):\s.+@/i.test(line),
  );
  return (cut === -1 ? lines : lines.slice(0, cut)).join('\n').trim();
}

/**
 * Reply to a thread notification (§6.8). Accepted only from an active user of the tenant who can
 * read that thread: the same `sendMessage` permission path as the web, so a client can never
 * write into an internal thread even with its token.
 */
async function receiveReply(replyToken: string, email: InboundEmail): Promise<InboundResult> {
  const result: InboundResult = { status: 'reply', documents: 0, messages: 0 };
  const thread = await prisma.thread.findFirst({
    where: { replyToken, tenant: { status: 'ACTIVE' }, client: { deletedAt: null } },
    select: { id: true, tenantId: true, clientId: true },
  });
  const from = addressOf(email.from);
  const sender = thread
    ? await tenantDb(thread.tenantId).user.findFirst({
        where: { email: from, status: 'ACTIVE' },
        include: { clientLinks: { select: { clientId: true } } },
      })
    : null;
  if (!thread || !sender) return { ...result, status: 'unknown-sender' };

  let messageId: string;
  try {
    const message = await sendMessage(
      {
        id: sender.id,
        tenantId: thread.tenantId,
        role: sender.role,
        status: sender.status,
        clientIds: sender.clientLinks.map((link) => link.clientId),
        supportTenantIds: [],
      },
      thread.id,
      stripQuotedReply(email.text) || '(mensaje sin texto)',
      { source: 'EMAIL', senderEmail: from },
    );
    messageId = message.id;
  } catch (error) {
    if (error instanceof AppError) return { ...result, status: 'unknown-sender' };
    throw error;
  }
  result.messages = 1;

  const db = tenantDb(thread.tenantId);
  for (const attachment of email.attachments) {
    const bytes = await attachment.load();
    const type = sniffDocumentType(bytes);
    if (bytes.length < MIN_ATTACHMENT_BYTES || bytes.length > MAX_FILE_BYTES || !type) continue;
    const storageKey = `${thread.tenantId}/clients/${thread.clientId}/${randomUUID()}`;
    await putObject(storageKey, bytes, type.mime);
    const file = await db.storedFile.create({
      data: {
        tenantId: thread.tenantId,
        kind: 'MESSAGE_ATTACHMENT',
        status: 'UPLOADED',
        storageKey,
        originalName: attachment.filename.slice(0, 200),
        mimeType: type.mime,
        sizeBytes: bytes.length,
      },
    });
    await db.messageAttachment.create({
      data: { tenantId: thread.tenantId, messageId, fileId: file.id },
    });
    await enqueue(QUEUES.files, 'process', { tenantId: thread.tenantId, fileId: file.id }, file.id);
    result.documents++;
  }
  return result;
}
