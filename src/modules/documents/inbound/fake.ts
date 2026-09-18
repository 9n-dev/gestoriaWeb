import { z } from 'zod';
import type { InboundEmailProvider } from './provider';

const payloadSchema = z.object({
  id: z.string().min(1),
  from: z.string(),
  to: z.array(z.string()).min(1),
  subject: z.string().default(''),
  text: z.string().default(''),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        contentType: z.string().default(''),
        contentBase64: z.string(),
      }),
    )
    .default([]),
});

/**
 * Development and test provider: no signature, attachments inline as base64.
 *   curl -X POST localhost:3000/api/webhooks/resend-inbound -d '{"id":"1","from":"a@b.es",
 *     "to":["perez-xxxx@docs.localhost"],"subject":"Facturas","attachments":[…]}'
 */
export const fakeInboundProvider: InboundEmailProvider = {
  async parse(rawBody) {
    const payload = payloadSchema.parse(JSON.parse(rawBody));
    return {
      ...payload,
      attachments: payload.attachments.map((attachment) => ({
        filename: attachment.filename,
        contentType: attachment.contentType,
        load: async () => new Uint8Array(Buffer.from(attachment.contentBase64, 'base64')),
      })),
    };
  },
};
