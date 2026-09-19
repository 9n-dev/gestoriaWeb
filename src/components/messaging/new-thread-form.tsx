'use client';

import { createThreadAction } from '@/app/actions/messaging';
import { Field } from '@/components/ui/field';
import { ActionForm, SelectField, SubmitButton, TextareaField } from '@/components/ui/form';

/** `staff` adds the thread type: clients always open general conversations. */
export function NewThreadForm({
  clients,
  staff = false,
}: {
  clients: Array<{ id: string; name: string }>;
  staff?: boolean;
}) {
  const only = clients.length === 1 ? clients[0] : null;
  if (clients.length === 0) return null;
  // One form per client keeps the action bound to a client id that was rendered by the server.
  return (
    <div className="flex flex-col gap-6">
      {(only ? [only] : clients).map((client) => (
        <ActionForm
          key={client.id}
          action={createThreadAction.bind(null, client.id)}
          className="flex max-w-2xl flex-col gap-3"
        >
          {!only && <p className="text-sm font-medium">{client.name}</p>}
          <Field label="Asunto" name="subject" id={`subject-${client.id}`} required minLength={3} />
          {staff && (
            <SelectField label="Tipo" name="type" id={`type-${client.id}`} defaultValue="GENERAL">
              <option value="GENERAL">General</option>
              <option value="PERIOD">Sobre un periodo</option>
              <option value="REQUIREMENT">Requerimiento de Hacienda</option>
              <option value="INTERNAL">Interno (solo la gestoría)</option>
            </SelectField>
          )}
          <TextareaField label="Mensaje" name="body" id={`body-${client.id}`} required />
          <SubmitButton pendingLabel="Enviando…">Abrir conversación</SubmitButton>
        </ActionForm>
      ))}
    </div>
  );
}
