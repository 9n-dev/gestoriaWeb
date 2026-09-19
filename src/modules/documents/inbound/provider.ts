import { env } from '@/env';
import { AppError } from '@/lib/errors';
import { fakeInboundProvider } from './fake';
import { resendInboundProvider } from './resend';

export type InboundAttachment = {
  filename: string;
  /** Declared by the sender: informative only, the bytes decide. */
  contentType: string;
  load(): Promise<Uint8Array>;
};

export type InboundEmail = {
  /** Provider's id of the message: the idempotency key. */
  id: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  attachments: InboundAttachment[];
};

export interface InboundEmailProvider {
  /** Authenticates the webhook call and normalizes its payload. Throws AppError when not authentic. */
  parse(rawBody: string, headers: Headers): Promise<InboundEmail>;
}

/**
 * Resend when its signing secret is configured. Without it, the development fake — never in
 * production, where an unsigned webhook must not be able to create documents.
 */
export function getInboundProvider(): InboundEmailProvider {
  if (env.RESEND_WEBHOOK_SECRET)
    return resendInboundProvider(env.RESEND_WEBHOOK_SECRET, env.RESEND_API_KEY);
  if (env.NODE_ENV !== 'production') return fakeInboundProvider;
  throw new AppError(
    'UNAUTHENTICATED',
    'Webhook no configurado.',
    'RESEND_WEBHOOK_SECRET is not set',
  );
}
