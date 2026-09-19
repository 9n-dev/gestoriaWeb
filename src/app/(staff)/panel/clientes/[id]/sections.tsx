'use client';

import { Field } from '@/components/ui/field';
import { ActionForm, SelectField, SubmitButton, TextareaField } from '@/components/ui/form';
import { deleteDeliveryAction } from '@/app/actions/deliveries';
import {
  assignManagerAction,
  assignTaxProfileAction,
  deleteClientAction,
  deletePermanentDocumentAction,
  inviteClientUserAction,
  resendInvitationAction,
  updateNotesAction,
} from '../actions';

type Option = { id: string; name: string };

export function TaxProfileSection({
  clientId,
  current,
  profiles,
}: {
  clientId: string;
  current: string | null;
  profiles: Option[];
}) {
  return (
    <ActionForm action={assignTaxProfileAction.bind(null, clientId)}>
      <SelectField label="Perfil fiscal" name="taxProfileId" defaultValue={current ?? ''}>
        <option value="">Sin perfil</option>
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name}
          </option>
        ))}
      </SelectField>
      <p className="text-sm text-fg-muted">
        Al cambiar el perfil solo se tocan las obligaciones futuras que nadie ha empezado.
      </p>
      <SubmitButton variant="secondary">Guardar perfil</SubmitButton>
    </ActionForm>
  );
}

export function ManagerSection({
  clientId,
  current,
  managers,
}: {
  clientId: string;
  current: string | null;
  managers: Option[];
}) {
  return (
    <ActionForm action={assignManagerAction.bind(null, clientId)}>
      <SelectField label="Gestor asignado" name="managerId" defaultValue={current ?? ''}>
        <option value="">Sin asignar</option>
        {managers.map((manager) => (
          <option key={manager.id} value={manager.id}>
            {manager.name}
          </option>
        ))}
      </SelectField>
      <SubmitButton variant="secondary">Guardar gestor</SubmitButton>
    </ActionForm>
  );
}

export function NotesSection({ clientId, notes }: { clientId: string; notes: string | null }) {
  return (
    <ActionForm action={updateNotesAction.bind(null, clientId)}>
      <TextareaField
        label="Notas internas (el cliente nunca las ve)"
        name="internalNotes"
        defaultValue={notes ?? ''}
      />
      <SubmitButton variant="secondary">Guardar notas</SubmitButton>
    </ActionForm>
  );
}

export function InviteSection({
  clientId,
  defaultEmail,
  defaultName,
}: {
  clientId: string;
  defaultEmail: string;
  defaultName: string;
}) {
  return (
    <ActionForm action={inviteClientUserAction.bind(null, clientId)}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" name="name" defaultValue={defaultName} required />
        <Field
          label="Correo electrónico"
          name="email"
          type="email"
          defaultValue={defaultEmail}
          required
        />
      </div>
      <SubmitButton variant="secondary" pendingLabel="Enviando…">
        Invitar al portal
      </SubmitButton>
    </ActionForm>
  );
}

export function ResendButton({ userId }: { userId: string }) {
  return (
    <ActionForm
      action={resendInvitationAction.bind(null, userId)}
      className="flex items-center gap-3"
    >
      <SubmitButton variant="ghost" pendingLabel="Enviando…">
        Reenviar invitación
      </SubmitButton>
    </ActionForm>
  );
}

export function DeleteSection({ clientId }: { clientId: string }) {
  return (
    <details className="rounded-md border border-border p-4">
      <summary className="cursor-pointer text-sm font-medium text-danger">Eliminar cliente</summary>
      <ActionForm
        action={deleteClientAction.bind(null, clientId)}
        className="mt-3 flex flex-col gap-3"
      >
        <p className="text-sm text-fg-muted">
          El cliente dejará de aparecer en el portal. Sus datos se conservan hasta que se solicite
          el borrado definitivo.
        </p>
        <SubmitButton variant="secondary" pendingLabel="Eliminando…">
          Sí, eliminar
        </SubmitButton>
      </ActionForm>
    </details>
  );
}

export function DeletePermanentButton({ clientId, id }: { clientId: string; id: string }) {
  return (
    <ActionForm action={deletePermanentDocumentAction.bind(null, clientId, id)} className="flex">
      <SubmitButton variant="ghost" pendingLabel="Eliminando…">
        Eliminar
      </SubmitButton>
    </ActionForm>
  );
}

export function DeleteDeliveryButton({ clientId, id }: { clientId: string; id: string }) {
  return (
    <ActionForm action={deleteDeliveryAction.bind(null, clientId, id)} className="flex">
      <SubmitButton variant="ghost" pendingLabel="Eliminando…">
        Eliminar
      </SubmitButton>
    </ActionForm>
  );
}
