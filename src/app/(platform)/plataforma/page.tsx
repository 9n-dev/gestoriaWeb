import { AppHeader } from '@/components/app-header';
import { requireArea } from '@/modules/auth/area';

export default async function PlatformHomePage() {
  const user = await requireArea('area.platform');
  return (
    <>
      <AppHeader tenantName="Plataforma" userName={user.name} />
      <main className="mx-auto max-w-5xl p-4">
        <h1 className="text-2xl font-semibold">Administración de la plataforma</h1>
        <p className="mt-2 text-fg-muted">La gestión de gestorías llega en la fase 2.</p>
      </main>
    </>
  );
}
