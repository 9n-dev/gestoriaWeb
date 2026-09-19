import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/modules/auth/permissions';
import { fileAccessUrl } from '@/modules/documents/service';
import { completeUpload, initiateUpload } from '@/modules/documents/uploads';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant, createUser, linkClientUser } from '@tests/setup/factories';
import { sessionUserFor } from '@tests/setup/session';
import {
  createThread,
  getThread,
  listThreads,
  sendMessage,
  setThreadStatus,
  unreadThreadCount,
} from './service';

vi.mock('@/lib/storage/multipart', () => ({
  PART_SIZE: 5 * 1024 * 1024,
  createMultipartUpload: vi.fn(async () => 'u'),
  listParts: vi.fn(async () => [{ partNumber: 1, etag: 'e', size: 10 }]),
  completeMultipartUpload: vi.fn(),
  objectSize: vi.fn(async () => 900),
  signedDownloadUrl: vi.fn(async () => 'https://s3.test/signed'),
}));
vi.mock('@/lib/queue', () => ({ enqueue: vi.fn(), QUEUES: { files: 'files' } }));

const notificationsOf = (userId: string) =>
  prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });

describe('messaging', () => {
  let tenantId: string;
  let clientId: string;
  let manager: SessionUser;
  let supervisor: SessionUser;
  let clientUser: SessionUser;

  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    await resetDb();
    tenantId = (await createTenant()).id;
    const lucia = await createUser(tenantId, 'MANAGER', { name: 'Lucía Ferrer' });
    manager = {
      id: lucia.id,
      tenantId,
      role: 'MANAGER',
      status: 'ACTIVE',
      clientIds: [],
      supportTenantIds: [],
    };
    const salva = await createUser(tenantId, 'SUPERVISOR', { name: 'Salvador Ibáñez' });
    supervisor = { ...manager, id: salva.id, role: 'SUPERVISOR' };
    clientId = (
      await createClient(tenantId, { assignedManagerId: manager.id, legalName: 'Marta Soler' })
    ).id;
    const marta = await createUser(tenantId, 'CLIENT_USER', { email: 'marta@example.com' });
    await linkClientUser(tenantId, clientId, marta.id);
    clientUser = { ...manager, id: marta.id, role: 'CLIENT_USER', clientIds: [clientId] };
  });

  it('a client opens a conversation; the assigned manager is notified and sees it unread', async () => {
    const { threadId } = await createThread(clientUser, {
      clientId,
      subject: '¿Puedo deducir el coche?',
      type: 'REQUIREMENT',
      body: 'Lo uso a medias.',
    });

    const thread = await prisma.thread.findUniqueOrThrow({ where: { id: threadId } });
    expect(thread.type).toBe('GENERAL'); // clients cannot choose the type
    expect((await notificationsOf(manager.id))[0]).toMatchObject({
      type: 'NEW_MESSAGE',
      link: `/panel/mensajes/${threadId}`,
    });
    expect(await notificationsOf(clientUser.id)).toEqual([]);

    expect(await unreadThreadCount(manager)).toBe(1);
    expect(await unreadThreadCount(clientUser)).toBe(0);
    await getThread(manager, threadId);
    expect(await unreadThreadCount(manager)).toBe(0);
    expect(
      (await prisma.client.findUniqueOrThrow({ where: { id: clientId } })).lastActivityAt,
    ).not.toBeNull();
  });

  it('the answer reaches the client by email with a reply-to that leads back to the thread', async () => {
    const { threadId } = await createThread(clientUser, {
      clientId,
      subject: 'Duda',
      body: 'Hola',
    });
    await sendMessage(manager, threadId, 'Sí, al 50 %.');

    const thread = await prisma.thread.findUniqueOrThrow({ where: { id: threadId } });
    const email = await prisma.emailLog.findFirstOrThrow({
      where: { toAddress: 'marta@example.com' },
    });
    expect(email.replyTo).toBe(`reply+${thread.replyToken}@docs.localhost`);
    expect(email.bodyText).toContain('Sí, al 50 %.');
    expect((await notificationsOf(clientUser.id))[0]).toMatchObject({
      link: `/mensajes/${threadId}`,
    });
    expect((await listThreads(clientUser))[0]).toMatchObject({
      unread: true,
      lastMessage: { authorName: 'Lucía Ferrer' },
    });
  });

  it('internal threads never reach the client: not listed, not readable, not notified, not writable', async () => {
    const { threadId } = await createThread(manager, {
      clientId,
      subject: 'Ojo con este cliente',
      type: 'INTERNAL',
      body: 'Paga tarde.',
    });
    await createThread(manager, {
      clientId,
      subject: 'Tercer trimestre',
      type: 'PERIOD',
      body: 'Faltan facturas.',
    });

    expect((await listThreads(clientUser)).map((t) => t.subject)).toEqual(['Tercer trimestre']);
    expect(await listThreads(clientUser, { type: 'INTERNAL' })).toEqual([]);
    await expect(getThread(clientUser, threadId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(sendMessage(clientUser, threadId, 'hola')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await notificationsOf(clientUser.id)).map((n) => n.title)).toEqual([
      'Nuevo mensaje: Tercer trimestre',
    ]);
    await expect(
      createThread(clientUser, { clientId, subject: 'Intento', type: 'INTERNAL', body: 'x' }),
    ).resolves.toBeTruthy();
    expect(await prisma.thread.count({ where: { type: 'INTERNAL' } })).toBe(1);
  });

  it('mentions notify colleagues in internal threads only', async () => {
    const { threadId } = await createThread(manager, {
      clientId,
      subject: 'Revisión',
      type: 'INTERNAL',
      body: '@Salvador Ibáñez ¿le echas un ojo?',
    });
    expect((await notificationsOf(supervisor.id)).map((n) => n.type)).toEqual(['MENTION']);
    expect(
      (await prisma.message.findFirstOrThrow({ where: { threadId } })).mentionedUserIds,
    ).toEqual([supervisor.id]);

    // Once taking part, plain messages reach them too; in client-facing threads "@" means nothing.
    await sendMessage(supervisor, threadId, 'Visto.');
    expect((await notificationsOf(manager.id)).map((n) => n.type)).toEqual(['NEW_MESSAGE']);
    const open = await createThread(manager, {
      clientId,
      subject: 'General',
      body: '@Salvador Ibáñez hola',
    });
    expect(await prisma.notification.count({ where: { userId: supervisor.id } })).toBe(1);
    expect(
      (await prisma.message.findFirstOrThrow({ where: { threadId: open.threadId } }))
        .mentionedUserIds,
    ).toEqual([]);
  });

  it('with no manager assigned, supervisors and admins hear the client', async () => {
    await prisma.client.update({ where: { id: clientId }, data: { assignedManagerId: null } });
    await createThread(clientUser, { clientId, subject: 'Hola', body: '¿Hay alguien?' });
    expect(await notificationsOf(supervisor.id)).toHaveLength(1);
  });

  it('managers only reach threads of their clients; closing is for staff and a new message reopens', async () => {
    const { threadId } = await createThread(clientUser, {
      clientId,
      subject: 'Duda',
      body: 'Hola',
    });
    const stranger = await sessionUserFor(tenantId, 'MANAGER');
    expect(await listThreads(stranger)).toEqual([]);
    await expect(getThread(stranger, threadId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await listThreads(supervisor)).toHaveLength(1);

    await expect(setThreadStatus(clientUser, threadId, 'CLOSED')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await setThreadStatus(manager, threadId, 'CLOSED');
    expect(await listThreads(manager, { status: 'OPEN' })).toEqual([]);
    await sendMessage(clientUser, threadId, 'Una cosa más');
    expect((await listThreads(manager, { status: 'OPEN' }))[0]!.unread).toBe(true);
  });

  it('attachments: only the author, only right after sending, downloadable by both sides once clean', async () => {
    const { threadId, messageId } = await createThread(clientUser, {
      clientId,
      subject: 'Te paso el contrato',
      body: 'Adjunto.',
    });
    const upload = {
      purpose: 'MESSAGE_ATTACHMENT' as const,
      clientId,
      messageId,
      fileName: 'contrato.pdf',
      mimeType: 'application/pdf' as const,
      sizeBytes: 900,
    };

    await expect(initiateUpload(manager, upload)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const { fileId } = await initiateUpload(clientUser, upload);
    await completeUpload(clientUser, fileId);
    await prisma.storedFile.update({ where: { id: fileId }, data: { status: 'CLEAN' } });

    const { messages } = await getThread(manager, threadId);
    expect(messages[0]!.attachments[0]!.file).toMatchObject({
      id: fileId,
      originalName: 'contrato.pdf',
    });
    await expect(fileAccessUrl(manager, fileId, { inline: true })).resolves.toContain('signed');
    await expect(fileAccessUrl(clientUser, fileId, { inline: true })).resolves.toContain('signed');
    await expect(
      fileAccessUrl(await sessionUserFor(tenantId, 'MANAGER'), fileId, { inline: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await prisma.message.update({
      where: { id: messageId },
      data: { createdAt: new Date(Date.now() - 3_600_000) },
    });
    await expect(initiateUpload(clientUser, upload)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('attachments of internal threads are out of reach for the client', async () => {
    const { messageId } = await createThread(manager, {
      clientId,
      subject: 'Interno',
      type: 'INTERNAL',
      body: 'Mira esto',
    });
    const { fileId } = await initiateUpload(manager, {
      purpose: 'MESSAGE_ATTACHMENT',
      clientId,
      messageId,
      fileName: 'nota.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 900,
    });
    await completeUpload(manager, fileId);
    await prisma.storedFile.update({ where: { id: fileId }, data: { status: 'CLEAN' } });
    await expect(fileAccessUrl(clientUser, fileId, { inline: true })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(fileAccessUrl(supervisor, fileId, { inline: true })).resolves.toContain('signed');
  });
});
