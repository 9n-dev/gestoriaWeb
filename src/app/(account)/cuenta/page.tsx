import Link from 'next/link';
import { AppHeader } from '@/components/app-header';
import { ROLE } from '@/lib/labels';
import { homePathFor, requireUser } from '@/modules/auth/session';
import { getCurrentTenant } from '@/modules/tenants/current';
import { PasswordForm } from './password-form';

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <>
      <AppHeader tenant={await getCurrentTenant()} userName={user.name} />
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
      </main>
    </>
  );
}
