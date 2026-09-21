'use client';

import type { ReactNode } from 'react';
import { Field } from '@/components/ui/field';
import { ActionForm, SubmitButton, type FormState } from '@/components/ui/form';
import { reactivateTenantAction, setTenantStatusAction, verifyRegistrationAction } from './actions';

/** Shared by public sign-up and by the superadmin's "new tenant" form. */
export function TenantRegistrationForm({
  action,
  appDomain,
  submitLabel,
  footer,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  appDomain: string;
  submitLabel: string;
  footer?: ReactNode;
}) {
  return (
    <ActionForm action={action}>
      {/* Honeypot (see registerTenantAction): out of sight, out of the tab order, ignored by screen readers. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          No rellenes este campo
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <Field label="Nombre de la gestoría" name="name" required />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="slug" className="text-sm font-medium">
          Dirección del portal
        </label>
        <div className="flex items-center gap-1">
          <input
            id="slug"
            name="slug"
            required
            pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
            autoCapitalize="none"
            aria-describedby="slug-help"
            className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-base"
          />
          <span className="text-sm text-fg-muted">.{appDomain}</span>
        </div>
        <p id="slug-help" className="text-sm text-fg-muted">
          Minúsculas, números y guiones. Más adelante podrás usar tu propio dominio.
        </p>
      </div>
      <Field label="Nombre del administrador" name="adminName" autoComplete="name" required />
      <Field
        label="Correo del administrador"
        name="adminEmail"
        type="email"
        autoComplete="email"
        required
      />
      {footer}
      <SubmitButton pendingLabel="Enviando…">{submitLabel}</SubmitButton>
    </ActionForm>
  );
}

export function VerifyForm({ token }: { token: string }) {
  return (
    <ActionForm action={verifyRegistrationAction}>
      <input type="hidden" name="token" value={token} />
      <SubmitButton pendingLabel="Activando…">Activar el portal</SubmitButton>
    </ActionForm>
  );
}

/** A cancelled gestoría inside its 30 days of grace: undo the cancellation. */
export function ReactivateTenantButton({ tenantId }: { tenantId: string }) {
  return (
    <ActionForm action={reactivateTenantAction.bind(null, tenantId)}>
      <SubmitButton variant="ghost" pendingLabel="…">
        Anular la baja
      </SubmitButton>
    </ActionForm>
  );
}

export function TenantStatusButton({
  tenantId,
  suspended,
}: {
  tenantId: string;
  suspended: boolean;
}) {
  return (
    <ActionForm
      action={setTenantStatusAction.bind(null, tenantId, suspended ? 'ACTIVE' : 'SUSPENDED')}
    >
      <SubmitButton variant="ghost" pendingLabel="…">
        {suspended ? 'Reactivar' : 'Suspender'}
      </SubmitButton>
    </ActionForm>
  );
}
