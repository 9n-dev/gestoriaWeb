import { NextResponse } from 'next/server';
import { AppError } from '@/lib/errors';
import { rateLimitByIp } from '@/lib/rate-limit';
import { getPaymentProvider, handlePaymentWebhook } from '@/modules/billing/payments';

/** Payment webhook (§6.11): signature verified by the provider adapter, events processed at most once. */
export async function POST(request: Request) {
  try {
    await rateLimitByIp('webhook');
    return NextResponse.json(
      await handlePaymentWebhook(
        getPaymentProvider('GOCARDLESS'),
        await request.text(),
        request.headers,
      ),
    );
  } catch (error) {
    if (error instanceof AppError)
      return NextResponse.json({ error: error.userMessage }, { status: error.status });
    console.error('[webhook:gocardless]', error);
    return NextResponse.json({ error: 'Error interno.' }, { status: 500 });
  }
}
