import type { NotificationType } from '@prisma/client';
import { prisma, tenantDb } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { tenantBaseUrl } from '@/modules/tenants/resolve';

export type NotificationPayload = {
  type: NotificationType;
  title: string;
  body?: string;
  /** Path inside the portal, e.g. "/documentos". */
  link?: string;
};

/**
 * In-app notification plus email for each user. The notification centre, web push and per-user
 * preferences arrive in phase 5; until then everything is sent through both channels.
 */
export async function notifyUsers(
  tenantId: string,
  userIds: string[],
  payload: NotificationPayload,
): Promise<void> {
  if (userIds.length === 0) return;
  const db = tenantDb(tenantId);
  const users = await db.user.findMany({
    where: { id: { in: userIds }, status: { not: 'DISABLED' } },
    select: { id: true, email: true, name: true },
  });
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  await db.notification.createMany({
    data: users.map((user) => ({
      tenantId,
      userId: user.id,
      channel: 'IN_APP' as const,
      ...payload,
    })),
  });
  for (const user of users) {
    await sendEmail({
      tenantId,
      to: user.email,
      templateKey: `notification.${payload.type.toLowerCase()}`,
      subject: `${payload.title} · ${tenant.name}`,
      text: [
        `Hola, ${user.name}:`,
        '',
        payload.title,
        ...(payload.body ? ['', payload.body] : []),
        ...(payload.link
          ? ['', `Entra en el portal para verlo: ${tenantBaseUrl(tenant)}${payload.link}`]
          : []),
      ].join('\n'),
    });
  }
}

/** Everyone with access to a client. */
export async function notifyClientUsers(
  tenantId: string,
  clientId: string,
  payload: NotificationPayload,
): Promise<void> {
  const links = await tenantDb(tenantId).clientUser.findMany({
    where: { clientId },
    select: { userId: true },
  });
  await notifyUsers(
    tenantId,
    links.map((link) => link.userId),
    payload,
  );
}
