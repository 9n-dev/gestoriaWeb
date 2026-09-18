'use client';

import type { DocumentType } from '@prisma/client';
import { Field } from '@/components/ui/field';
import { ActionForm, SelectField, SubmitButton, TextareaField } from '@/components/ui/form';
import {
  DOCUMENT_TYPE_LABELS,
  REGIMES,
  VAT_PERIODICITIES,
} from '@/modules/clients/tax-profiles/labels';
import type { TaxProfileRules } from '@/modules/clients/tax-profiles/schema';
import { archiveTaxProfileAction, cloneTaxProfileAction, updateTaxProfileAction } from '../actions';

export function CloneButton({ id }: { id: string }) {
  return (
    <ActionForm action={cloneTaxProfileAction.bind(null, id)} className="flex items-center gap-3">
      <SubmitButton variant="secondary" pendingLabel="Clonando…">
        Clonar
      </SubmitButton>
    </ActionForm>
  );
}

const FLAGS = [
  ['hasEmployees', 'Tiene trabajadores o retiene a profesionales'],
  ['withholdsRent', 'Retiene por alquileres'],
  ['intraCommunity', 'Hace operaciones intracomunitarias'],
] as const;

export function TaxProfileForm({
  id,
  name,
  description,
  rules,
  models,
}: {
  id: string;
  name: string;
  description: string;
  rules: TaxProfileRules;
  models: Array<{ model: string; name: string }>;
}) {
  const checklist = new Map(rules.checklist.map((item) => [item.documentType, item.label]));
  return (
    <ActionForm
      action={updateTaxProfileAction.bind(null, id)}
      className="flex max-w-3xl flex-col gap-6"
    >
      <Field label="Nombre" name="name" defaultValue={name} required />
      <TextareaField label="Descripción" name="description" defaultValue={description} rows={2} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Régimen" name="regime" defaultValue={rules.regime}>
          {Object.entries(REGIMES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Periodicidad del IVA"
          name="vatPeriodicity"
          defaultValue={rules.vatPeriodicity}
        >
          {Object.entries(VAT_PERIODICITIES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Características</legend>
        {FLAGS.map(([flag, label]) => (
          <label key={flag} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name={flag} defaultChecked={rules[flag]} className="size-4" />
            {label}
          </label>
        ))}
      </fieldset>

      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-medium">Modelos que se generan</legend>
        {models.map(({ model, name: modelName }) => (
          <label key={model} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="models"
              value={model}
              defaultChecked={rules.models.includes(model)}
              className="mt-0.5 size-4"
            />
            <span>
              <strong>{model}</strong> <span className="text-fg-muted">{modelName}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Documentación que se pide cada periodo</legend>
        {(Object.keys(DOCUMENT_TYPE_LABELS) as DocumentType[]).map((type) => (
          <div key={type} className="flex flex-wrap items-center gap-2 text-sm">
            <input
              type="checkbox"
              id={`checklist-${type}`}
              name="checklist"
              value={type}
              defaultChecked={checklist.has(type)}
              className="size-4"
            />
            <label htmlFor={`checklist-${type}`} className="w-56">
              {DOCUMENT_TYPE_LABELS[type]}
            </label>
            <input
              name={`label.${type}`}
              aria-label={`Texto para el cliente: ${DOCUMENT_TYPE_LABELS[type]}`}
              defaultValue={checklist.get(type) ?? ''}
              placeholder="Texto que verá el cliente (opcional)"
              className="min-h-9 flex-1 rounded-md border border-border bg-surface px-2"
            />
          </div>
        ))}
      </fieldset>

      <SubmitButton>Guardar perfil</SubmitButton>
    </ActionForm>
  );
}

export function ArchiveButton({ id }: { id: string }) {
  return (
    <ActionForm action={archiveTaxProfileAction.bind(null, id)}>
      <SubmitButton variant="ghost" pendingLabel="Archivando…">
        Archivar este perfil
      </SubmitButton>
    </ActionForm>
  );
}
