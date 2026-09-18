import { Field } from '@/components/ui/field';
import { ActionForm, SelectField, SubmitButton, type FormState } from '@/components/ui/form';
import type { StaffClient } from '@/modules/clients/repository';

type Option = { id: string; name: string };

/** Create and edit share this form. Profile and manager are only chosen on creation. */
export function ClientForm({
  action,
  client,
  taxProfiles,
  managers,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  client?: StaffClient;
  taxProfiles?: Option[];
  managers?: Option[];
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} className="flex max-w-2xl flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Nombre o razón social"
          name="legalName"
          defaultValue={client?.legalName}
          required
        />
        <Field
          label="NIF"
          name="taxId"
          defaultValue={client?.taxId}
          required
          autoCapitalize="characters"
        />
        <Field label="Nombre comercial" name="tradeName" defaultValue={client?.tradeName ?? ''} />
        <Field
          label="Correo electrónico"
          name="email"
          type="email"
          defaultValue={client?.email ?? ''}
        />
        <Field label="Teléfono" name="phone" type="tel" defaultValue={client?.phone ?? ''} />
        <Field label="Dirección" name="addressLine" defaultValue={client?.addressLine ?? ''} />
        <Field
          label="Código postal"
          name="postalCode"
          defaultValue={client?.postalCode ?? ''}
          inputMode="numeric"
        />
        <Field label="Población" name="city" defaultValue={client?.city ?? ''} />
        <Field label="Provincia" name="province" defaultValue={client?.province ?? ''} />
        <Field
          label="Etiquetas (separadas por comas)"
          name="tags"
          defaultValue={client?.tags.join(', ') ?? ''}
        />
      </div>

      {taxProfiles && (
        <SelectField label="Perfil fiscal" name="taxProfileId" defaultValue="">
          <option value="">Sin perfil por ahora</option>
          {taxProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </SelectField>
      )}
      {managers && (
        <SelectField label="Gestor asignado" name="assignedManagerId" defaultValue="">
          <option value="">Sin asignar</option>
          {managers.map((manager) => (
            <option key={manager.id} value={manager.id}>
              {manager.name}
            </option>
          ))}
        </SelectField>
      )}
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
