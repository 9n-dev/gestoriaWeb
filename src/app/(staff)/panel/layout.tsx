import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppHeader } from '@/components/app-header';
import { requireArea } from '@/modules/auth/area';
import { can } from '@/modules/auth/permissions';
import { getCurrentTenant } from '@/modules/tenants/current';

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const user = await requireArea('area.staff');
  const tenant = await getCurrentTenant();
  // A new gestoría starts in the onboarding wizard until its admin finishes or skips it.
  if (tenant && !tenant.onboardingCompletedAt && can(user, 'tenantSettings.manage'))
    redirect('/bienvenida');

  const nav = [
    { href: '/panel', label: 'Resumen' },
    { href: '/panel/bandeja', label: 'Bandeja' },
    { href: '/panel/semaforo', label: 'Semáforo' },
    { href: '/panel/plazos', label: 'Plazos' },
    { href: '/panel/clientes', label: 'Clientes' },
    ...(can(user, 'tenantSettings.manage') ? [{ href: '/panel/ajustes', label: 'Ajustes' }] : []),
  ];
  return (
    <>
      <AppHeader tenant={tenant} userName={user.name} nav={nav} />
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </>
  );
}
