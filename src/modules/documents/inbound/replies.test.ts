import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/modules/auth/permissions';
import { createThread, replyAddress } from '@/modules/messaging/service';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant, createUser, linkClientUser } from '@tests/setup/factories';
import type { InboundEmail } from './provider';
import { receiveInboundEmail, stripQuotedReply } from './service';

vi.mock('@/lib/storage/objects', () => ({ putObject: vi.fn() }));
vi.mock('@/lib/queue', () => ({ enqueue: vi.fn(), QUEUES: { files: 'files' } }));

describe('stripQuotedReply', () => {
  it('keeps the answer and drops the quoted conversation', () => {
    expect(
      stripQuotedReply(
        'Perfecto, gracias.\n\nEl lun, 5 oct 2026 a las 9:12, Gestoría Pérez escribió:\n> Hola Marta',
      ),
    ).toBe('Perfecto, gracias.');
    expect(
      stripQuotedReply('Ok\r\n\r\nOn Mon, Oct 5, 2026 at 9:12 AM Gestoría wrote:\r\n> Hi'),
    ).toBe('Ok');
    expect(stripQuotedReply('Vale\n-----Mensaje original-----\nDe: x@y.es')).toBe('Vale');
    expect(stripQuotedReply('Sin citas')).toBe('Sin citas');
  });
});

describe('replies by email', () => {
  let tenantId: string;
  let clientId: string;
  let manager: SessionUser;
  let n = 0;
  const email = (
    to: string,
    from: string,
    overrides: Partial<InboundEmail> = {},
  ): InboundEmail => ({
    id: `reply-${++n}`,
    from,
    to: [to],
    subject: 'Re: Duda',
    text: 'Gracias, entendido.\n\n> texto anterior',
    attachments: [],
    ...overrides,
  });

  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    await resetDb();
    tenantId = (await createTenant()).id;
    const lucia = await createUser(tenantId, 'MANAGER', { email: 'lucia@gestoria.es' });
    manager = {
      id: lucia.id,
      tenantId,
      role: 'MANAGER',
      status: 'ACTIVE',
      clientIds: [],
      supportTenantIds: [],
    };
    clientId = (await createClient(tenantId, { assignedManagerId: manager.id })).id;
    const marta = await createUser(tenantId, 'CLIENT_USER', { email: 'marta@example.com' });
    await linkClientUser(tenantId, clientId, marta.id);
  });

  const threadAddress = async (type: 'GENERAL' | 'INTERNAL') => {
    const { threadId } = await createThread(manager, {
      clientId,
      subject: 'Duda',
      type,
      body: 'Hola',
    });
    const thread = await prisma.thread.findUniqueOrThrow({ where: { id: threadId } });
    return { threadId, address: replyAddress(thread.replyToken) };
  };

  it('a reply from the client enters the thread without the quoted text and notifies the manager', async () => {
    const { threadId, address } = await threadAddress('GENERAL');
    const pdf = new Uint8Array(6000).fill(32);
    pdf.set(new TextEncoder().encode('%PDF-1.7'));

    const result = await receiveInboundEmail(
      'RESEND',
      email(address, 'Marta <marta@example.com>', {
        attachments: [{ filename: 'contrato.pdf', contentType: '', load: async () => pdf }],
      }),
    );

    expect(result).toEqual({ status: 'reply', documents: 1, messages: 1 });
    const message = await prisma.message.findFirstOrThrow({
      where: { threadId, source: 'EMAIL' },
      include: { attachments: true },
    });
    expect(message).toMatchObject({
      body: 'Gracias, entendido.',
      senderEmail: 'marta@example.com',
    });
    expect(message.attachments).toHaveLength(1);
    expect(
      await prisma.notification.count({ where: { userId: manager.id, type: 'NEW_MESSAGE' } }),
    ).toBe(1);
    expect(await prisma.document.count()).toBe(0); // a reply is a message, not a document
  });

  it('staff can answer by email too', async () => {
    const { threadId, address } = await threadAddress('GENERAL');
    await receiveInboundEmail(
      'RESEND',
      email(address, 'lucia@gestoria.es', { text: 'Te llamo mañana.' }),
    );
    expect(
      await prisma.message.count({ where: { threadId, authorId: manager.id, source: 'EMAIL' } }),
    ).toBe(1);
  });

  it('ignores strangers, users of other tenants and clients holding the token of an internal thread', async () => {
    const general = await threadAddress('GENERAL');
    const internal = await threadAddress('INTERNAL');
    await createUser((await createTenant()).id, 'TENANT_ADMIN', { email: 'otro@tenant.es' });

    for (const [to, from] of [
      [general.address, 'desconocido@example.com'],
      [general.address, 'otro@tenant.es'],
      [internal.address, 'marta@example.com'],
      ['reply+nonexistent@docs.localhost', 'marta@example.com'],
    ] as const) {
      expect(await receiveInboundEmail('RESEND', email(to, from)), `${from} → ${to}`).toMatchObject(
        { status: 'unknown-sender', messages: 0 },
      );
    }
    expect(await prisma.message.count({ where: { source: 'EMAIL' } })).toBe(0);
  });

  it('is idempotent', async () => {
    const { address } = await threadAddress('GENERAL');
    const message = email(address, 'marta@example.com');
    await receiveInboundEmail('RESEND', message);
    expect(await receiveInboundEmail('RESEND', message)).toMatchObject({ status: 'duplicate' });
    expect(await prisma.message.count({ where: { source: 'EMAIL' } })).toBe(1);
  });
});
