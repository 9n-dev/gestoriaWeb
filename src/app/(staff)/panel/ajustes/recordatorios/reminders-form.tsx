'use client';

import { Field } from '@/components/ui/field';
import { ActionForm, SubmitButton } from '@/components/ui/form';
import { updateReminderSettingsAction } from '../actions';

export function RemindersForm({
  enabled,
  offsets,
  inactivityDays,
}: {
  enabled: boolean;
  offsets: number[];
  inactivityDays: number;
}) {
  return (
    <ActionForm action={updateReminderSettingsAction} className="flex max-w-xl flex-col gap-4">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="enabled" defaultChecked={enabled} className="size-4" />
        Enviar recordatorios automáticos
      </label>
      <Field
        label="Días antes del plazo (separados por comas; 0 = el mismo día)"
        name="offsets"
        defaultValue={offsets.join(', ')}
        required
      />
      <Field
        label="Avisar al gestor de clientes sin actividad tras (días; 0 = nunca)"
        name="inactivityDays"
        type="number"
        min={0}
        max={365}
        defaultValue={inactivityDays}
        required
      />
      <SubmitButton>Guardar</SubmitButton>
    </ActionForm>
  );
}
