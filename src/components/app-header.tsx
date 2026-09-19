import Link from 'next/link';
import { logoutAction } from '@/app/(auth)/acceso/actions';
import { TenantLogo } from '@/components/tenant-logo';
import { Button } from '@/components/ui/button';
import { t, type Locale } from '@/lib/i18n';
import type { CurrentTenant } from '@/modules/tenants/resolve';

export type NavItem = { href: string; label: string };

export function AppHeader({
  tenant,
  userName,
  nav = [],
  unread = 0,
  locale = 'es',
}: {
  tenant: CurrentTenant | null;
  userName: string;
  nav?: NavItem[];
  /** Unread notifications, shown on the bell. */
  unread?: number;
  locale?: Locale;
}) {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" aria-label={t('common.home', locale)}>
          <TenantLogo tenant={tenant} />
        </Link>
        {nav.length > 0 && (
          <nav aria-label="Principal" className="flex flex-1 gap-1">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm hover:bg-surface-muted"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-1">
          <Link
            href="/notificaciones"
            aria-label={
              unread
                ? t('common.notificationsUnread', locale, { count: unread })
                : t('common.notifications', locale)
            }
            className="relative rounded-md px-3 py-2 text-sm hover:bg-surface-muted"
          >
            <span aria-hidden>🔔</span>
            {unread > 0 && (
              <span
                aria-hidden
                className="ml-1 rounded-full bg-danger px-1.5 text-xs font-semibold text-white"
              >
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </Link>
          <Link
            href="/cuenta"
            className="rounded-md px-3 py-2 text-sm text-fg-muted hover:bg-surface-muted"
          >
            {userName}
          </Link>
          <form action={logoutAction}>
            <Button type="submit" variant="ghost">
              {t('common.logout', locale)}
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
