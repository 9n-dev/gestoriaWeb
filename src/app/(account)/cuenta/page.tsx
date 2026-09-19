import Link from 'next/link';
import { AppHeader } from '@/components/app-header';
import { ROLE } from '@/lib/labels';
import { homePathFor, requireUser } from '@/modules/auth/session';
import { getCurrentTenant } from '@/modules/tenants/current';
import { env } from '@/env';
import { getNotificationPrefs, unreadCount } from '@/modules/messaging/notifications';
import { NotificationSettings, PushToggle } from './notification-settings';
import { PasswordForm } from './password-form';

export default async function AccountPage() {
  const user = await requireUser();
  const prefs = await getNotificationPrefs(user);
  return (
    <>
      <AppHeader
        tenant={await getCurrentTenant()}
        userName={user.name}
        unread={await unreadCount(user)}
      />
      <main className="mx-auto flex max-w-5xl flex-col gap-6 p-4">
        <div>
          <p className="text-sm text-fg-muted">
            <Link href={homePathFor(user)} className="underline">
              Volver
            </Link>
          </p>
          <h1 className="text-2xl font-semibold">Tu cuenta</h1>
          <p className="text-fg-muted">
            {user.name} · {user.email} · {ROLE[user.role]}
          </p>
        </div>
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Contraseña</h2>
          <p className="max-w-prose text-sm text-fg-muted">
            Puedes entrar siempre con un enlace enviado a tu correo. Si prefieres usar contraseña,
            créala aquí.
          </p>
          <PasswordForm />
        </section>
        {user.tenantId && (
          <section className="flex flex-col gap-3 border-t border-border pt-6">
            <h2 className="text-lg font-semibold">Notificaciones</h2>
            <NotificationSettings {...prefs} />
            <PushToggle vapidPublicKey={env.VAPID_PUBLIC_KEY ?? null} />
          </section>
        )}
      </main>
    </>
  );
}
