import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ImportForm } from '@/app/(staff)/panel/clientes/importar/import-form';
import { ImportInstructions } from '@/app/(staff)/panel/clientes/importar/import-instructions';
import {
  BrandingForm,
  BulkInviteForm,
  InviteStaffForm,
  SampleDataForm,
  TenantProfileForm,
} from '@/app/(staff)/panel/ajustes/forms';
import { AppHeader } from '@/components/app-header';
import { StaffList } from '@/components/staff-list';
import { tenantDb } from '@/lib/db';
import { requireArea } from '@/modules/auth/area';
import { listStaff } from '@/modules/auth/invitations';
import { can } from '@/modules/auth/permissions';
import { listClientsFor } from '@/modules/clients/service';
import { getCurrentTenant } from '@/modules/tenants/current';
import { parseBranding } from '@/modules/tenants/schema';
import { getOwnTenant, hasSampleData } from '@/modules/tenants/service';
import { FinishForm } from './finish-form';

const STEPS = ['Tu gestoría', 'Tu marca', 'Tu equipo', 'Tus clientes', 'Invitaciones'] as const;

const linkButton =
  'inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-muted';

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ paso?: string }>;
}) {
  const user = await requireArea('area.staff');
  if (!can(user, 'tenantSettings.manage')) notFound();
  const tenant = await getCurrentTenant();
  if (!tenant) redirect('/acceso');

  const step = Math.min(Math.max(Number((await searchParams).paso) || 1, 1), STEPS.length);

  return (
    <>
      <AppHeader tenant={tenant} userName={user.name} />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
        <div>
          <h1 className="text-2xl font-semibold">Pon en marcha tu portal</h1>
          <p className="text-fg-muted">
            Cinco pasos. Cada uno se guarda por separado y puedes volver cuando quieras.
          </p>
        </div>

        <nav aria-label="Pasos del asistente">
          <ol className="flex flex-wrap gap-2 text-sm">
            {STEPS.map((title, index) => (
              <li key={title}>
                <Link
                  href={`/bienvenida?paso=${index + 1}`}
                  aria-current={step === index + 1 ? 'step' : undefined}
                  className={`inline-flex min-h-9 items-center rounded-full border px-3 ${
                    step === index + 1
                      ? 'border-primary bg-primary text-primary-fg'
                      : 'border-border'
                  }`}
                >
                  {index + 1}. {title}
                </Link>
              </li>
            ))}
          </ol>
        </nav>

        <section aria-labelledby="step-title" className="flex flex-col gap-4">
          <h2 id="step-title" className="text-lg font-semibold">
            {step}. {STEPS[step - 1]}
          </h2>
          <Step step={step} />
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          {step > 1 ? (
            <Link href={`/bienvenida?paso=${step - 1}`} className={linkButton}>
              Anterior
            </Link>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {step < STEPS.length ? (
              <>
                <FinishForm label="Saltar el asistente" variant="ghost" />
                <Link
                  href={`/bienvenida?paso=${step + 1}`}
                  className={`${linkButton} border-0 bg-primary text-primary-fg`}
                >
                  Siguiente
                </Link>
              </>
            ) : (
              <FinishForm label="Terminar e ir al panel" />
            )}
          </div>
        </div>
      </main>
    </>
  );
}

async function Step({ step }: { step: number }) {
  const user = await requireArea('area.staff');
  const tenant = await getOwnTenant(user);

  if (step === 1) {
    return (
      <>
        <p className="text-sm text-fg-muted">
          Estos datos aparecerán en tus comunicaciones y en tus facturas.
        </p>
        <TenantProfileForm tenant={tenant} />
      </>
    );
  }

  if (step === 2) {
    const branding = parseBranding(tenant.branding);
    return (
      <>
        <p className="text-sm text-fg-muted">
          Tus clientes verán tu logo y tus colores, no los nuestros.
        </p>
        <BrandingForm
          primaryColor={branding.primaryColor ?? '#1d4ed8'}
          accentColor={branding.accentColor ?? '#0f766e'}
          senderName={branding.senderName ?? ''}
        />
      </>
    );
  }

  if (step === 3) {
    return (
      <>
        <p className="text-sm text-fg-muted">
          Los gestores solo ven los clientes que tienen asignados; supervisores y administradores,
          todos.
        </p>
        <StaffList staff={await listStaff(user)} />
        <InviteStaffForm />
      </>
    );
  }

  if (step === 4) {
    const total = (await listClientsFor(user)).length;
    return (
      <>
        <p className="text-sm">
          {total === 0 ? 'Todavía no tienes clientes.' : `Tienes ${total} clientes en el portal.`}{' '}
          También puedes{' '}
          <Link href="/panel/clientes/nuevo" className="underline">
            crearlos uno a uno
          </Link>{' '}
          más tarde.
        </p>
        <ImportInstructions />
        <ImportForm />
      </>
    );
  }

  const pending = await tenantDb(tenant.id).client.count({
    where: { deletedAt: null, isSample: false, email: { not: null }, users: { none: {} } },
  });
  return (
    <>
      <BulkInviteForm pending={pending} />
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <h3 className="font-medium">¿Quieres probar con datos de ejemplo?</h3>
        <p className="text-sm text-fg-muted">
          Tres clientes ficticios con sus obligaciones, para ver cómo funciona todo. Se borran con
          un clic.
        </p>
        <SampleDataForm hasSampleData={await hasSampleData(tenant.id)} />
      </div>
    </>
  );
}
