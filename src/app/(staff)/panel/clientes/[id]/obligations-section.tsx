'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { queuedUpload } from '@/components/uploader/queued-upload';
import { UploadError } from '@/components/uploader/upload-client';
import { Field } from '@/components/ui/field';
import { ActionForm, SelectField, SubmitButton } from '@/components/ui/form';
import type { PeriodOption } from '@/lib/periods';
import {
  createObligationAction,
  deleteObligationAction,
  fileObligationAction,
  reopenObligationAction,
  setEstimateAction,
  startObligationAction,
} from './workflow-actions';

export type ObligationItem = {
  id: string;
  model: string;
  modelName: string;
  periodText: string;
  dueText: string;
  relative: string;
  overdue: boolean;
  status: 'PENDING_DOCS' | 'IN_PROGRESS' | 'FILED';
  statusText: string;
  estimate: string;
  resultText: string;
  receiptFileId: string | null;
};

const small =
  'min-h-9 rounded-md border border-border px-3 text-sm hover:bg-surface-muted disabled:opacity-50';

export function ObligationsSection({
  clientId,
  obligations,
  canUpdate,
  models,
  periods,
}: {
  clientId: string;
  obligations: ObligationItem[];
  canUpdate: boolean;
  models: Array<{ model: string; name: string }>;
  periods: PeriodOption[];
}) {
  return (
    <div className="flex flex-col gap-3">
      {obligations.length === 0 ? (
        <p className="text-fg-muted">Asigna un perfil fiscal para generar sus obligaciones.</p>
      ) : (
        <ul className="flex flex-col">
          {obligations.map((obligation) => (
            <ObligationRow
              key={obligation.id}
              clientId={clientId}
              obligation={obligation}
              canUpdate={canUpdate}
            />
          ))}
        </ul>
      )}
      {canUpdate && (
        <details className="text-sm">
          <summary className="cursor-pointer underline">
            Añadir una obligación fuera del perfil
          </summary>
          <ActionForm
            action={createObligationAction.bind(null, clientId)}
            className="mt-3 flex flex-wrap items-end gap-3"
          >
            <SelectField label="Modelo" name="model">
              {models.map(({ model, name }) => (
                <option key={model} value={model}>
                  {model} · {name}
                </option>
              ))}
            </SelectField>
            <SelectField label="Periodo" name="period">
              {periods.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
            <SubmitButton variant="secondary">Añadir</SubmitButton>
          </ActionForm>
        </details>
      )}
    </div>
  );
}

function ObligationRow({
  clientId,
  obligation: o,
  canUpdate,
}: {
  clientId: string;
  obligation: ObligationItem;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const run = (action: () => Promise<{ error?: string; success?: string }>) =>
    startTransition(async () => {
      const result = await action();
      setMessage({ text: result.error ?? result.success ?? '', error: Boolean(result.error) });
    });

  /** Receipt first (same resumable pipeline as any upload), then the filing itself. */
  const file = (form: HTMLFormElement) =>
    startTransition(async () => {
      const data = new FormData(form);
      const receipt = data.get('receipt');
      try {
        if (receipt instanceof File && receipt.size > 0) {
          await queuedUpload(
            receipt,
            { purpose: 'OBLIGATION_RECEIPT', clientId, obligationId: o.id },
            { onProgress: () => {}, onFileId: () => {} },
          );
        }
      } catch (error) {
        setMessage({
          text:
            error instanceof UploadError ? error.message : 'No se ha podido subir el justificante.',
          error: true,
        });
        return;
      }
      const result = await fileObligationAction(clientId, o.id, {
        result: String(data.get('result') ?? ''),
        amount: String(data.get('amount') ?? ''),
        directDebit: data.get('directDebit') === 'on',
      });
      setMessage({ text: result.error ?? result.success ?? '', error: Boolean(result.error) });
      if (!result.error) router.refresh();
    });

  return (
    <li className="border-b border-border py-2 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <p>
          <span className="font-medium">{o.model}</span>{' '}
          <span className="text-fg-muted">{o.modelName}</span> · {o.periodText}
        </p>
        <p className={o.overdue ? 'font-medium text-danger' : ''}>
          {o.dueText} <span className="text-fg-muted">({o.relative})</span>
        </p>
      </div>
      <p className="text-fg-muted">
        {o.statusText}
        {o.resultText && ` · ${o.resultText}`}
        {o.status !== 'FILED' && o.estimate && ` · previsto ${o.estimate} €`}
        {o.receiptFileId && (
          <>
            {' · '}
            <a
              href={`/api/files/${o.receiptFileId}?inline`}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Justificante
            </a>
          </>
        )}
      </p>

      {canUpdate && (
        <div className="mt-2 flex flex-wrap items-start gap-2">
          {o.status === 'PENDING_DOCS' && (
            <>
              <button
                type="button"
                className={small}
                disabled={pending}
                onClick={() => run(() => startObligationAction(clientId, o.id))}
              >
                Empezar
              </button>
              <button
                type="button"
                className={small}
                disabled={pending}
                onClick={() => run(() => deleteObligationAction(clientId, o.id))}
              >
                Eliminar
              </button>
            </>
          )}
          {o.status === 'FILED' ? (
            <button
              type="button"
              className={small}
              disabled={pending}
              onClick={() => run(() => reopenObligationAction(clientId, o.id))}
            >
              Reabrir
            </button>
          ) : (
            <details className="w-full">
              <summary className={`${small} inline-flex cursor-pointer items-center`}>
                Marcar como presentada…
              </summary>
              <form
                className="mt-3 grid max-w-2xl gap-3 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  file(event.currentTarget);
                }}
              >
                <SelectField
                  label="Resultado"
                  name="result"
                  id={`result-${o.id}`}
                  defaultValue="TO_PAY"
                >
                  <option value="TO_PAY">A pagar</option>
                  <option value="TO_REFUND">A devolver</option>
                  <option value="ZERO">Sin importe (cero)</option>
                </SelectField>
                <Field
                  label="Importe (€)"
                  name="amount"
                  id={`amount-${o.id}`}
                  inputMode="decimal"
                />
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="directDebit" className="size-4" /> Domiciliado
                </label>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`receipt-${o.id}`} className="font-medium">
                    Justificante (PDF)
                  </label>
                  <input
                    id={`receipt-${o.id}`}
                    name="receipt"
                    type="file"
                    accept="application/pdf,image/jpeg,image/png"
                  />
                </div>
                <button
                  type="submit"
                  disabled={pending}
                  className={`${small} self-start border-0 bg-primary text-primary-fg`}
                >
                  {pending ? 'Guardando…' : 'Presentada: avisar al cliente'}
                </button>
              </form>
              <ActionForm
                action={setEstimateAction.bind(null, clientId, o.id)}
                className="mt-3 flex flex-wrap items-end gap-3"
              >
                <Field
                  label="Importe previsto (€), visible para el cliente"
                  name="estimate"
                  id={`estimate-${o.id}`}
                  inputMode="decimal"
                  defaultValue={o.estimate}
                />
                <SubmitButton variant="secondary">Guardar previsión</SubmitButton>
              </ActionForm>
            </details>
          )}
        </div>
      )}
      <p
        aria-live="polite"
        className={`mt-1 empty:hidden ${message?.error ? 'text-danger' : 'text-accent'}`}
      >
        {message?.text}
      </p>
    </li>
  );
}
