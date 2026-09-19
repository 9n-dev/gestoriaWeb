import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { reportError } from '@/lib/report-error';
import { AppError } from '@/lib/errors';
import { rateLimitByIp } from '@/lib/rate-limit';
import { getInboundProvider } from '@/modules/documents/inbound/provider';
import { receiveInboundEmail } from '@/modules/documents/inbound/service';

/** Inbound email webhook (§6.3). Authenticity is the provider's job; idempotency the service's. */
export async function POST(request: Request) {
  try {
    await rateLimitByIp('webhook');
    const email = await getInboundProvider().parse(await request.text(), request.headers);
    const result = await receiveInboundEmail('RESEND', email);
    // 200 also for unknown addresses: the provider must not retry them.
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AppError)
      return NextResponse.json({ error: error.userMessage }, { status: error.status });
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Payload no válido.' }, { status: 400 });
    }
    reportError(error, { where: 'webhook:resend-inbound' });
    return NextResponse.json({ error: 'Error interno.' }, { status: 500 });
  }
}
