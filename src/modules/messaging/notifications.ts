import type { Notification, NotificationType } from '@prisma/client';
import { z } from 'zod';
import { prisma, tenantDb } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import {
  DEFAULT_TEMPLATES,
  NOTIFICATION_TEMPLATE_KEYS,
  renderTemplate,
  type NotificationTemplateKey,
} from '@/modules/obligations/reminders/templates';
import { AppError } from '@/lib/errors';
import { assertCan, requireTenantId, type SessionUser } from '@/modules/auth/permissions';
import { tenantBaseUrl } from '@/modules/tenants/resolve';
import { getPushSender } from './push';

export type NotificationPayload = {
  type: NotificationType;
  title: string;
  body?: string;
  /** Path inside the portal, e.g. "/documentos". */
  link?: string;
  /** Templated email instead of the generic one built from title and body. */
  email?: { subject: string; text: string; templateKey: string; replyTo?: string };
};

const NOTIFICATION_TYPES = [
  'DOCUMENT_RECEIVED',
  'DOCUMENT_REJECTED',
  'OBLIGATION_FILED',
  'DEADLINE_REMINDER',
  'MISSING_DOCS_REMINDER',
  'NEW_MESSAGE',
  'MENTION',
  'DELIVERY_AVAILABLE',
  'SIGNATURE_REQUESTED',
  'INVOICE_ISSUED',
  'INVOICE_OVERDUE',
  'PERMANENT_DOC_EXPIRING',
  'CLIENT_INACTIVE',
  'SYSTEM',
] as const satisfies readonly NotificationType[];

/** The kind's own override, then the common one, then the default. */
async function resolveNotificationTemplate(tenantId: string, type: NotificationType) {
  const own = `notification.${type.toLowerCase()}`;
  const keys = (NOTIFICATION_TEMPLATE_KEYS as readonly string[]).includes(own)
    ? [own as NotificationTemplateKey, 'notification.generic' as const]
    : ['notification.generic' as const];
  const overrides = await tenantDb(tenantId).template.findMany({
    where: { kind: 'EMAIL', locale: 'es', key: { in: keys } },
  });
  for (const key of keys) {
    const override = overrides.find((row) => row.key === key);
    if (override) {
      return { subject: override.subject ?? DEFAULT_TEMPLATES[key].subject, body: override.body };
    }
  }
  return DEFAULT_TEMPLATES['notification.generic'];
}

/** `User.notificationPrefs`. In-app notifications cannot be turned off: they are the record. */
export const notificationPrefsSchema = z.object({
  email: z.boolean().catch(true),
  push: z.boolean().catch(true),
  mutedTypes: z.array(z.enum(NOTIFICATION_TYPES)).catch([]),
});
export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;
export const parseNotificationPrefs = (value: unknown): NotificationPrefs =>
  notificationPrefsSchema.parse(value && typeof value === 'object' ? value : {});

/**
 * The single fan-out (§6.8): always an in-app notification; email and web push according to each
 * user's preferences. A push that fails never breaks the caller.
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
    select: { id: true, email: true, name: true, notificationPrefs: true, pushSubscriptions: true },
  });
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const portal = payload.link ? `${tenantBaseUrl(tenant)}${payload.link}` : undefined;

  await db.notification.createMany({
    data: users.map((user) => ({
      tenantId,
      userId: user.id,
      channel: 'IN_APP' as const,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      link: payload.link,
    })),
  });

  for (const user of users) {
    const prefs = parseNotificationPrefs(user.notificationPrefs);
    if (prefs.mutedTypes.includes(payload.type)) continue;

    if (prefs.email) {
      // The tenant's wording for this kind of notification, or its common one (Ajustes → Emails).
      const template = await resolveNotificationTemplate(tenantId, payload.type);
      const variables = {
        nombre: user.name,
        titulo: payload.email?.subject ?? payload.title,
        detalle: payload.email?.text ?? payload.body ?? '',
        enlace: portal ?? '',
        gestoria: tenant.name,
      };
      await sendEmail({
        tenantId,
        to: user.email,
        replyTo: payload.email?.replyTo,
        templateKey: payload.email?.templateKey ?? `notification.${payload.type.toLowerCase()}`,
        subject: `${renderTemplate(template.subject, variables)} · ${tenant.name}`,
        text: renderTemplate(template.body, variables),
      });
    }

    if (prefs.push) {
      for (const subscription of user.pushSubscriptions) {
        const result = await getPushSender()
          .send(subscription, { title: payload.title, body: payload.body, url: portal })
          .catch((error: unknown) => {
            console.error('[push] failed:', error instanceof Error ? error.message : error);
            return 'sent' as const;
          });
        if (result === 'gone') await db.pushSubscription.delete({ where: { id: subscription.id } });
      }
    }
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

// ─────────────────────────── Notification centre (own notifications only) ───────────────────────────

const own = (user: SessionUser) => {
  assertCan(user, 'notification.read', { tenantId: user.tenantId ?? '', ownerUserId: user.id });
  return { db: tenantDb(requireTenantId(user)), where: { userId: user.id } };
};

export async function listNotifications(user: SessionUser, take = 50): Promise<Notification[]> {
  const { db, where } = own(user);
  return db.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take });
}

export async function unreadCount(user: SessionUser): Promise<number> {
  if (!user.tenantId) return 0;
  const { db, where } = own(user);
  return db.notification.count({ where: { ...where, readAt: null } });
}

export async function markNotificationRead(user: SessionUser, id: string): Promise<string | null> {
  const { db, where } = own(user);
  const notification = await db.notification.findFirst({ where: { ...where, id } });
  if (!notification) throw new AppError('NOT_FOUND', 'No encontramos esa notificación.');
  if (!notification.readAt)
    await db.notification.update({ where: { id }, data: { readAt: new Date() } });
  return notification.link;
}

export async function markAllNotificationsRead(user: SessionUser): Promise<void> {
  const { db, where } = own(user);
  await db.notification.updateMany({
    where: { ...where, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function getNotificationPrefs(user: SessionUser): Promise<NotificationPrefs> {
  const row = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { notificationPrefs: true },
  });
  return parseNotificationPrefs(row.notificationPrefs);
}

export async function updateNotificationPrefs(user: SessionUser, input: unknown): Promise<void> {
  assertCan(user, 'notification.managePrefs', {
    tenantId: user.tenantId ?? '',
    ownerUserId: user.id,
  });
  const prefs = z
    .object({
      email: z.boolean(),
      push: z.boolean(),
      mutedTypes: z.array(z.enum(NOTIFICATION_TYPES)),
    })
    .parse(input);
  await prisma.user.update({ where: { id: user.id }, data: { notificationPrefs: prefs } });
}

const subscriptionSchema = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(200) }),
  userAgent: z.string().max(300).optional(),
});

/** Registers this browser for web push. The endpoint is unique: re-subscribing moves it to the current user. */
export async function subscribePush(user: SessionUser, input: unknown): Promise<void> {
  assertCan(user, 'push.subscribe', { tenantId: user.tenantId ?? '', ownerUserId: user.id });
  const tenantId = requireTenantId(user);
  const { endpoint, keys, userAgent } = subscriptionSchema.parse(input);
  const data = { tenantId, userId: user.id, ...keys, userAgent };
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { endpoint, ...data },
    update: data,
  });
}

export async function unsubscribePush(user: SessionUser, endpoint: string): Promise<void> {
  await tenantDb(requireTenantId(user)).pushSubscription.deleteMany({
    where: { endpoint, userId: user.id },
  });
}
