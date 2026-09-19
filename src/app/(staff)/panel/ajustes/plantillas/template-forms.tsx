'use client';

import { deleteTemplateAction, saveTemplateAction } from '@/app/actions/messaging';
import { Field } from '@/components/ui/field';
import { ActionForm, SubmitButton, TextareaField } from '@/components/ui/form';

export function TemplateForm({
  template,
}: {
  template?: { id: string; name: string; body: string };
}) {
  const key = template?.id ?? 'new';
  return (
    <ActionForm
      action={saveTemplateAction.bind(null, template?.id ?? null)}
      className="flex max-w-2xl flex-col gap-3"
    >
      <Field label="Nombre" name="name" id={`name-${key}`} defaultValue={template?.name} required />
      <TextareaField
        label="Texto"
        name="body"
        id={`body-${key}`}
        defaultValue={template?.body}
        rows={5}
        required
      />
      <SubmitButton variant={template ? 'secondary' : 'primary'}>
        {template ? 'Guardar cambios' : 'Crear plantilla'}
      </SubmitButton>
    </ActionForm>
  );
}

export function DeleteTemplateButton({ id }: { id: string }) {
  return (
    <ActionForm action={deleteTemplateAction.bind(null, id)} className="flex">
      <SubmitButton variant="ghost" pendingLabel="Eliminando…">
        Eliminar
      </SubmitButton>
    </ActionForm>
  );
}
