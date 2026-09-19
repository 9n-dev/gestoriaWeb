import { NextResponse } from 'next/server';
import { AppError } from '@/lib/errors';
import { getPaymentProvider, handlePaymentWebhook } from '@/modules/billing/payments';

/** Payment webhook (§6.11): signature verified by the provider adapter, events processed at most once. */
export async function POST(request: Request) {
  try {
    return NextResponse.json(
      await handlePaymentWebhook(
        getPaymentProvider('STRIPE'),
        await request.text(),
        request.headers,
      ),
    );
  } catch (error) {
    if (error instanceof AppError)
      return NextResponse.json({ error: error.userMessage }, { status: error.status });
    console.error('[webhook:stripe]', error);
    return NextResponse.json({ error: 'Error interno.' }, { status: 500 });
  }
}
