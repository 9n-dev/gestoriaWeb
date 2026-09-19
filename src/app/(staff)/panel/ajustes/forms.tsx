'use client';

import type { Tenant } from '@prisma/client';
import { Field } from '@/components/ui/field';
import { ActionForm, SelectField, SubmitButton } from '@/components/ui/form';
import {
  bulkInviteAction,
  createSampleDataAction,
  deleteSampleDataAction,
  inviteStaffAction,
  resetTwoFactorAction,
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
  senderName,
}: {
  primaryColor: string;
  accentColor: string;
  senderName: string;
}) {
  return (
    <ActionForm
      action={updateBrandingAction}
      className="flex max-w-2xl flex-col gap-4"
      renderResult={(state) => {
        const warnings = (state.data as string[] | undefined) ?? [];
        return warnings.length ? (
          <ul className="mt-2 list-disc pl-5 text-fg">
            {warnings.map((warning) => (
              <li key={warning}>⚠️ {warning}</li>
            ))}
          </ul>
        ) : null;
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="logo" className="text-sm font-medium">
            Logo (PNG, JPG o WebP, máximo 1 MB)
          </label>
          <input
            id="logo"
            name="logo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-describedby="logo-hint"
            className="text-sm"
          />
          <p id="logo-hint" className="text-sm text-fg-muted">
            También encabeza tus facturas si es PNG o JPG (un logo en WebP se ve en el portal, pero
            no en los PDF).
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="favicon" className="text-sm font-medium">
            Icono de la pestaña (cuadrado, PNG)
          </label>
          <input
            id="favicon"
            name="favicon"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="text-sm"
          />
        </div>
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
      <Field
        label="Nombre del remitente de los emails"
        name="senderName"
        defaultValue={senderName}
        placeholder="Gestoría Pérez"
      />
      <p className="text-sm text-fg-muted">
        Comprobamos el contraste de tus colores al guardar y te avisamos si algo va a costar de
        leer.
      </p>
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

export function ResetTwoFactorForm({ staff }: { staff: Array<{ id: string; name: string }> }) {
  return (
    <ActionForm action={resetTwoFactorAction} className="flex max-w-md flex-col gap-4">
      <SelectField label="Persona" name="userId" required>
        {staff.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </SelectField>
      <SubmitButton variant="secondary" pendingLabel="Restableciendo…">
        Restablecer verificación en dos pasos
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
      {/* Stays mounted when nobody is left to invite, so the result of the last run remains visible. */}
      {pending > 0 ? (
        <>
          <p className="text-sm text-fg-muted">
            Enviaremos a cada cliente con correo electrónico un enlace personal para entrar en tu
            portal.
          </p>
          <SubmitButton pendingLabel="Enviando invitaciones…">
            {pending === 1 ? 'Invitar a 1 cliente' : `Invitar a ${pending} clientes`}
          </SubmitButton>
        </>
      ) : (
        <p className="text-sm text-fg-muted">
          No hay clientes pendientes de invitar. Podrás invitar a más desde la ficha de cada
          cliente.
        </p>
      )}
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
