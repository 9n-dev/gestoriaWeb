import type { Prisma, ThreadStatus, ThreadType } from '@prisma/client';
import { z } from 'zod';
import { env } from '@/env';
import { prisma, tenantDb } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { recordAudit } from '@/modules/audit/service';
import {
  assertCan,
  can,
  requireTenantId,
  scopeFor,
  type Resource,
  type SessionUser,
} from '@/modules/auth/permissions';
import { loadForStaff, resourceOf } from '@/modules/clients/service';
import { notifyUsers } from './notifications';

const threadSelect = {
  id: true,
  tenantId: true,
  clientId: true,
  subject: true,
  type: true,
  status: true,
  replyToken: true,
  lastMessageAt: true,
  createdAt: true,
  period: { select: { year: true, type: true, ordinal: true } },
  client: { select: { id: true, legalName: true, assignedManagerId: true, status: true } },
} satisfies Prisma.ThreadSelect;

type ThreadRow = Prisma.ThreadGetPayload<{ select: typeof threadSelect }>;

export const threadResource = (thread: ThreadRow): Resource => ({
  tenantId: thread.tenantId,
  clientId: thread.clientId,
  assignedManagerId: thread.client.assignedManagerId,
  clientStatus: thread.client.status,
  internal: thread.type === 'INTERNAL',
});

const notFound = () => new AppError('NOT_FOUND', 'No encontramos esa conversación.');
const isClientSide = (user: SessionUser) => scopeFor(user, 'thread.read') === 'own';

/** Reply-To of every thread email: answers come back through the inbound webhook (§6.8). */
export const replyAddress = (replyToken: string) =>
  `reply+${replyToken}@${env.INBOUND_EMAIL_DOMAIN}`;

async function loadThread(user: SessionUser, id: string): Promise<ThreadRow> {
  const thread = await tenantDb(requireTenantId(user)).thread.findFirst({
    where: { id },
    select: threadSelect,
  });
  // can() refuses internal resources to client users, whatever the action.
  if (!thread || !can(user, 'thread.read', threadResource(thread))) throw notFound();
  return thread;
}

// ─────────────────────────── Reading ───────────────────────────

export const threadFiltersSchema = z.object({
  clientId: z.string().optional(),
  status: z.enum(['OPEN', 'CLOSED']).optional(),
  type: z.enum(['PERIOD', 'REQUIREMENT', 'GENERAL', 'INTERNAL']).optional(),
  unreadOnly: z.boolean().default(false),
});
export type ThreadFilters = z.input<typeof threadFiltersSchema>;

export async function listThreads(user: SessionUser, filters: ThreadFilters = {}) {
  assertCan(user, 'thread.read');
  const { clientId, status, type, unreadOnly } = threadFiltersSchema.parse(filters);
  const scope = scopeFor(user, 'thread.read');

  const threads = await tenantDb(requireTenantId(user)).thread.findMany({
    where: {
      clientId,
      status,
      type,
      // Internal threads do not exist for clients, whatever filter they send.
      AND: isClientSide(user) ? [{ type: { not: 'INTERNAL' } }] : [],
      client: {
        deletedAt: null,
        ...(scope === 'own'
          ? { id: { in: user.clientIds } }
          : scope === 'assigned'
            ? { assignedManagerId: user.id }
            : {}),
      },
    },
    select: {
      ...threadSelect,
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { body: true, author: { select: { name: true } }, senderEmail: true },
      },
      reads: { where: { userId: user.id }, select: { lastReadAt: true } },
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 200,
  });

  return threads
    .map(({ messages, reads, ...thread }) => ({
      ...thread,
      unread: !reads[0] || reads[0].lastReadAt < thread.lastMessageAt,
      lastMessage: messages[0]
        ? {
            preview: messages[0].body.slice(0, 140),
            authorName: messages[0].author?.name ?? messages[0].senderEmail ?? 'Sistema',
          }
        : null,
    }))
    .filter((thread) => !unreadOnly || thread.unread);
}

/** The conversation, oldest message first. Opening it marks it as read for this user. */
export async function getThread(user: SessionUser, id: string) {
  const thread = await loadThread(user, id);
  const db = tenantDb(thread.tenantId);
  const messages = await db.message.findMany({
    where: { threadId: id },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      body: true,
      source: true,
      createdAt: true,
      senderEmail: true,
      authorId: true,
      author: { select: { name: true, role: true } },
      attachments: {
        select: {
          file: { select: { id: true, originalName: true, status: true, deletedAt: true } },
        },
      },
    },
  });
  await db.threadRead.upsert({
    where: { threadId_userId: { threadId: id, userId: user.id } },
    create: { tenantId: thread.tenantId, threadId: id, userId: user.id },
    update: { lastReadAt: new Date() },
  });
  const mine = await db.threadRead.findUnique({
    where: { threadId_userId: { threadId: id, userId: user.id } },
    select: { muted: true },
  });
  return { thread, messages, muted: mine?.muted ?? false };
}

/**
 * "Silenciar": a member of staff stops getting notifications for the new messages of one thread.
 * Mentions still arrive, and a thread is never silent for everybody (see `audience`).
 */
export async function setThreadMuted(user: SessionUser, id: string, muted: boolean): Promise<void> {
  const thread = await loadThread(user, id);
  assertCan(user, 'area.staff');
  await tenantDb(thread.tenantId).threadRead.upsert({
    where: { threadId_userId: { threadId: id, userId: user.id } },
    create: { tenantId: thread.tenantId, threadId: id, userId: user.id, muted },
    update: { muted },
  });
}

export async function unreadThreadCount(user: SessionUser): Promise<number> {
  return (await listThreads(user, { unreadOnly: true, status: 'OPEN' })).length;
}

// ─────────────────────────── Writing ───────────────────────────

const bodySchema = z.string().trim().min(1, 'Escribe un mensaje.').max(10_000);

const newThreadSchema = z.object({
  clientId: z.string().min(1),
  subject: z.string().trim().min(3, 'Indica el asunto.').max(200),
  type: z.enum(['PERIOD', 'REQUIREMENT', 'GENERAL', 'INTERNAL']).default('GENERAL'),
  period: z
    .object({
      year: z.number().int(),
      type: z.enum(['MONTH', 'QUARTER', 'YEAR']),
      ordinal: z.number().int(),
    })
    .nullish(),
  body: bodySchema,
});

export async function createThread(
  user: SessionUser,
  input: z.input<typeof newThreadSchema>,
): Promise<{ threadId: string; messageId: string }> {
  const data = newThreadSchema.parse(input);
  const client = await loadForStaff(user, data.clientId);
  // Clients open general conversations; the gestoría decides what is a requirement or a period thread.
  const type: ThreadType = isClientSide(user) ? 'GENERAL' : data.type;
  assertCan(user, type === 'INTERNAL' ? 'message.sendInternal' : 'thread.create', {
    ...resourceOf(client),
    internal: type === 'INTERNAL',
  });

  const period = data.period
    ? await prisma.period.upsert({
        where: { year_type_ordinal: data.period },
        create: data.period,
        update: {},
      })
    : null;
  const thread = await tenantDb(client.tenantId).thread.create({
    data: {
      tenantId: client.tenantId,
      clientId: client.id,
      subject: data.subject,
      type,
      periodId: period?.id,
      createdById: user.id,
    },
  });
  await recordAudit({
    tenantId: client.tenantId,
    actor: user,
    action: 'thread.create',
    entity: 'Thread',
    entityId: thread.id,
    diff: { type, clientId: client.id },
  });
  const message = await sendMessage(user, thread.id, data.body);
  return { threadId: thread.id, messageId: message.id };
}

/** Staff whose name appears as "@Name Surname" in the text. Only meaningful in internal threads. */
async function mentionedStaff(tenantId: string, body: string): Promise<string[]> {
  if (!body.includes('@')) return [];
  const staff = await tenantDb(tenantId).user.findMany({
    where: { role: { in: ['MANAGER', 'SUPERVISOR', 'TENANT_ADMIN'] }, status: 'ACTIVE' },
    select: { id: true, name: true },
  });
  const text = body.toLocaleLowerCase('es');
  return staff
    .filter((person) => text.includes(`@${person.name.toLocaleLowerCase('es')}`))
    .map((person) => person.id);
}

/** Who should hear about a new message: the other side of the conversation, never the author. */
async function audience(
  thread: ThreadRow,
  authorId: string,
  authorIsClient: boolean,
  mentioned: string[],
): Promise<string[]> {
  const db = tenantDb(thread.tenantId);
  if (thread.type !== 'INTERNAL' && !authorIsClient) {
    const links = await db.clientUser.findMany({
      where: { clientId: thread.clientId },
      select: { userId: true },
    });
    return links.map((link) => link.userId);
  }
  // Towards the gestoría: the assigned manager plus staff already taking part; leads when nobody is assigned.
  const participants = await db.message.findMany({
    where: { threadId: thread.id, author: { role: { not: 'CLIENT_USER' } } },
    distinct: ['authorId'],
    select: { authorId: true },
  });
  const staff = new Set(
    [thread.client.assignedManagerId, ...participants.map((p) => p.authorId)].filter(
      (id): id is string => Boolean(id),
    ),
  );
  if (staff.size === 0) {
    const leads = await db.user.findMany({
      where: { role: { in: ['SUPERVISOR', 'TENANT_ADMIN'] }, status: 'ACTIVE' },
      select: { id: true },
    });
    leads.forEach((lead) => staff.add(lead.id));
  }
  const recipients = [...staff].filter((id) => id !== authorId && !mentioned.includes(id));
  const muted = await db.threadRead.findMany({
    where: { threadId: thread.id, muted: true, userId: { in: recipients } },
    select: { userId: true },
  });
  const listening = recipients.filter((id) => !muted.some((row) => row.userId === id));
  // If everybody muted it, the mute loses: a client must never write into the void.
  return listening.length > 0 ? listening : recipients;
}

export async function sendMessage(
  user: SessionUser,
  threadId: string,
  rawBody: string,
  options: { source?: 'WEB' | 'EMAIL'; senderEmail?: string } = {},
): Promise<{ id: string }> {
  const thread = await loadThread(user, threadId);
  const internal = thread.type === 'INTERNAL';
  assertCan(user, internal ? 'message.sendInternal' : 'message.send', threadResource(thread));
  const body = bodySchema.parse(rawBody);
  const db = tenantDb(thread.tenantId);

  const mentioned = internal
    ? (await mentionedStaff(thread.tenantId, body)).filter((id) => id !== user.id)
    : [];
  const message = await db.message.create({
    data: {
      tenantId: thread.tenantId,
      threadId,
      authorId: user.id,
      body,
      source: options.source ?? 'WEB',
      senderEmail: options.senderEmail,
      mentionedUserIds: mentioned,
    },
    select: { id: true },
  });
  const now = new Date();
  await db.thread.update({ where: { id: threadId }, data: { lastMessageAt: now, status: 'OPEN' } });
  await db.threadRead.upsert({
    where: { threadId_userId: { threadId, userId: user.id } },
    create: { tenantId: thread.tenantId, threadId, userId: user.id, lastReadAt: now },
    update: { lastReadAt: now },
  });
  const authorIsClient = isClientSide(user);
  if (authorIsClient)
    await db.client.update({ where: { id: thread.clientId }, data: { lastActivityAt: now } });

  const author = await db.user.findFirst({ where: { id: user.id }, select: { name: true } });
  const staffLink = `/panel/mensajes/${threadId}`;
  const email = {
    subject: `${thread.subject} (${thread.client.legalName})`,
    text: `${author?.name ?? 'Alguien'} ha escrito:\n\n${body}\n\nPuedes contestar respondiendo a este correo.`,
    templateKey: 'message.new',
    replyTo: replyAddress(thread.replyToken),
  };
  const recipients = await audience(thread, user.id, authorIsClient, mentioned);
  const toClient = !internal && !authorIsClient;
  await notifyUsers(thread.tenantId, recipients, {
    type: 'NEW_MESSAGE',
    title: `Nuevo mensaje: ${thread.subject}`,
    body: `${author?.name ?? ''}: ${body.slice(0, 200)}`,
    link: toClient ? `/mensajes/${threadId}` : staffLink,
    email: toClient ? { ...email, subject: thread.subject } : email,
  });
  await notifyUsers(thread.tenantId, mentioned, {
    type: 'MENTION',
    title: `${author?.name ?? 'Un compañero'} te ha mencionado en «${thread.subject}»`,
    body: body.slice(0, 200),
    link: staffLink,
    email,
  });
  return message;
}

export async function setThreadStatus(
  user: SessionUser,
  id: string,
  status: ThreadStatus,
): Promise<void> {
  const thread = await loadThread(user, id);
  assertCan(user, 'thread.close', threadResource(thread));
  await tenantDb(thread.tenantId).thread.update({ where: { id }, data: { status } });
  await recordAudit({
    tenantId: thread.tenantId,
    actor: user,
    action: status === 'CLOSED' ? 'thread.close' : 'thread.reopen',
    entity: 'Thread',
    entityId: id,
  });
}

/** For uploads: the author may attach files to their own message for a short while after sending it. */
export async function attachableMessage(user: SessionUser, messageId: string) {
  const message = await tenantDb(requireTenantId(user)).message.findFirst({
    where: {
      id: messageId,
      authorId: user.id,
      createdAt: { gt: new Date(Date.now() - 15 * 60_000) },
    },
    select: { id: true, threadId: true },
  });
  if (!message) throw new AppError('NOT_FOUND', 'Ya no se pueden añadir adjuntos a ese mensaje.');
  const thread = await loadThread(user, message.threadId);
  assertCan(
    user,
    thread.type === 'INTERNAL' ? 'message.sendInternal' : 'message.send',
    threadResource(thread),
  );
  return { messageId: message.id, tenantId: thread.tenantId, clientId: thread.clientId };
}

/** For downloads: the thread behind an attachment, if the user may read it. */
export const readableThread = loadThread;
