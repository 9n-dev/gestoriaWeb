import Link from 'next/link';
import { logoutAction } from '@/app/(auth)/acceso/actions';
import { TenantLogo } from '@/components/tenant-logo';
import { Button } from '@/components/ui/button';
import type { CurrentTenant } from '@/modules/tenants/resolve';

export type NavItem = { href: string; label: string };

export function AppHeader({
  tenant,
  userName,
  nav = [],
}: {
  tenant: CurrentTenant | null;
  userName: string;
  nav?: NavItem[];
}) {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" aria-label="Inicio">
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
            href="/cuenta"
            className="rounded-md px-3 py-2 text-sm text-fg-muted hover:bg-surface-muted"
          >
            {userName}
          </Link>
          <form action={logoutAction}>
            <Button type="submit" variant="ghost">
              Cerrar sesión
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
