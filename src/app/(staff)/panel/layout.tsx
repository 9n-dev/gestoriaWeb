import type { ReactNode } from 'react';
import { AppHeader } from '@/components/app-header';
import { requireArea } from '@/modules/auth/area';
import { getCurrentTenant } from '@/modules/tenants/current';

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const user = await requireArea('area.staff');
  const tenant = await getCurrentTenant();
  return (
    <>
      <AppHeader tenantName={tenant?.name ?? ''} userName={user.name} />
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </>
  );
}
