import { NextResponse } from 'next/server';
import { AppError } from '@/lib/errors';
import { rateLimitByIp } from '@/lib/rate-limit';
import { exportUrlForToken } from '@/modules/gdpr/export';

/** Emailed door to a data export: the token is the credential (a cancelled tenant cannot log in). */
export async function GET(request: Request): Promise<Response> {
  try {
    await rateLimitByIp('login');
    const token = new URL(request.url).searchParams.get('token') ?? '';
    return NextResponse.redirect(await exportUrlForToken(token));
  } catch (error) {
    if (error instanceof AppError) return new Response(error.userMessage, { status: error.status });
    throw error;
  }
}
