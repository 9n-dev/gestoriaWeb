import { createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma, type WebhookProvider } from '@prisma/client';
import { env } from '@/env';
import { prisma, tenantDb } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { recordAudit } from '@/modules/audit/service';
import { assertCan, type SessionUser } from '@/modules/auth/permissions';
import { tenantBaseUrl } from '@/modules/tenants/resolve';
import { getInvoice, invoiceResource, markInvoicePaid } from './service';

export type PaymentEvent = {
  externalId: string;
  type: 'paid' | 'failed' | 'ignored';
  reference: string | null;
};
export type PaymentRequest = {
  invoiceId: string;
  fullNumber: string;
  amountCents: number;
  returnUrl: string;
  customerReference?: string | null;
};

/** Card (Stripe) and SEPA direct debit (GoCardless) behind one interface (§6.11). */
export interface PaymentProvider {
  readonly name: WebhookProvider;
  /** Starts a payment. `checkoutUrl` is where the client is sent, when the provider has a hosted page. */
  createPayment(
    request: PaymentRequest,
  ): Promise<{ reference: string; checkoutUrl: string | null }>;
  /** Verifies the signature (throws AppError UNAUTHENTICATED) and normalizes the events of one webhook call. */
  parseWebhook(rawBody: string, headers: Headers): PaymentEvent[];
}

const safeEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const hmac = (secret: string, payload: string) =>
  createHmac('sha256', secret).update(payload).digest('hex');
const unauthenticated = (detail: string) =>
  new AppError('UNAUTHENTICATED', 'Firma no válida.', detail);

async function post(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, { method: 'POST', headers, body });
  if (!response.ok)
    throw new Error(`${new URL(url).host} responded ${response.status}: ${await response.text()}`);
  return (await response.json()) as Record<string, unknown>;
}

/** Stripe Checkout. Signature: `Stripe-Signature: t=<ts>,v1=<hmac-sha256(secret, "<ts>.<body>")>`, 5 min tolerance. */
export const stripeProvider = (
  secretKey: string | undefined,
  webhookSecret: string | undefined,
): PaymentProvider => ({
  name: 'STRIPE',
  async createPayment(request) {
    if (!secretKey) return { reference: `dev_card_${request.invoiceId}`, checkoutUrl: null };
    const form = new URLSearchParams({
      mode: 'payment',
      success_url: request.returnUrl,
      cancel_url: request.returnUrl,
      client_reference_id: request.invoiceId,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'eur',
      'line_items[0][price_data][unit_amount]': String(request.amountCents),
      'line_items[0][price_data][product_data][name]': `Factura ${request.fullNumber}`,
      'payment_intent_data[metadata][invoiceId]': request.invoiceId,
    });
    const session = await post(
      'https://api.stripe.com/v1/checkout/sessions',
      {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `invoice-${request.invoiceId}`,
      },
      form.toString(),
    );
    return { reference: String(session.id), checkoutUrl: String(session.url) };
  },
  parseWebhook(rawBody, headers) {
    if (!webhookSecret) throw unauthenticated('STRIPE_WEBHOOK_SECRET is not set');
    const parts = Object.fromEntries(
      (headers.get('stripe-signature') ?? '')
        .split(',')
        .map((part) => part.split('=') as [string, string]),
    );
    if (!parts.t || !parts.v1 || Math.abs(Date.now() / 1000 - Number(parts.t)) > 300)
      throw unauthenticated('missing or stale stripe signature');
    if (!safeEqual(parts.v1, hmac(webhookSecret, `${parts.t}.${rawBody}`)))
      throw unauthenticated('stripe signature mismatch');

    const event = JSON.parse(rawBody) as {
      id: string;
      type: string;
      data: {
        object: { id?: string; client_reference_id?: string; metadata?: { invoiceId?: string } };
      };
    };
    const object = event.data.object;
    const type =
      event.type === 'checkout.session.completed'
        ? 'paid'
        : event.type === 'payment_intent.payment_failed'
          ? 'failed'
          : 'ignored';
    return [
      {
        externalId: event.id,
        type,
        reference: object.client_reference_id ?? object.metadata?.invoiceId ?? object.id ?? null,
      },
    ];
  },
});

/** GoCardless payment against the client's SEPA mandate. Signature: `Webhook-Signature: <hmac-sha256(secret, body)>`. */
export const gocardlessProvider = (
  accessToken: string | undefined,
  webhookSecret: string | undefined,
): PaymentProvider => ({
  name: 'GOCARDLESS',
  async createPayment(request) {
    if (!accessToken) return { reference: `dev_sepa_${request.invoiceId}`, checkoutUrl: null };
    if (!request.customerReference)
      throw new AppError('VALIDATION', 'Este cliente todavía no tiene un mandato SEPA firmado.');
    const created = await post(
      'https://api.gocardless.com/payments',
      {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'GoCardless-Version': '2015-07-06',
        'Idempotency-Key': `invoice-${request.invoiceId}`,
      },
      JSON.stringify({
        payments: {
          amount: request.amountCents,
          currency: 'EUR',
          description: `Factura ${request.fullNumber}`,
          metadata: { invoiceId: request.invoiceId },
          links: { mandate: request.customerReference },
        },
      }),
    );
    return { reference: String((created.payments as { id: string }).id), checkoutUrl: null };
  },
  parseWebhook(rawBody, headers) {
    if (!webhookSecret) throw unauthenticated('GOCARDLESS_WEBHOOK_SECRET is not set');
    if (!safeEqual(headers.get('webhook-signature') ?? '', hmac(webhookSecret, rawBody)))
      throw unauthenticated('gocardless signature mismatch');
    const { events } = JSON.parse(rawBody) as {
      events: Array<{
        id: string;
        resource_type: string;
        action: string;
        links?: { payment?: string };
        metadata?: { invoiceId?: string };
      }>;
    };
    return events.map((event) => ({
      externalId: event.id,
      type:
        event.resource_type !== 'payments'
          ? 'ignored'
          : ['confirmed', 'paid_out'].includes(event.action)
            ? 'paid'
            : ['failed', 'cancelled', 'charged_back'].includes(event.action)
              ? 'failed'
              : 'ignored',
      reference: event.links?.payment ?? null,
    }));
  },
});

export const getPaymentProvider = (name: 'STRIPE' | 'GOCARDLESS'): PaymentProvider =>
  name === 'STRIPE'
    ? stripeProvider(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET)
    : gocardlessProvider(env.GOCARDLESS_ACCESS_TOKEN, env.GOCARDLESS_WEBHOOK_SECRET);

/** The client pays an invoice: card through Stripe Checkout, or a SEPA debit against its mandate. */
export async function startPayment(
  user: SessionUser,
  invoiceId: string,
  method: 'CARD' | 'SEPA_DEBIT',
): Promise<{ checkoutUrl: string | null; simulated: boolean }> {
  const invoice = await getInvoice(user, invoiceId);
  assertCan(user, 'invoice.pay', invoiceResource(invoice));
  if (invoice.status !== 'ISSUED' && invoice.status !== 'OVERDUE')
    throw new AppError('CONFLICT', 'Esta factura no está pendiente de pago.');

  const db = tenantDb(invoice.tenantId);
  const [tenant, client] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: invoice.tenantId } }),
    db.client.findFirst({
      where: { id: invoice.clientId! },
      select: { gocardlessMandateId: true },
    }),
  ]);
  const provider = getPaymentProvider(method === 'CARD' ? 'STRIPE' : 'GOCARDLESS');
  const payment = await provider.createPayment({
    invoiceId,
    fullNumber: invoice.fullNumber!,
    amountCents: Math.round(Number(invoice.total) * 100),
    returnUrl: `${tenantBaseUrl(tenant)}/facturas`,
    customerReference: method === 'SEPA_DEBIT' ? client?.gocardlessMandateId : null,
  });
  await db.invoice.update({
    where: { id: invoiceId },
    data: {
      paymentMethod: method,
      ...(method === 'CARD'
        ? { stripePaymentIntentId: payment.reference }
        : { gocardlessPaymentId: payment.reference }),
    },
  });
  await recordAudit({
    tenantId: invoice.tenantId,
    actor: user,
    action: 'invoice.startPayment',
    entity: 'Invoice',
    entityId: invoiceId,
    diff: { method },
  });

  // Development providers have no hosted page: the payment is settled at once so the flow can be tried.
  const simulated = payment.reference.startsWith('dev_');
  if (simulated) await markInvoicePaid(invoice.tenantId, invoiceId, method);
  return { checkoutUrl: payment.checkoutUrl, simulated };
}

/**
 * One webhook call (§6.11): signature first, then every event at most once. `WebhookEvent` has a
 * unique key on (provider, externalId): a replayed or re-delivered event is acknowledged and ignored.
 */
export async function handlePaymentWebhook(
  provider: PaymentProvider,
  rawBody: string,
  headers: Headers,
): Promise<{ processed: number; duplicates: number }> {
  const result = { processed: 0, duplicates: 0 };
  for (const event of provider.parseWebhook(rawBody, headers)) {
    try {
      await prisma.webhookEvent.create({
        data: {
          provider: provider.name,
          externalId: event.externalId,
          eventType: event.type,
          payload: { reference: event.reference },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        result.duplicates++;
        continue;
      }
      throw error;
    }

    const invoice = event.reference
      ? await prisma.invoice.findFirst({
          where: {
            OR: [
              { id: event.reference },
              { stripePaymentIntentId: event.reference },
              { gocardlessPaymentId: event.reference },
            ],
          },
          select: { id: true, tenantId: true },
        })
      : null;
    if (invoice && event.type === 'paid') {
      await markInvoicePaid(
        invoice.tenantId,
        invoice.id,
        provider.name === 'STRIPE' ? 'CARD' : 'SEPA_DEBIT',
      );
    } else if (invoice && event.type === 'failed') {
      await recordAudit({
        tenantId: invoice.tenantId,
        action: 'invoice.paymentFailed',
        entity: 'Invoice',
        entityId: invoice.id,
        diff: { provider: provider.name },
      });
    }
    await prisma.webhookEvent.updateMany({
      where: { provider: provider.name, externalId: event.externalId },
      data: {
        processedAt: new Date(),
        error: invoice || event.type === 'ignored' ? null : 'unknown reference',
      },
    });
    result.processed++;
  }
  return result;
}
