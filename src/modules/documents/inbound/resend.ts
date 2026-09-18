import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import type { InboundEmailProvider } from './provider';

const TOLERANCE_SECONDS = 5 * 60;

/** Svix signature scheme used by Resend webhooks: HMAC-SHA256 over "<id>.<timestamp>.<body>". */
export function verifySvixSignature(
  secret: string,
  rawBody: string,
  headers: Headers,
  now = Date.now(),
): void {
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const signatures = headers.get('svix-signature');
  const reject = (detail: string) => new AppError('UNAUTHENTICATED', 'Firma no válida.', detail);
  if (!id || !timestamp || !signatures) throw reject('missing svix headers');
  if (Math.abs(now / 1000 - Number(timestamp)) > TOLERANCE_SECONDS)
    throw reject('timestamp out of tolerance');

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();
  const valid = signatures.split(' ').some((entry) => {
    const [version, signature] = entry.split(',');
    const given = Buffer.from(signature ?? '', 'base64');
    return version === 'v1' && given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!valid) throw reject('signature mismatch');
}

const eventSchema = z.object({
  type: z.literal('email.received'),
  data: z.object({
    email_id: z.string(),
    from: z.string(),
    to: z.array(z.string()),
    subject: z.string().nullish(),
    text: z.string().nullish(),
    attachments: z
      .array(
        z.object({
          id: z.string(),
          filename: z.string().nullish(),
          content_type: z.string().nullish(),
        }),
      )
      .nullish(),
  }),
});

const attachmentSchema = z.object({ download_url: z.url() });

/**
 * Resend inbound. The webhook carries attachment metadata only; the content is fetched from the
 * API on demand. NOTE (TD-027): written against Resend's published inbound API without a live
 * account; verify the attachment endpoint when the first real domain is connected.
 */
export const resendInboundProvider = (secret: string, apiKey?: string): InboundEmailProvider => ({
  async parse(rawBody, headers) {
    verifySvixSignature(secret, rawBody, headers);
    const { data } = eventSchema.parse(JSON.parse(rawBody));
    return {
      id: data.email_id,
      from: data.from,
      to: data.to,
      subject: data.subject ?? '',
      text: data.text ?? '',
      attachments: (data.attachments ?? []).map((attachment) => ({
        filename: attachment.filename ?? 'adjunto',
        contentType: attachment.content_type ?? '',
        async load() {
          const meta = await fetch(
            `https://api.resend.com/emails/receiving/${data.email_id}/attachments/${attachment.id}`,
            { headers: { Authorization: `Bearer ${apiKey}` } },
          );
          if (!meta.ok) throw new Error(`Resend attachment lookup failed: ${meta.status}`);
          const { download_url } = attachmentSchema.parse(await meta.json());
          const content = await fetch(download_url);
          if (!content.ok) throw new Error(`Resend attachment download failed: ${content.status}`);
          return new Uint8Array(await content.arrayBuffer());
        },
      })),
    };
  },
});
