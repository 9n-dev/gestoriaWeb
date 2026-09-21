import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { requestMeta } from '@/lib/request';
import { homePathFor, requireUser } from '@/modules/auth/session';
import { acceptAgreements, pendingAgreements } from '@/modules/legal/dpa';

export const metadata = { title: 'Contrato de encargo de tratamiento' };

async function acceptAction() {
  'use server';
  await acceptAgreements(await requireUser({ agreements: 'pending-allowed' }), await requestMeta());
  redirect('/');
}

/** Shown once per version of the agreement, before the first visit to the portal. */
export default async function TermsPage() {
  const user = await requireUser({ agreements: 'pending-allowed' });
  const agreements = await pendingAgreements(user);
  if (agreements.length === 0) redirect(homePathFor(user));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Antes de empezar</h1>
        <p className="mt-1 text-fg-muted">
          La normativa de protección de datos exige un contrato de encargo de tratamiento. Léelo y
          acéptalo para continuar.
        </p>
      </div>
      {agreements.map((agreement) => (
        <section key={agreement.clientId ?? 'tenant'} className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">{agreement.title}</h2>
          <div
            tabIndex={0}
            role="document"
            aria-label={agreement.title}
            className="max-h-64 overflow-y-auto rounded-md border border-border bg-surface-muted p-3 text-sm whitespace-pre-line"
          >
            {agreement.text}
          </div>
        </section>
      ))}
      <form action={acceptAction}>
        <Button type="submit">He leído y acepto</Button>
      </form>
    </div>
  );
}
