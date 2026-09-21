import Link from 'next/link';
import { AppHeader } from '@/components/app-header';
import { env } from '@/env';
import { formatLongDate } from '@/lib/dates';
import { TENANT_STATUS } from '@/lib/labels';
import { requireArea } from '@/modules/auth/area';
import { listTenants } from '@/modules/tenants/service';
import { createTenantAction } from '../actions';
import {
  ReactivateTenantButton,
  TenantRegistrationForm,
  TenantStatusButton,
} from '../tenant-forms';

export default async function PlatformHomePage() {
  const user = await requireArea('area.platform');
  const tenants = await listTenants(user);

  return (
    <>
      <AppHeader
        tenant={null}
        userName={user.name}
        nav={[
          { href: '/plataforma', label: 'Gestorías' },
          { href: '/plataforma/jobs', label: 'Jobs fallidos' },
        ]}
      />
      <main className="mx-auto flex max-w-5xl flex-col gap-8 p-4">
        <section className="flex flex-col gap-4">
          <h1 className="text-2xl font-semibold">Gestorías</h1>
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Gestorías dadas de alta en la plataforma</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Nombre
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Dirección
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Estado
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Usuarios
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Clientes
                </th>
                <th scope="col" className="py-2 font-medium">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr key={tenant.id} className="border-b border-border">
                  <td className="py-2 pr-4">{tenant.name}</td>
                  <td className="py-2 pr-4">
                    {tenant.slug}.{env.APP_DOMAIN}
                  </td>
                  <td className="py-2 pr-4">
                    {TENANT_STATUS[tenant.status]}
                    {tenant.status === 'CANCELLED' && tenant.purgeAfter && (
                      <span className="block text-fg-muted">
                        Se borra el {formatLongDate(tenant.purgeAfter)}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4">{tenant._count.users}</td>
                  <td className="py-2 pr-4">{tenant._count.clients}</td>
                  <td className="flex flex-wrap items-center gap-3 py-2">
                    {user.supportTenantIds.includes(tenant.id) && (
                      <Link href={`/plataforma/soporte/${tenant.id}`} className="underline">
                        Modo soporte
                      </Link>
                    )}
                    {tenant.status === 'CANCELLED' &&
                      tenant.purgeAfter &&
                      tenant.purgeAfter > new Date() && (
                        <ReactivateTenantButton tenantId={tenant.id} />
                      )}
                    {(tenant.status === 'ACTIVE' || tenant.status === 'SUSPENDED') && (
                      <TenantStatusButton
                        tenantId={tenant.id}
                        suspended={tenant.status === 'SUSPENDED'}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="flex max-w-md flex-col gap-4 border-t border-border pt-6">
          <h2 className="text-lg font-semibold">Dar de alta una gestoría</h2>
          <TenantRegistrationForm
            action={createTenantAction}
            appDomain={env.APP_DOMAIN}
            submitLabel="Crear gestoría"
          />
        </section>
      </main>
    </>
  );
}
