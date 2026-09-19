'use client';

import { useState, useTransition } from 'react';
import { LightBadge } from '@/components/light-badge';
import { Field } from '@/components/ui/field';
import { ActionForm, SelectField, SubmitButton } from '@/components/ui/form';
import { DOCUMENT_TYPE_LABELS } from '@/modules/clients/tax-profiles/labels';
import type { Light, PeriodRef } from '@/modules/checklists/light';
import {
  addChecklistItemAction,
  removeChecklistItemAction,
  setPeriodClosedAction,
  toggleChecklistItemAction,
} from './workflow-actions';

type Item = {
  id: string;
  label: string;
  fulfilled: boolean;
  manual: boolean;
  source: 'AUTO' | 'MANUAL';
};

const small =
  'min-h-9 rounded-md border border-border px-3 text-sm hover:bg-surface-muted disabled:opacity-50';

export function ChecklistSection({
  clientId,
  period,
  periodText,
  deadlineText,
  light,
  closed,
  items,
  canManage,
}: {
  clientId: string;
  period: PeriodRef;
  periodText: string;
  deadlineText: string;
  light: Light;
  closed: boolean;
  items: Item[];
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const run = (action: () => Promise<{ error?: string; success?: string }>) =>
    startTransition(async () => {
      const result = await action();
      setMessage(result.error ?? result.success ?? '');
    });
  const missing = items.filter((item) => !item.fulfilled).length;

  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-x-3 text-sm">
        <LightBadge
          light={light}
          text={missing ? `Faltan ${missing} de ${items.length}` : 'Todo entregado'}
        />
        <span className="text-fg-muted">
          {periodText} · límite {deadlineText}
          {closed && ' · documentación cerrada'}
        </span>
      </p>

      <ul className="flex flex-col text-sm">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-x-4 border-b border-border py-1.5"
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4"
                checked={item.fulfilled}
                disabled={!canManage || pending || (item.fulfilled && !item.manual)}
                onChange={(event) =>
                  run(() => toggleChecklistItemAction(clientId, item.id, event.target.checked))
                }
              />
              {item.label}
              <span className="text-fg-muted">
                {item.fulfilled ? (item.manual ? '· marcado a mano' : '· recibido') : ''}
                {item.source === 'MANUAL' && ' · añadido por la gestoría'}
              </span>
            </label>
            {canManage && (
              <button
                type="button"
                className={small}
                disabled={pending}
                onClick={() => run(() => removeChecklistItemAction(clientId, item.id))}
              >
                Quitar<span className="sr-only"> {item.label}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      <p aria-live="polite" className="text-sm text-accent empty:hidden">
        {message}
      </p>

      {canManage && (
        <>
          <ActionForm
            action={addChecklistItemAction.bind(null, clientId, period)}
            className="flex flex-wrap items-end gap-3"
          >
            <SelectField label="Pedir también" name="documentType" defaultValue="OTHER">
              {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
            <Field label="Texto para el cliente" name="label" required minLength={2} />
            <SubmitButton variant="secondary">Añadir</SubmitButton>
          </ActionForm>
          <button
            type="button"
            className={`${small} self-start`}
            disabled={pending}
            onClick={() => run(() => setPeriodClosedAction(clientId, period, !closed))}
          >
            {closed ? 'Reabrir la documentación' : 'Cerrar la documentación del periodo'}
          </button>
        </>
      )}
    </div>
  );
}
