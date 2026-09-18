'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { DOCUMENT_TYPE_LABELS } from '@/modules/clients/tax-profiles/labels';
import { parsePeriodValue, type PeriodOption } from '@/lib/periods';
import { resumeUpload, uploadFile, UploadError, type UploadMeta } from './upload-client';

const ACCEPT = 'image/jpeg,image/png,image/heic,image/heif,application/pdf,.heic,.heif';
const MAX_BYTES = 20 * 1024 * 1024;
const CONCURRENCY = 3;

type Item = {
  key: number;
  file: File;
  fileId?: string;
  progress: number;
  state: 'waiting' | 'uploading' | 'done' | 'error';
  error?: string;
  canRetry?: boolean;
};

const control = 'min-h-11 rounded-md border border-border bg-surface px-3 text-base';
const bigButton =
  'inline-flex min-h-14 flex-1 cursor-pointer items-center justify-center rounded-md px-4 text-base font-medium focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary';

/**
 * Multi-file uploader for the client portal (§6.3). Choosing files starts the upload at once:
 * home → "Subir documentos" → camera or gallery is the whole flow.
 */
export function Uploader({
  clients,
  periods,
}: {
  clients: Array<{ id: string; name: string }>;
  periods: PeriodOption[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [documentType, setDocumentType] = useState('RECEIVED_INVOICE');
  const [period, setPeriod] = useState(periods[0]?.value ?? '');
  const nextKey = useRef(0);
  const active = useRef(0);
  const queue = useRef<Item[]>([]);

  const patch = (key: number, changes: Partial<Item>) =>
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...changes } : item)),
    );

  const pump = useCallback(
    (meta: UploadMeta) => {
      while (active.current < CONCURRENCY && queue.current.length > 0) {
        const item = queue.current.shift()!;
        active.current++;
        patch(item.key, { state: 'uploading', error: undefined });
        const handlers = {
          onProgress: (progress: number) => patch(item.key, { progress }),
          onFileId: (fileId: string) => {
            item.fileId = fileId;
            patch(item.key, { fileId });
          },
        };
        (item.fileId
          ? resumeUpload(item.file, item.fileId, handlers)
          : uploadFile(item.file, meta, handlers)
        )
          .then(() => {
            patch(item.key, { state: 'done', progress: 1 });
            router.refresh();
          })
          .catch((error: unknown) =>
            patch(item.key, {
              state: 'error',
              error: error instanceof UploadError ? error.message : 'Se ha cortado la conexión.',
              canRetry: !(error instanceof UploadError && error.permanent),
            }),
          )
          .finally(() => {
            active.current--;
            pump(meta);
          });
      }
    },
    [router],
  );

  const meta = (): UploadMeta => ({
    purpose: 'DOCUMENT',
    clientId,
    documentType,
    period: parsePeriodValue(period),
  });

  const add = (files: FileList | null) => {
    const added: Item[] = [...(files ?? [])].map((file) => ({
      key: nextKey.current++,
      file,
      progress: 0,
      ...(file.size > MAX_BYTES
        ? { state: 'error' as const, error: 'Supera el máximo de 20 MB.' }
        : { state: 'waiting' as const }),
    }));
    setItems((current) => [...added, ...current]);
    queue.current.push(...added.filter((item) => item.state === 'waiting'));
    pump(meta());
  };

  const retry = (item: Item) => {
    queue.current.push(item);
    pump(meta());
  };

  const pending = items.filter(
    (item) => item.state === 'waiting' || item.state === 'uploading',
  ).length;
  const done = items.filter((item) => item.state === 'done').length;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        {clients.length > 1 && (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            ¿De quién son?
            <select
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              className={control}
            >
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          ¿Qué son?
          <select
            value={documentType}
            onChange={(event) => setDocumentType(event.target.value)}
            className={control}
          >
            {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          ¿De qué periodo?
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            className={control}
          >
            {periods.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            <option value="">No lo sé</option>
          </select>
        </label>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <label className={`${bigButton} bg-primary text-primary-fg`}>
          Hacer una foto
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(event) => {
              add(event.target.files);
              event.target.value = '';
            }}
          />
        </label>
        <label className={`${bigButton} border border-border`}>
          Elegir archivos
          <input
            type="file"
            accept={ACCEPT}
            multiple
            className="sr-only"
            data-testid="file-input"
            onChange={(event) => {
              add(event.target.files);
              event.target.value = '';
            }}
          />
        </label>
      </div>
      <p className="text-sm text-fg-muted">
        Fotos (JPG, PNG, HEIC) o PDF, hasta 20 MB cada uno. Puedes elegir varios a la vez.
      </p>

      <p aria-live="polite" className="text-sm font-medium">
        {items.length > 0 &&
          (pending > 0
            ? `Subiendo ${pending} de ${items.length}… No cierres esta página.`
            : `${done} de ${items.length} documentos enviados.`)}
      </p>

      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.key} className="rounded-md border border-border p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate">{item.file.name}</span>
              <span className={item.state === 'error' ? 'text-danger' : 'text-fg-muted'}>
                {item.state === 'waiting' && 'En cola'}
                {item.state === 'uploading' && `${Math.round(item.progress * 100)} %`}
                {item.state === 'done' && 'Enviado'}
                {item.state === 'error' && item.error}
              </span>
            </div>
            {(item.state === 'uploading' || item.state === 'waiting') && (
              <progress
                value={item.progress}
                max={1}
                aria-label={`Progreso de ${item.file.name}`}
                className="mt-2 h-1.5 w-full"
              />
            )}
            {item.state === 'error' && item.canRetry && (
              <button
                type="button"
                onClick={() => retry(item)}
                className="mt-2 min-h-9 rounded-md border border-border px-3"
              >
                Reintentar
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
