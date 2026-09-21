'use client';

import type { DocumentSource, DocumentStatus, DocumentType, FileStatus } from '@prisma/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Field } from '@/components/ui/field';
import { ActionForm, SelectField, SubmitButton } from '@/components/ui/form';
import { DOCUMENT_SOURCE, DOCUMENT_STATUS, fileStatusNote } from '@/lib/labels-documents';
import type { PeriodOption } from '@/lib/periods';
import { DOCUMENT_TYPE_LABELS } from '@/modules/clients/tax-profiles/labels';
import type { InboxFilters } from '@/modules/documents/service';
import {
  bookAction,
  confirmAction,
  reextractAction,
  deleteViewAction,
  duplicateAction,
  rejectAction,
  reopenAction,
  saveFieldsAction,
  saveViewAction,
} from './actions';
import { filtersToQuery } from './filters';

export type InboxDocument = {
  id: string;
  status: DocumentStatus;
  type: DocumentType;
  source: DocumentSource;
  createdAt: string;
  clientName: string;
  uploadedBy: string | null;
  fileId: string;
  fileName: string;
  mimeType: string;
  fileStatus: FileStatus;
  period: string;
  duplicateOfId: string | null;
  confirmed: boolean;
  extraction: 'NOT_APPLICABLE' | 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';
  confidence: number | null;
  rejectionReason: string | null;
  fields: Record<
    | 'supplierName'
    | 'supplierTaxId'
    | 'invoiceNumber'
    | 'invoiceDate'
    | 'taxBase'
    | 'vatRate'
    | 'vatAmount'
    | 'total',
    string
  >;
};

type Props = {
  documents: InboxDocument[];
  filters: Required<Pick<InboxFilters, 'statuses' | 'order'>> & InboxFilters;
  views: Array<{ id: string; name: string; filters: InboxFilters }>;
  reasons: string[];
  managers: Array<{ id: string; name: string }>;
  periods: PeriodOption[];
};

const SHORTCUTS = [
  ['J / K', 'Siguiente / anterior'],
  ['B', 'Contabilizar'],
  ['R', 'Rechazar'],
  ['D', 'Marcar como duplicado'],
  ['E', 'Editar campos'],
  ['L', 'Leer de nuevo con IA'],
  ['Enter', 'Confirmar datos'],
  ['Esc', 'Salir del formulario'],
] as const;

const OPEN_STATUSES: DocumentStatus[] = ['RECEIVED', 'IN_REVIEW'];
const dateTime = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Madrid',
});
const chip =
  'inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-surface-muted';

/**
 * Unified document inbox (§6.10). Fully operable from the keyboard: shortcuts act on the selected
 * row and are ignored while typing in a field. 50 documents in a row never need the mouse.
 */
export function Inbox({ documents, filters, views, reasons, managers, periods }: Props) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(documents[0]?.id ?? null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const rejectDialog = useRef<HTMLDialogElement>(null);
  const fieldsForm = useRef<HTMLDivElement>(null);

  const index = Math.max(
    0,
    documents.findIndex((document) => document.id === selectedId),
  );
  const selected = documents[index];

  const move = useCallback(
    (delta: number) => {
      const next = documents[Math.min(documents.length - 1, Math.max(0, index + delta))];
      if (next) setSelectedId(next.id);
    },
    [documents, index],
  );

  // Keeps the selected row in view while moving with J/K.
  useEffect(() => {
    if (selectedId)
      document.getElementById(`row-${selectedId}`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const run = useCallback(
    (action: () => Promise<{ error?: string; success?: string }>) => {
      // After closing a document the selection falls on the one that takes its place.
      const fallback = documents[index + 1]?.id ?? documents[index - 1]?.id ?? null;
      startTransition(async () => {
        const result = await action();
        setMessage({ text: result.error ?? result.success ?? '', error: Boolean(result.error) });
        if (!result.error) {
          setSelectedId((current) =>
            documents.some((d) => d.id === current) ? (fallback ?? current) : current,
          );
          router.refresh();
        }
      });
    },
    [documents, index, router],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (event.key === 'Escape' && typing && !rejectDialog.current?.open) {
        target.blur();
        return;
      }
      if (
        typing ||
        rejectDialog.current?.open ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        !selected
      )
        return;

      const key = event.key.toLowerCase();
      const ready = selected.fileStatus === 'CLEAN' && !pending;
      if (key === 'j') move(1);
      else if (key === 'k') move(-1);
      else if (key === 'b' && ready) run(() => bookAction(selected.id));
      else if (key === 'd' && ready) run(() => duplicateAction(selected.id));
      else if (key === 'enter' && ready) run(() => confirmAction(selected.id));
      else if (key === 'r' && ready) rejectDialog.current?.showModal();
      else if (key === 'l' && ready && ['DONE', 'FAILED'].includes(selected.extraction))
        run(() => reextractAction(selected.id));
      else if (key === 'e')
        fieldsForm.current?.querySelector<HTMLElement>('select, input')?.focus();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, pending, run, selected]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          Bandeja{' '}
          <span className="text-base font-normal text-fg-muted">
            · {documents.length} documentos
          </span>
        </h1>
        <details className="relative text-sm">
          <summary className={`${chip} cursor-pointer`}>Atajos de teclado</summary>
          <dl className="absolute right-0 z-10 mt-1 grid w-72 grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-border bg-surface p-3 shadow-lg">
            {SHORTCUTS.map(([keys, label]) => (
              <div key={keys} className="contents">
                <dt>
                  <kbd className="rounded border border-border px-1.5 font-mono text-xs">
                    {keys}
                  </kbd>
                </dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>

      <Filters filters={filters} views={views} managers={managers} onMessage={setMessage} />

      <p
        aria-live="polite"
        className={`min-h-5 text-sm ${message?.error ? 'text-danger' : 'text-accent'}`}
      >
        {message?.text}
      </p>

      {documents.length === 0 ? (
        <p className="text-fg-muted">No hay documentos con estos filtros. ¡Bandeja al día!</p>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="max-h-[75vh] overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse text-left text-xs">
              <caption className="sr-only">
                Documentos por procesar. Usa J y K para moverte.
              </caption>
              <thead className="sticky top-0 bg-surface-muted">
                <tr>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Cliente
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Archivo
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Tipo
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Recibido
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => (
                  <tr
                    key={document.id}
                    id={`row-${document.id}`}
                    aria-selected={document.id === selected?.id}
                    onClick={() => setSelectedId(document.id)}
                    className={`cursor-pointer border-t border-border ${
                      document.id === selected?.id
                        ? 'bg-primary/10 outline outline-2 -outline-offset-2 outline-primary'
                        : ''
                    }`}
                  >
                    <td className="max-w-40 truncate px-2 py-1.5">{document.clientName}</td>
                    <td className="max-w-48 truncate px-2 py-1.5">
                      <button
                        type="button"
                        className="max-w-full truncate text-left"
                        onClick={() => setSelectedId(document.id)}
                      >
                        {document.fileName}
                      </button>
                    </td>
                    <td className="px-2 py-1.5">{DOCUMENT_TYPE_LABELS[document.type]}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {dateTime.format(new Date(document.createdAt))}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {fileStatusNote(document.fileStatus) ?? DOCUMENT_STATUS[document.status]}
                      {document.duplicateOfId &&
                        document.status !== 'DUPLICATE' &&
                        ' · ¿duplicado?'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected && (
            <section aria-label={`Documento ${selected.fileName}`} className="flex flex-col gap-3">
              <Preview document={selected} />
              <p className="text-sm text-fg-muted">
                {selected.clientName} · {DOCUMENT_SOURCE[selected.source]}
                {selected.uploadedBy && ` · ${selected.uploadedBy}`} ·{' '}
                <a href={`/api/files/${selected.fileId}`} className="underline">
                  Descargar
                </a>
              </p>
              {selected.duplicateOfId && (
                <p className="rounded-md bg-surface-muted p-2 text-sm">
                  {selected.status === 'DUPLICATE'
                    ? 'Es un duplicado de otro documento.'
                    : 'Puede ser un duplicado: coincide con otro documento. Pulsa D para confirmarlo.'}
                </p>
              )}
              <ExtractionNote document={selected} />
              {selected.rejectionReason && (
                <p className="text-sm">Motivo del rechazo: {selected.rejectionReason}</p>
              )}

              <div className="flex flex-wrap gap-2">
                {OPEN_STATUSES.includes(selected.status) ? (
                  <>
                    <ActionButton
                      label="Contabilizar"
                      shortcut="B"
                      disabled={pending || selected.fileStatus !== 'CLEAN'}
                      onClick={() => run(() => bookAction(selected.id))}
                    />
                    <ActionButton
                      label="Rechazar"
                      shortcut="R"
                      disabled={pending || selected.fileStatus !== 'CLEAN'}
                      onClick={() => rejectDialog.current?.showModal()}
                    />
                    <ActionButton
                      label="Duplicado"
                      shortcut="D"
                      disabled={pending || selected.fileStatus !== 'CLEAN'}
                      onClick={() => run(() => duplicateAction(selected.id))}
                    />
                    <ActionButton
                      label={selected.confirmed ? 'Datos confirmados' : 'Confirmar datos'}
                      shortcut="Enter"
                      disabled={pending || selected.confirmed || selected.fileStatus !== 'CLEAN'}
                      onClick={() => run(() => confirmAction(selected.id))}
                    />
                    {(selected.extraction === 'DONE' || selected.extraction === 'FAILED') && (
                      <ActionButton
                        label="Leer de nuevo"
                        shortcut="L"
                        disabled={pending || selected.fileStatus !== 'CLEAN'}
                        onClick={() => run(() => reextractAction(selected.id))}
                      />
                    )}
                  </>
                ) : (
                  <ActionButton
                    label="Devolver a la bandeja"
                    disabled={pending}
                    onClick={() => run(() => reopenAction(selected.id))}
                  />
                )}
              </div>

              <div ref={fieldsForm}>
                {/* key: a fresh form, with that document's values, for every selection */}
                <FieldsForm key={selected.id} document={selected} periods={periods} />
              </div>
            </section>
          )}
        </div>
      )}

      <RejectDialog
        dialog={rejectDialog}
        reasons={reasons}
        fileName={selected?.fileName ?? ''}
        onReject={(reason, note) => selected && run(() => rejectAction(selected.id, reason, note))}
      />
    </div>
  );
}

/** Where the proposed fields come from and how much to trust them (§6.4). */
function ExtractionNote({ document }: { document: InboxDocument }) {
  if (document.confirmed || document.extraction === 'NOT_APPLICABLE') return null;
  if (document.extraction === 'FAILED') {
    return (
      <p className="rounded-md bg-surface-muted p-2 text-sm">
        No hemos podido leer los datos automáticamente: rellénalos a mano (E).
      </p>
    );
  }
  if (document.extraction !== 'DONE') {
    return <p className="text-sm text-fg-muted">Leyendo los datos del documento…</p>;
  }
  const confidence = document.confidence ?? 0;
  const level = confidence >= 0.85 ? 'alta' : confidence >= 0.6 ? 'media' : 'baja';
  return (
    <p
      className={`rounded-md p-2 text-sm ${level === 'baja' ? 'bg-surface-muted font-medium' : 'text-fg-muted'}`}
    >
      Datos propuestos automáticamente · confianza {level} ({Math.round(confidence * 100)} %).
      Revísalos y pulsa Enter para confirmarlos, o E para corregirlos.
    </p>
  );
}

function ActionButton({
  label,
  shortcut,
  ...props
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick(): void;
}) {
  return (
    <button type="button" className={`${chip} disabled:opacity-50`} {...props}>
      {label}
      {shortcut && (
        <kbd className="ml-2 rounded border border-border px-1 font-mono text-xs text-fg-muted">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}

function Preview({ document }: { document: InboxDocument }) {
  const frame = 'h-[45vh] w-full rounded-md border border-border bg-surface-muted';
  if (document.fileStatus !== 'CLEAN') {
    return (
      <div className={`${frame} flex items-center justify-center text-sm text-fg-muted`}>
        {document.fileStatus === 'INFECTED'
          ? 'Archivo bloqueado por el antivirus.'
          : 'Analizando el archivo… Estará listo en unos segundos.'}
      </div>
    );
  }
  const src = `/api/files/${document.fileId}?inline`;
  return document.mimeType === 'application/pdf' ? (
    <iframe
      key={document.fileId}
      src={src}
      title={`Vista previa de ${document.fileName}`}
      className={frame}
    />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL behind our own route
    <img
      key={document.fileId}
      src={src}
      alt={`Vista previa de ${document.fileName}`}
      className={`${frame} object-contain`}
    />
  );
}

function FieldsForm({ document, periods }: { document: InboxDocument; periods: PeriodOption[] }) {
  const { fields } = document;
  const knownPeriod =
    !document.period || periods.some((option) => option.value === document.period);
  return (
    <ActionForm action={saveFieldsAction.bind(null, document.id)} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Tipo" name="type" defaultValue={document.type}>
          {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Periodo" name="period" defaultValue={document.period}>
          <option value="">Sin periodo</option>
          {!knownPeriod && <option value={document.period}>{document.period}</option>}
          {periods.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
        <Field label="Proveedor o cliente" name="supplierName" defaultValue={fields.supplierName} />
        <Field label="NIF" name="supplierTaxId" defaultValue={fields.supplierTaxId} />
        <Field label="N.º de factura" name="invoiceNumber" defaultValue={fields.invoiceNumber} />
        <Field label="Fecha" name="invoiceDate" type="date" defaultValue={fields.invoiceDate} />
        <Field
          label="Base imponible"
          name="taxBase"
          inputMode="decimal"
          defaultValue={fields.taxBase}
        />
        <Field label="% IVA" name="vatRate" inputMode="decimal" defaultValue={fields.vatRate} />
        <Field
          label="Cuota de IVA"
          name="vatAmount"
          inputMode="decimal"
          defaultValue={fields.vatAmount}
        />
        <Field label="Total" name="total" inputMode="decimal" defaultValue={fields.total} />
      </div>
      <SubmitButton variant="secondary">Guardar datos</SubmitButton>
    </ActionForm>
  );
}

function RejectDialog({
  dialog,
  reasons,
  fileName,
  onReject,
}: {
  dialog: React.RefObject<HTMLDialogElement | null>;
  reasons: string[];
  fileName: string;
  onReject(reason: string, note: string): void;
}) {
  return (
    // Native <dialog>: focus trap, Esc to close and focus return come with the platform.
    <dialog
      ref={dialog}
      aria-labelledby="reject-title"
      className="m-auto w-full max-w-md rounded-lg border border-border bg-surface p-5 text-fg backdrop:bg-black/50"
    >
      <form
        method="dialog"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          const data = new FormData(event.currentTarget);
          onReject(String(data.get('reason')), String(data.get('note') ?? ''));
          event.currentTarget.reset();
        }}
      >
        <h2 id="reject-title" className="text-lg font-semibold">
          Rechazar «{fileName}»
        </h2>
        <SelectField label="Motivo" name="reason" autoFocus required>
          {reasons.map((reason) => (
            <option key={reason}>{reason}</option>
          ))}
        </SelectField>
        <Field label="Nota para el cliente (opcional)" name="note" />
        <p className="text-sm text-fg-muted">El cliente recibirá un aviso al momento.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className={chip} onClick={() => dialog.current?.close()}>
            Cancelar
          </button>
          <button type="submit" className={`${chip} border-0 bg-primary text-primary-fg`}>
            Rechazar y avisar
          </button>
        </div>
      </form>
    </dialog>
  );
}

function Filters({
  filters,
  views,
  managers,
  onMessage,
}: Pick<Props, 'filters' | 'views' | 'managers'> & {
  onMessage(message: { text: string; error: boolean }): void;
}) {
  const router = useRouter();
  const save = async (formData: FormData) => {
    const result = await saveViewAction(String(formData.get('name') ?? ''), filters);
    onMessage({ text: result.error ?? result.success ?? '', error: Boolean(result.error) });
    router.refresh();
  };
  const remove = async (id: string) => {
    const result = await deleteViewAction(id);
    onMessage({ text: result.error ?? result.success ?? '', error: Boolean(result.error) });
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3 text-sm">
      <form method="get" className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
          <legend className="mb-1 font-medium">Estado</legend>
          {(Object.keys(DOCUMENT_STATUS) as DocumentStatus[]).map((status) => (
            <label key={status} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                name="estado"
                value={status}
                defaultChecked={filters.statuses.includes(status)}
                className="size-4"
              />
              {DOCUMENT_STATUS[status]}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1 font-medium">
          Tipo
          <select
            name="tipo"
            defaultValue={filters.type ?? ''}
            className="min-h-9 rounded-md border border-border bg-surface px-2 font-normal"
          >
            <option value="">Todos</option>
            {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {managers.length > 0 && (
          <label className="flex flex-col gap-1 font-medium">
            Gestor
            <select
              name="gestor"
              defaultValue={filters.managerId ?? ''}
              className="min-h-9 rounded-md border border-border bg-surface px-2 font-normal"
            >
              <option value="">Todos</option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {manager.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 font-medium">
          Orden
          <select
            name="orden"
            defaultValue={filters.order}
            className="min-h-9 rounded-md border border-border bg-surface px-2 font-normal"
          >
            <option value="oldest">Más antiguos primero</option>
            <option value="newest">Más recientes primero</option>
          </select>
        </label>
        <button type="submit" className={chip}>
          Filtrar
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <span className="font-medium">Vistas:</span>
        <Link href="/panel/bandeja" className={chip}>
          Pendientes
        </Link>
        {views.map((view) => (
          <span key={view.id} className="inline-flex items-center">
            <Link
              href={`/panel/bandeja?${filtersToQuery(view.filters)}`}
              className={`${chip} rounded-r-none`}
            >
              {view.name}
            </Link>
            <button
              type="button"
              aria-label={`Eliminar la vista ${view.name}`}
              onClick={() => remove(view.id)}
              className={`${chip} rounded-l-none border-l-0 px-2`}
            >
              ×
            </button>
          </span>
        ))}
        <form action={save} className="ml-auto flex items-center gap-2">
          <label htmlFor="view-name" className="sr-only">
            Nombre de la vista
          </label>
          <input
            id="view-name"
            name="name"
            required
            maxLength={60}
            placeholder="Guardar filtros como…"
            className="min-h-9 rounded-md border border-border bg-surface px-2"
          />
          <button type="submit" className={chip}>
            Guardar vista
          </button>
        </form>
      </div>
    </div>
  );
}
