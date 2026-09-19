import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/modules/auth/permissions';
import { resetDb } from '@tests/setup/db';
import { createTenant } from '@tests/setup/factories';
import { sessionUserFor } from '@tests/setup/session';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notifyUsers,
  subscribePush,
  unreadCount,
  unsubscribePush,
  updateNotificationPrefs,
} from './notifications';
import * as push from './push';

const payload = {
  type: 'NEW_MESSAGE' as const,
  title: 'Tienes un mensaje nuevo',
  body: 'Hola',
  link: '/mensajes/1',
};
const subscription = (n: number) => ({
  endpoint: `https://push.test/${n}`,
  keys: { p256dh: 'p', auth: 'a' },
});

describe('notification centre', () => {
  let tenantId: string;
  let ana: SessionUser;
  let luis: SessionUser;
  const send = vi.fn();

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    send.mockReset().mockResolvedValue('sent');
    vi.spyOn(push, 'getPushSender').mockReturnValue({ send });
    await resetDb();
    tenantId = (await createTenant({ slug: 'perez' })).id;
    ana = await sessionUserFor(tenantId, 'CLIENT_USER');
    luis = await sessionUserFor(tenantId, 'MANAGER');
  });

  it('fans out to in-app, email (with a link to the tenant host) and every push subscription', async () => {
    await subscribePush(ana, subscription(1));
    await subscribePush(ana, subscription(2));
    await notifyUsers(tenantId, [ana.id], payload);

    expect(await unreadCount(ana)).toBe(1);
    const email = await prisma.emailLog.findFirstOrThrow();
    expect(email.bodyText).toContain('https://perez.app.test/mensajes/1');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://push.test/1' }),
      {
        title: payload.title,
        body: 'Hola',
        url: 'https://perez.app.test/mensajes/1',
      },
    );
  });

  it('honours preferences per channel and muted types, but always keeps the in-app record', async () => {
    await subscribePush(ana, subscription(1));
    await updateNotificationPrefs(ana, { email: false, push: true, mutedTypes: [] });
    await notifyUsers(tenantId, [ana.id], payload);
    expect(await prisma.emailLog.count()).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);

    await updateNotificationPrefs(ana, { email: true, push: true, mutedTypes: ['NEW_MESSAGE'] });
    await notifyUsers(tenantId, [ana.id], payload);
    await notifyUsers(tenantId, [ana.id], { ...payload, type: 'DOCUMENT_REJECTED' });
    expect(await prisma.emailLog.count()).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(await unreadCount(ana)).toBe(3);
  });

  it('prunes subscriptions the browser has dropped and survives push failures', async () => {
    await subscribePush(ana, subscription(1));
    await subscribePush(ana, subscription(2));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    send.mockResolvedValueOnce('gone').mockRejectedValueOnce(new Error('push service down'));

    await expect(notifyUsers(tenantId, [ana.id], payload)).resolves.toBeUndefined();
    expect((await prisma.pushSubscription.findMany()).map((s) => s.endpoint)).toEqual([
      'https://push.test/2',
    ]);
  });

  it('a browser belongs to whoever subscribed last; unsubscribing only removes your own', async () => {
    await subscribePush(ana, subscription(1));
    await subscribePush(luis, subscription(1));
    expect(await prisma.pushSubscription.findMany()).toMatchObject([{ userId: luis.id }]);
    await unsubscribePush(ana, 'https://push.test/1');
    expect(await prisma.pushSubscription.count()).toBe(1);
    await unsubscribePush(luis, 'https://push.test/1');
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it('people only see and mark their own notifications', async () => {
    await notifyUsers(tenantId, [ana.id, luis.id], payload);
    const [mine] = await listNotifications(ana);
    expect(await listNotifications(ana)).toHaveLength(1);

    await expect(markNotificationRead(luis, mine!.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await markNotificationRead(ana, mine!.id)).toBe('/mensajes/1');
    expect(await unreadCount(ana)).toBe(0);
    expect(await unreadCount(luis)).toBe(1);

    await markAllNotificationsRead(luis);
    expect(await unreadCount(luis)).toBe(0);
  });

  it('skips disabled users and users of other tenants', async () => {
    const outsider = await sessionUserFor((await createTenant()).id, 'MANAGER');
    await prisma.user.update({ where: { id: luis.id }, data: { status: 'DISABLED' } });
    await notifyUsers(tenantId, [luis.id, outsider.id], payload);
    expect(await prisma.notification.count()).toBe(0);
  });
});
