import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/modules/auth/permissions';
import { fileAccessUrl } from '@/modules/documents/service';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant, createUser, linkClientUser } from '@tests/setup/factories';
import { sessionUserFor } from '@tests/setup/session';
import { getPaymentProvider, handlePaymentWebhook, startPayment } from './payments';
import {
  cancelInvoice,
  createInvoice,
  generateMonthlyInvoices,
  issueInvoice,
  issueInvoiceById,
  listInvoices,
  markPaid,
  runDunning,
  saveFee,
} from './service';

const putObject = vi.hoisted(() => vi.fn());
vi.mock('@/lib/storage/objects', () => ({ putObject }));
vi.mock('@/lib/storage/multipart', () => ({
  signedDownloadUrl: vi.fn(async () => 'https://s3.test/signed'),
}));

const LEGAL = {
  legalName: 'Pérez & Asociados, S.L.',
  taxId: 'B12345674',
  addressLine: 'C/ Colón, 12',
  postalCode: '46004',
  city: 'Valencia',
  province: 'Valencia',
};
const line = (unitPrice: number) => ({
  description: 'Cuota mensual',
  unitPrice,
  quantity: 1,
  vatRate: 21,
  irpfRate: 0,
});

describe('billing', () => {
  let tenantId: string;
  let admin: SessionUser;
  let clientId: string;
  let clientUser: SessionUser;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    await resetDb();
    tenantId = (await createTenant({ ...LEGAL, slug: 'perez' })).id;
    admin = await sessionUserFor(tenantId, 'TENANT_ADMIN');
    clientId = (
      await createClient(tenantId, {
        legalName: 'Marta Soler',
        addressLine: 'C/ Mayor, 1',
        city: 'Valencia',
      })
    ).id;
    const marta = await createUser(tenantId, 'CLIENT_USER', { email: 'marta@example.com' });
    await linkClientUser(tenantId, clientId, marta.id);
    clientUser = { ...admin, id: marta.id, role: 'CLIENT_USER', clientIds: [clientId] };
  });

  describe('numbering (§8.5)', () => {
    it('issues concurrent invoices without gaps or duplicates, and chains their hashes', async () => {
      const drafts = await Promise.all(
        Array.from({ length: 12 }, () => createInvoice(admin, { clientId, lines: [line(90)] })),
      );
      const issued = await Promise.all(
        drafts.map((id) => issueInvoiceById(tenantId, id, { today: '2026-09-19' })),
      );

      const numbers = issued.map((invoice) => invoice.fullNumber).sort();
      expect(numbers).toEqual(
        Array.from({ length: 12 }, (_, i) => `A-2026-${String(i + 1).padStart(5, '0')}`),
      );

      const rows = await prisma.invoice.findMany({
        where: { tenantId },
        orderBy: { number: 'asc' },
      });
      expect(rows[0]!.previousHash).toBeNull();
      for (let i = 1; i < rows.length; i++) expect(rows[i]!.previousHash).toBe(rows[i - 1]!.hash);
      expect(new Set(rows.map((row) => row.hash)).size).toBe(12);
    });

    it('a failed issue does not burn a number', async () => {
      const first = await createInvoice(admin, { clientId, lines: [line(90)] });
      putObject.mockRejectedValueOnce(new Error('bucket down'));
      await expect(issueInvoiceById(tenantId, first)).rejects.toThrow('bucket down');
      expect((await issueInvoiceById(tenantId, first)).fullNumber).toMatch(/-00001$/);
    });

    it('series are per tenant: two tenants both start at 1', async () => {
      const other = await createTenant({ ...LEGAL, taxId: 'B76543214' });
      const otherAdmin = await sessionUserFor(other.id, 'TENANT_ADMIN');
      const otherClient = await createClient(other.id, { addressLine: 'C/ X' });
      const a = await issueInvoice(
        admin,
        await createInvoice(admin, { clientId, lines: [line(10)] }),
      );
      const b = await issueInvoice(
        otherAdmin,
        await createInvoice(otherAdmin, { clientId: otherClient.id, lines: [line(10)] }),
      );
      expect([a.fullNumber, b.fullNumber].every((n) => n!.endsWith('-00001'))).toBe(true);
    });
  });

  it('issuing freezes the legal data, produces the PDF and tells the client', async () => {
    const invoice = await issueInvoice(
      admin,
      await createInvoice(admin, { clientId, lines: [line(90), { ...line(100), irpfRate: 15 }] }),
    );
    expect(invoice).toMatchObject({ status: 'ISSUED' });
    expect(Number(invoice.total)).toBe(214.9); // 190 + 39.90 − 15

    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(row.issuerSnapshot).toMatchObject({ name: LEGAL.legalName, taxId: LEGAL.taxId });
    expect(row.recipientSnapshot).toMatchObject({ name: 'Marta Soler' });
    expect(row.qrData).toContain('ValidarQR');
    const pdf = Buffer.from(putObject.mock.calls[0]![1] as Uint8Array).toString('latin1');
    for (const text of [
      invoice.fullNumber!,
      LEGAL.taxId,
      'Marta Soler',
      'IVA 21 %',
      'IRPF',
      'TOTAL',
    ])
      expect(pdf).toContain(text);
    expect(
      await prisma.notification.count({ where: { userId: clientUser.id, type: 'INVOICE_ISSUED' } }),
    ).toBe(1);
  });

  it('refuses to issue without the legal data of the gestoría or the address of the client', async () => {
    const bare = await createClient(tenantId);
    await expect(
      issueInvoice(admin, await createInvoice(admin, { clientId: bare.id, lines: [line(10)] })),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await prisma.tenant.update({ where: { id: tenantId }, data: { taxId: null } });
    await expect(
      issueInvoice(admin, await createInvoice(admin, { clientId, lines: [line(10)] })),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('permissions: admin manages; managers read assigned; clients see issued ones and can download the PDF even when delinquent', async () => {
    const manager = await sessionUserFor(tenantId, 'MANAGER');
    await expect(createInvoice(manager, { clientId, lines: [line(10)] })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const draft = await createInvoice(admin, { clientId, lines: [line(10)] });
    expect(await listInvoices(clientUser)).toEqual([]); // drafts are invisible to clients
    const issued = await issueInvoice(admin, draft);
    expect(await listInvoices(clientUser)).toHaveLength(1);
    expect(await listInvoices(manager)).toEqual([]);
    await prisma.client.update({
      where: { id: clientId },
      data: { assignedManagerId: manager.id, status: 'DELINQUENT' },
    });
    expect(await listInvoices(manager)).toHaveLength(1);

    await expect(
      fileAccessUrl(clientUser, issued.pdfFile!.id, { inline: false }),
    ).resolves.toContain('signed');
    const stranger = await sessionUserFor(tenantId, 'CLIENT_USER');
    await expect(
      fileAccessUrl(stranger, issued.pdfFile!.id, { inline: false }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('cancelling an issued invoice issues a rectifying one; drafts are just deleted', async () => {
    const draft = await createInvoice(admin, { clientId, lines: [line(10)] });
    await cancelInvoice(admin, draft);
    expect(await prisma.invoice.count()).toBe(0);

    const issued = await issueInvoice(
      admin,
      await createInvoice(admin, { clientId, lines: [line(90)] }),
    );
    await cancelInvoice(admin, issued.id);
    const rows = await prisma.invoice.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows[0]).toMatchObject({ status: 'CANCELLED', fullNumber: issued.fullNumber });
    expect(rows[1]).toMatchObject({ rectifiesId: issued.id });
    expect(rows[1]!.fullNumber).toMatch(/^R-/);
    expect(Number(rows[1]!.total)).toBe(-108.9);
    await expect(cancelInvoice(admin, issued.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('generates the monthly invoices once per client and month', async () => {
    await saveFee(admin, clientId, {
      concept: 'Asesoría fiscal',
      amount: '90',
      startsOn: '2026-01-01',
    });
    await saveFee(admin, clientId, { concept: 'Nóminas', amount: '30,50', startsOn: '2026-01-01' });
    const future = await createClient(tenantId, { addressLine: 'C/ Y' });
    await saveFee(admin, future.id, { concept: 'Asesoría', amount: '50', startsOn: '2026-12-01' });

    expect(await generateMonthlyInvoices(tenantId, '2026-10-01')).toBe(1);
    expect(await generateMonthlyInvoices(tenantId, '2026-10-01')).toBe(0);
    const [invoice] = await listInvoices(admin);
    expect(invoice).toMatchObject({ billingMonth: '2026-10', status: 'ISSUED' });
    expect(invoice!.lines.map((l) => l.description)).toEqual([
      'Asesoría fiscal · octubre de 2026',
      'Nóminas · octubre de 2026',
    ]);
    expect(Number(invoice!.total)).toBe(145.81);
    expect(await generateMonthlyInvoices(tenantId, '2026-11-01')).toBe(1);
  });

  it('dunning: overdue, reminders at 3/10/20 days once each, delinquent at 30, back to active when paid', async () => {
    const invoice = await issueInvoiceById(
      tenantId,
      await createInvoice(admin, { clientId, lines: [line(90)] }),
      { today: '2026-09-01' },
    ); // due 16 Sep
    expect(await runDunning(tenantId, '2026-09-16')).toEqual({ reminders: 0, delinquent: 0 });
    expect(await runDunning(tenantId, '2026-09-19')).toEqual({ reminders: 1, delinquent: 0 });
    expect(await runDunning(tenantId, '2026-09-19')).toEqual({ reminders: 0, delinquent: 0 });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe(
      'OVERDUE',
    );
    expect((await runDunning(tenantId, '2026-09-26')).reminders).toBe(1);
    expect((await runDunning(tenantId, '2026-10-06')).reminders).toBe(1);
    expect(await runDunning(tenantId, '2026-10-16')).toEqual({ reminders: 0, delinquent: 1 });
    expect((await prisma.client.findUniqueOrThrow({ where: { id: clientId } })).status).toBe(
      'DELINQUENT',
    );

    await markPaid(admin, invoice.id, 'BANK_TRANSFER');
    expect((await prisma.client.findUniqueOrThrow({ where: { id: clientId } })).status).toBe(
      'ACTIVE',
    );
    await expect(markPaid(admin, invoice.id, 'BANK_TRANSFER')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  describe('payment webhooks (§8.5)', () => {
    const stripeCall = (event: object, secret = 'whsec_test_stripe') => {
      const body = JSON.stringify(event);
      const t = Math.floor(Date.now() / 1000);
      const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
      return { body, headers: new Headers({ 'stripe-signature': `t=${t},v1=${v1}` }) };
    };

    it('Stripe: verifies the signature, marks the invoice paid and ignores replays', async () => {
      const invoice = await issueInvoice(
        admin,
        await createInvoice(admin, { clientId, lines: [line(90)] }),
      );
      const event = {
        id: 'evt_1',
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_1', client_reference_id: invoice.id } },
      };
      const provider = getPaymentProvider('STRIPE');

      const forged = stripeCall(event, 'wrong-secret');
      await expect(
        handlePaymentWebhook(provider, forged.body, forged.headers),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
      const tampered = stripeCall(event);
      await expect(
        handlePaymentWebhook(provider, tampered.body.replace('evt_1', 'evt_2'), tampered.headers),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe(
        'ISSUED',
      );

      const call = stripeCall(event);
      expect(await handlePaymentWebhook(provider, call.body, call.headers)).toEqual({
        processed: 1,
        duplicates: 0,
      });
      const paid = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(paid).toMatchObject({ status: 'PAID', paymentMethod: 'CARD' });

      // Same event again (provider retry, or an attacker replaying a captured request).
      const replay = stripeCall(event);
      expect(await handlePaymentWebhook(provider, replay.body, replay.headers)).toEqual({
        processed: 0,
        duplicates: 1,
      });
      expect(
        (await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).paidAt,
      ).toEqual(paid.paidAt);
      expect(
        await prisma.auditLog.count({ where: { action: 'invoice.paid', entityId: invoice.id } }),
      ).toBe(1);
    });

    it('GoCardless: several events per call, each processed once', async () => {
      const invoice = await issueInvoice(
        admin,
        await createInvoice(admin, { clientId, lines: [line(90)] }),
      );
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { gocardlessPaymentId: 'PM123' },
      });
      const body = JSON.stringify({
        events: [
          {
            id: 'EV1',
            resource_type: 'payments',
            action: 'submitted',
            links: { payment: 'PM123' },
          },
          {
            id: 'EV2',
            resource_type: 'payments',
            action: 'confirmed',
            links: { payment: 'PM123' },
          },
          { id: 'EV3', resource_type: 'mandates', action: 'active', links: {} },
        ],
      });
      const headers = new Headers({
        'webhook-signature': createHmac('sha256', 'gc_test_secret').update(body).digest('hex'),
      });
      const provider = getPaymentProvider('GOCARDLESS');

      expect(await handlePaymentWebhook(provider, body, headers)).toEqual({
        processed: 3,
        duplicates: 0,
      });
      expect(await handlePaymentWebhook(provider, body, headers)).toEqual({
        processed: 0,
        duplicates: 3,
      });
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe(
        'PAID',
      );
      await expect(
        handlePaymentWebhook(provider, body, new Headers({ 'webhook-signature': 'nope' })),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('clients pay their own invoices only; development providers settle at once', async () => {
      const invoice = await issueInvoice(
        admin,
        await createInvoice(admin, { clientId, lines: [line(90)] }),
      );
      await expect(startPayment(admin, invoice.id, 'CARD')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      const stranger = await sessionUserFor(tenantId, 'CLIENT_USER');
      await expect(startPayment(stranger, invoice.id, 'CARD')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      expect(await startPayment(clientUser, invoice.id, 'CARD')).toEqual({
        checkoutUrl: null,
        simulated: true,
      });
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe(
        'PAID',
      );
      await expect(startPayment(clientUser, invoice.id, 'CARD')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });
  });
});
