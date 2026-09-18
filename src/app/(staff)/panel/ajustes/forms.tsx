'use client';

import type { Tenant } from '@prisma/client';
import { Field } from '@/components/ui/field';
import { ActionForm, SelectField, SubmitButton } from '@/components/ui/form';
import {
  bulkInviteAction,
  createSampleDataAction,
  deleteSampleDataAction,
  inviteStaffAction,
  updateBrandingAction,
  updateTenantProfileAction,
} from './actions';

type TenantProfile = Pick<
  Tenant,
  | 'name'
  | 'legalName'
  | 'taxId'
  | 'addressLine'
  | 'postalCode'
  | 'city'
  | 'province'
  | 'contactEmail'
  | 'phone'
>;

export function TenantProfileForm({ tenant }: { tenant: TenantProfile }) {
  return (
    <ActionForm action={updateTenantProfileAction} className="flex max-w-2xl flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre de la gestoría" name="name" defaultValue={tenant.name} required />
        <Field label="Razón social" name="legalName" defaultValue={tenant.legalName ?? ''} />
        <Field label="NIF" name="taxId" defaultValue={tenant.taxId ?? ''} />
        <Field
          label="Correo de contacto"
          name="contactEmail"
          type="email"
          defaultValue={tenant.contactEmail ?? ''}
        />
        <Field label="Teléfono" name="phone" type="tel" defaultValue={tenant.phone ?? ''} />
        <Field label="Dirección" name="addressLine" defaultValue={tenant.addressLine ?? ''} />
        <Field label="Código postal" name="postalCode" defaultValue={tenant.postalCode ?? ''} />
        <Field label="Población" name="city" defaultValue={tenant.city ?? ''} />
        <Field label="Provincia" name="province" defaultValue={tenant.province ?? ''} />
      </div>
      <SubmitButton>Guardar datos</SubmitButton>
    </ActionForm>
  );
}

export function BrandingForm({
  primaryColor,
  accentColor,
}: {
  primaryColor: string;
  accentColor: string;
}) {
  return (
    <ActionForm action={updateBrandingAction} className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="logo" className="text-sm font-medium">
          Logo (PNG, JPG o WebP, máximo 1 MB)
        </label>
        <input
          id="logo"
          name="logo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="text-sm"
        />
      </div>
      <div className="flex flex-wrap gap-6">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="primaryColor" className="text-sm font-medium">
            Color principal
          </label>
          <input
            id="primaryColor"
            name="primaryColor"
            type="color"
            defaultValue={primaryColor}
            className="h-11 w-24"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="accentColor" className="text-sm font-medium">
            Color de acento
          </label>
          <input
            id="accentColor"
            name="accentColor"
            type="color"
            defaultValue={accentColor}
            className="h-11 w-24"
          />
        </div>
      </div>
      <SubmitButton>Guardar marca</SubmitButton>
    </ActionForm>
  );
}

export function InviteStaffForm() {
  return (
    <ActionForm action={inviteStaffAction} className="flex max-w-2xl flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Nombre" name="name" required />
        <Field label="Correo electrónico" name="email" type="email" required />
        <SelectField label="Rol" name="role" defaultValue="MANAGER">
          <option value="MANAGER">Gestor</option>
          <option value="SUPERVISOR">Supervisor</option>
          <option value="TENANT_ADMIN">Administrador</option>
        </SelectField>
      </div>
      <SubmitButton variant="secondary" pendingLabel="Enviando…">
        Enviar invitación
      </SubmitButton>
    </ActionForm>
  );
}

export function BulkInviteForm({ pending }: { pending: number }) {
  return (
    <ActionForm
      action={bulkInviteAction}
      renderResult={(state) => {
        const skipped = state.data as Array<{ legalName: string; reason: string }> | undefined;
        if (!skipped?.length) return null;
        return (
          <ul className="mt-2 list-disc pl-5 text-fg-muted">
            {skipped.map((item) => (
              <li key={item.legalName}>
                {item.legalName}: {item.reason}
              </li>
            ))}
          </ul>
        );
      }}
    >
      <SubmitButton pendingLabel="Enviando invitaciones…">
        {pending === 1 ? 'Invitar a 1 cliente' : `Invitar a ${pending} clientes`}
      </SubmitButton>
    </ActionForm>
  );
}

export function SampleDataForm({ hasSampleData }: { hasSampleData: boolean }) {
  return hasSampleData ? (
    <ActionForm action={deleteSampleDataAction}>
      <SubmitButton variant="secondary" pendingLabel="Eliminando…">
        Borrar los datos de ejemplo
      </SubmitButton>
    </ActionForm>
  ) : (
    <ActionForm action={createSampleDataAction}>
      <SubmitButton variant="secondary" pendingLabel="Creando…">
        Crear 3 clientes de ejemplo
      </SubmitButton>
    </ActionForm>
  );
}
