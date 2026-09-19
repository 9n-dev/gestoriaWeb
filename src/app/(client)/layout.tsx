import type { ReactNode } from 'react';
import { AppHeader } from '@/components/app-header';
import { requireArea } from '@/modules/auth/area';
import { unreadCount } from '@/modules/messaging/notifications';
import { getCurrentTenant } from '@/modules/tenants/current';

const NAV = [
  { href: '/inicio', label: 'Inicio' },
  { href: '/subir', label: 'Subir' },
  { href: '/documentos', label: 'Mis documentos' },
  { href: '/plazos', label: 'Plazos' },
  { href: '/mensajes', label: 'Mensajes' },
  { href: '/entregas', label: 'Entregas' },
];

export default async function ClientLayout({ children }: { children: ReactNode }) {
  const user = await requireArea('area.client');
  return (
    <>
      <AppHeader
        tenant={await getCurrentTenant()}
        userName={user.name}
        nav={NAV}
        unread={await unreadCount(user)}
      />
      <main className="mx-auto max-w-3xl p-4">{children}</main>
    </>
  );
}
