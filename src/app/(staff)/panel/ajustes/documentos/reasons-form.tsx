'use client';

import { ActionForm, SubmitButton, TextareaField } from '@/components/ui/form';
import { updateRejectionReasonsAction } from '../actions';

export function ReasonsForm({ reasons }: { reasons: string[] }) {
  return (
    <ActionForm action={updateRejectionReasonsAction} className="flex max-w-2xl flex-col gap-4">
      <TextareaField
        label="Motivos de rechazo (uno por línea)"
        name="reasons"
        rows={8}
        defaultValue={reasons.join('\n')}
      />
      <SubmitButton>Guardar motivos</SubmitButton>
    </ActionForm>
  );
}
