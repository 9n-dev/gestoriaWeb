'use client';

import {
  removeCustomDomainAction,
  removeSendingDomainAction,
  requestCustomDomainAction,
  requestSendingDomainAction,
  verifyCustomDomainAction,
} from '@/app/actions/branding';
import { Field } from '@/components/ui/field';
import { ActionForm, SubmitButton, type FormState } from '@/components/ui/form';

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

export function DomainForm({
  kind,
  placeholder,
}: {
  kind: 'portal' | 'email';
  placeholder: string;
}) {
  const action: Action = kind === 'portal' ? requestCustomDomainAction : requestSendingDomainAction;
  return (
    <ActionForm action={action} className="flex max-w-xl flex-wrap items-end gap-3">
      <Field
        label="Dominio"
        name="domain"
        id={`domain-${kind}`}
        placeholder={placeholder}
        required
        autoCapitalize="none"
      />
      <SubmitButton variant="secondary">Guardar dominio</SubmitButton>
    </ActionForm>
  );
}

export function DomainButtons({ kind, verified }: { kind: 'portal' | 'email'; verified: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {kind === 'portal' && !verified && (
        <ActionForm action={verifyCustomDomainAction}>
          <SubmitButton pendingLabel="Comprobando…">Comprobar ahora</SubmitButton>
        </ActionForm>
      )}
      <ActionForm action={kind === 'portal' ? removeCustomDomainAction : removeSendingDomainAction}>
        <SubmitButton variant="ghost" pendingLabel="Eliminando…">
          Quitar este dominio
        </SubmitButton>
      </ActionForm>
    </div>
  );
}
