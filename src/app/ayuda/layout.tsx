import Link from 'next/link';
import type { ReactNode } from 'react';
import { TenantLogo } from '@/components/tenant-logo';
import { getCurrentTenant } from '@/modules/tenants/current';

export const metadata = { title: 'Ayuda' };

/** Public and white label: readable before logging in, under the gestoría's own logo. */
export default async function HelpLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" aria-label="Inicio">
            <TenantLogo tenant={await getCurrentTenant()} />
          </Link>
          <Link href="/ayuda" className="rounded-md px-3 py-2 text-sm hover:bg-surface-muted">
            Ayuda
          </Link>
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">{children}</main>
    </>
  );
}
