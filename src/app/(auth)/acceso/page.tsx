import Link from 'next/link';
import { redirect } from 'next/navigation';
import { env } from '@/env';
import { getPendingUser, homePathFor } from '@/modules/auth/session';
import { getCurrentTenant } from '@/modules/tenants/current';
import { LoginForm } from './login-form';

const DEMO_USERS = ['admin@demo.es', 'gestor@demo.es', 'cliente@demo.es'];

export default async function LoginPage() {
  const user = await getPendingUser();
  if (user) redirect(user.twoFactor === 'ok' ? homePathFor(user) : '/acceso/2fa');
  const tenant = await getCurrentTenant();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {tenant?.name ?? 'Administración de la plataforma'}
        </h1>
        <p className="mt-1 text-fg-muted">Accede a tu portal de clientes.</p>
      </div>
      <LoginForm />
      {!tenant && (
        <p className="text-sm text-fg-muted">
          ¿Tienes una gestoría?{' '}
          <Link href="/registro" className="underline">
            Crea tu portal de clientes
          </Link>
        </p>
      )}
      {env.DEMO_MODE && tenant && (
        <section aria-labelledby="demo-users" className="rounded-md bg-surface-muted p-4 text-sm">
          <h2 id="demo-users" className="font-semibold">
            Usuarios de demostración
          </h2>
          <ul className="mt-2 flex flex-col gap-1">
            {DEMO_USERS.map((email) => (
              <li key={email}>
                {email} / <code>demo1234</code>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
