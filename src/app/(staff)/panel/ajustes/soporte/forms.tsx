'use client';

import { ActionForm, SelectField, SubmitButton, TextareaField } from '@/components/ui/form';
import { grantSupportAction, revokeSupportAction } from './actions';

export function GrantSupportForm() {
  return (
    <ActionForm action={grantSupportAction} className="flex max-w-xl flex-col gap-4">
      <TextareaField label="¿Qué necesitas que revisemos?" name="reason" rows={3} required />
      <SelectField label="Duración del acceso" name="hours" defaultValue="24">
        <option value="4">4 horas</option>
        <option value="24">24 horas</option>
        <option value="72">3 días</option>
      </SelectField>
      <SubmitButton variant="secondary" pendingLabel="Activando…">
        Activar modo soporte
      </SubmitButton>
    </ActionForm>
  );
}

export function RevokeSupportForm({ grantId }: { grantId: string }) {
  return (
    <ActionForm action={revokeSupportAction.bind(null, grantId)} className="flex flex-col gap-1">
      <SubmitButton variant="secondary" pendingLabel="Cerrando…">
        Cerrar acceso
      </SubmitButton>
    </ActionForm>
  );
}
