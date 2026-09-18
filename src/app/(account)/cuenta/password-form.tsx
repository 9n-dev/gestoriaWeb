'use client';

import { Field } from '@/components/ui/field';
import { ActionForm, SubmitButton } from '@/components/ui/form';
import { setPasswordAction } from './actions';

export function PasswordForm() {
  return (
    <ActionForm action={setPasswordAction} className="flex max-w-sm flex-col gap-4">
      <Field
        label="Nueva contraseña"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
      />
      <Field
        label="Repite la contraseña"
        name="confirmation"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
      />
      <SubmitButton>Guardar contraseña</SubmitButton>
    </ActionForm>
  );
}
