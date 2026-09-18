import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant, createUser, linkClientUser } from '@tests/setup/factories';
import { fakeInboundProvider } from './fake';
import type { InboundEmail } from './provider';
import { verifySvixSignature } from './resend';
import { inboundAddressFor, receiveInboundEmail } from './service';

const storage = vi.hoisted(() => ({ putObject: vi.fn() }));
const queue = vi.hoisted(() => ({ enqueue: vi.fn(), QUEUES: { files: 'files' } }));
vi.mock('@/lib/storage/objects', () => storage);
vi.mock('@/lib/queue', () => queue);

const pdf = (size = 6000) => {
  const bytes = new Uint8Array(size).fill(32);
  bytes.set(new TextEncoder().encode('%PDF-1.7'));
  return bytes;
};
const attachment = (filename: string, bytes: Uint8Array) => ({
  filename,
  contentType: 'application/octet-stream',
  load: async () => bytes,
});

describe('inbound email', () => {
  let tenantId: string;
  let clientId: string;
  let to: string;
  let n = 0;

  const email = (overrides: Partial<InboundEmail> = {}): InboundEmail => ({
    id: `msg-${++n}`,
    from: 'Marta Soler <marta@example.com>',
    to: [to],
    subject: 'Facturas de agosto',
    text: 'Te las adjunto.',
    attachments: [],
    ...overrides,
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDb();
    tenantId = (await createTenant({ slug: 'gestoria-perez' })).id;
    clientId = (await createClient(tenantId, { inboundEmailCode: 'k7m2p9xq' })).id;
    to = inboundAddressFor('gestoria-perez', 'k7m2p9xq');
  });

  it('builds the per-client address', () => {
    expect(to).toBe('gestoria-perez-k7m2p9xq@docs.localhost');
  });

  it('turns each usable attachment into a document of the right client and queues it', async () => {
    const result = await receiveInboundEmail(
      'RESEND',
      email({ attachments: [attachment('f1.pdf', pdf()), attachment('f2.pdf', pdf(7000))] }),
    );

    expect(result).toEqual({ status: 'processed', documents: 2, messages: 0 });
    const documents = await prisma.document.findMany({ include: { file: true } });
    expect(documents).toHaveLength(2);
    expect(
      documents.every(
        (d) => d.clientId === clientId && d.tenantId === tenantId && d.source === 'EMAIL',
      ),
    ).toBe(true);
    expect(
      documents.every((d) => d.file.status === 'UPLOADED' && d.file.mimeType === 'application/pdf'),
    ).toBe(true);
    expect(storage.putObject).toHaveBeenCalledTimes(2);
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
  });

  it('attributes the documents to the sender when it is a known user', async () => {
    const user = await createUser(tenantId, 'CLIENT_USER', { email: 'marta@example.com' });
    await linkClientUser(tenantId, clientId, user.id);
    await receiveInboundEmail('RESEND', email({ attachments: [attachment('f.pdf', pdf())] }));
    expect((await prisma.document.findFirstOrThrow()).uploadedById).toBe(user.id);
  });

  it('skips signature logos, oversized files and unsupported formats', async () => {
    const exe = new Uint8Array(8000).fill(77);
    const result = await receiveInboundEmail(
      'RESEND',
      email({
        attachments: [
          attachment('logo.pdf', pdf(900)),
          attachment('enorme.pdf', pdf(21 * 1024 * 1024)),
          attachment('factura.pdf.exe', exe),
        ],
      }),
    );
    expect(result).toMatchObject({ documents: 0, messages: 1 });
    expect(await prisma.document.count()).toBe(0);
  });

  it('an email without attachments becomes a message in the general thread', async () => {
    await receiveInboundEmail(
      'RESEND',
      email({ subject: '¿Cuándo vence el IVA?', text: 'Gracias' }),
    );
    await receiveInboundEmail('RESEND', email({ subject: 'Otra duda' }));

    const threads = await prisma.thread.findMany({
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ clientId, type: 'GENERAL', subject: 'Correos recibidos' });
    expect(threads[0]!.messages[0]).toMatchObject({
      source: 'EMAIL',
      senderEmail: 'marta@example.com',
    });
    expect(threads[0]!.messages[0]!.body).toContain('¿Cuándo vence el IVA?');
    expect(threads[0]!.messages).toHaveLength(2);
  });

  it('is idempotent per provider message id', async () => {
    const message = email({ attachments: [attachment('f.pdf', pdf())] });
    await receiveInboundEmail('RESEND', message);
    expect(await receiveInboundEmail('RESEND', message)).toMatchObject({ status: 'duplicate' });
    expect(await prisma.document.count()).toBe(1);
  });

  it('ignores unknown addresses, wrong tenant slugs and suspended tenants', async () => {
    const attachments = [attachment('f.pdf', pdf())];
    for (const address of [
      'nadie-zzzz@docs.localhost',
      'otra-k7m2p9xq@docs.localhost',
      'k7m2p9xq@docs.localhost',
    ]) {
      expect(
        await receiveInboundEmail('RESEND', email({ to: [address], attachments })),
      ).toMatchObject({ status: 'unknown-address' });
    }
    await prisma.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });
    expect(await receiveInboundEmail('RESEND', email({ attachments }))).toMatchObject({
      status: 'unknown-address',
    });
    expect(await prisma.document.count()).toBe(0);
  });

  it('the development provider decodes inline base64 attachments', async () => {
    const parsed = await fakeInboundProvider.parse(
      JSON.stringify({
        id: '1',
        from: 'a@b.es',
        to: [to],
        attachments: [{ filename: 'f.pdf', contentBase64: Buffer.from(pdf()).toString('base64') }],
      }),
      new Headers(),
    );
    expect((await parsed.attachments[0]!.load()).length).toBe(6000);
  });
});

describe('verifySvixSignature', () => {
  const secret = `whsec_${Buffer.from('super-secret-key').toString('base64')}`;
  const body = '{"type":"email.received"}';
  const now = 1_790_000_000_000;
  const sign = (id: string, timestamp: number, payload = body) =>
    `v1,${createHmac('sha256', Buffer.from('super-secret-key')).update(`${id}.${timestamp}.${payload}`).digest('base64')}`;
  const headers = (signature: string, timestamp = now / 1000) =>
    new Headers({
      'svix-id': 'msg_1',
      'svix-timestamp': String(timestamp),
      'svix-signature': signature,
    });

  it('accepts a valid signature, also among several', () => {
    expect(() =>
      verifySvixSignature(secret, body, headers(sign('msg_1', now / 1000)), now),
    ).not.toThrow();
    expect(() =>
      verifySvixSignature(secret, body, headers(`v1,AAAA ${sign('msg_1', now / 1000)}`), now),
    ).not.toThrow();
  });

  it('rejects tampered bodies, wrong secrets, missing headers and old timestamps', () => {
    const valid = sign('msg_1', now / 1000);
    expect(() => verifySvixSignature(secret, `${body} `, headers(valid), now)).toThrow();
    expect(() => verifySvixSignature('whsec_b3Rybw==', body, headers(valid), now)).toThrow();
    expect(() => verifySvixSignature(secret, body, new Headers(), now)).toThrow();
    const old = now / 1000 - 3600;
    expect(() =>
      verifySvixSignature(secret, body, headers(sign('msg_1', old), old), now),
    ).toThrow();
  });
});
