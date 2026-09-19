import Link from 'next/link';
import { markAllReadAction, openNotificationAction } from '@/app/actions/notifications';
import { AppHeader } from '@/components/app-header';
import { Button } from '@/components/ui/button';
import { homePathFor, requireUser } from '@/modules/auth/session';
import { listNotifications } from '@/modules/messaging/notifications';
import { getCurrentTenant } from '@/modules/tenants/current';

const dateTime = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Madrid',
});

export default async function NotificationsPage() {
  const user = await requireUser();
  const notifications = await listNotifications(user);
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <>
      <AppHeader tenant={await getCurrentTenant()} userName={user.name} unread={unread} />
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
        <p className="text-sm text-fg-muted">
          <Link href={homePathFor(user)} className="underline">
            Volver
          </Link>
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Notificaciones</h1>
          {unread > 0 && (
            <form action={markAllReadAction}>
              <Button type="submit" variant="secondary">
                Marcar todo como leído
              </Button>
            </form>
          )}
        </div>
        {notifications.length === 0 ? (
          <p className="text-fg-muted">No tienes notificaciones.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {notifications.map((notification) => (
              <li key={notification.id}>
                <form action={openNotificationAction.bind(null, notification.id)}>
                  <button
                    type="submit"
                    className={`w-full rounded-md border border-border p-3 text-left text-sm hover:bg-surface-muted ${notification.readAt ? 'text-fg-muted' : 'border-l-4 border-l-primary'}`}
                  >
                    <span className={notification.readAt ? '' : 'font-semibold'}>
                      {notification.title}
                    </span>
                    {!notification.readAt && <span className="sr-only"> (sin leer)</span>}
                    {notification.body && <span className="mt-0.5 block">{notification.body}</span>}
                    <span className="mt-0.5 block text-xs text-fg-muted">
                      {dateTime.format(notification.createdAt)}
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm">
          <Link href="/cuenta" className="underline">
            Elegir qué avisos recibo y cómo
          </Link>
        </p>
      </main>
    </>
  );
}
