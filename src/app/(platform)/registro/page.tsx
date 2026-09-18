import Link from 'next/link';
import { redirect } from 'next/navigation';
import { env } from '@/env';
import { getCurrentTenant } from '@/modules/tenants/current';
import { registerTenantAction } from '../actions';
import { TenantRegistrationForm } from '../tenant-forms';

/** Public sign-up for gestorías. Lives on the platform host only. */
export default async function RegisterPage() {
  if (await getCurrentTenant()) redirect('/acceso');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-4">
      <div>
        <h1 className="text-2xl font-semibold">Crea el portal de tu gestoría</h1>
        <p className="mt-1 text-fg-muted">
          En unos minutos tendrás tu portal de clientes con tu marca, listo para invitar a tus
          clientes.
        </p>
      </div>
      <TenantRegistrationForm
        action={registerTenantAction}
        appDomain={env.APP_DOMAIN}
        submitLabel="Crear mi portal"
      />
      <p className="text-sm text-fg-muted">
        ¿Ya tienes portal? Entra desde la dirección de tu gestoría o{' '}
        <Link href="/acceso" className="underline">
          accede como administrador de la plataforma
        </Link>
        .
      </p>
    </main>
  );
}
