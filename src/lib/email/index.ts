import { env } from '@/env';
import { prisma } from '@/lib/db';

export type EmailMessage = {
  /** null for platform emails. */
  tenantId: string | null;
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  from?: string;
  templateKey?: string;
};

/**
 * Sends through Resend when RESEND_API_KEY is set; otherwise stores the email in `email_log`
 * and prints it (development fallback). Every email is logged either way.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  const from = message.from ?? env.EMAIL_FROM;
  const log = await prisma.emailLog.create({
    data: {
      tenantId: message.tenantId,
      toAddress: message.to,
      fromAddress: from,
      replyTo: message.replyTo,
      subject: message.subject,
      templateKey: message.templateKey,
      bodyText: message.text,
      bodyHtml: message.html,
      status: env.RESEND_API_KEY ? 'QUEUED' : 'LOGGED_ONLY',
    },
  });

  if (!env.RESEND_API_KEY) {
    console.info(`[email:dev] to=${message.to} subject="${message.subject}"\n${message.text}`);
    return;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        reply_to: message.replyTo,
      }),
    });
    if (!response.ok)
      throw new Error(`Resend responded ${response.status}: ${await response.text()}`);
    const { id } = (await response.json()) as { id?: string };
    await prisma.emailLog.update({
      where: { id: log.id },
      data: { status: 'SENT', sentAt: new Date(), providerMessageId: id },
    });
  } catch (error) {
    await prisma.emailLog.update({
      where: { id: log.id },
      data: { status: 'FAILED', error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}
