import { logoutAction } from '@/app/(auth)/acceso/actions';
import { Button } from '@/components/ui/button';

export function AppHeader({ tenantName, userName }: { tenantName: string; userName: string }) {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <p className="font-semibold">{tenantName}</p>
        <div className="flex items-center gap-3">
          <span className="text-sm text-fg-muted">{userName}</span>
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
