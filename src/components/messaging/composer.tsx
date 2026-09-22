'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { renderTemplateAction, sendMessageAction } from '@/app/actions/messaging';
import { queuedUpload } from '@/components/uploader/queued-upload';
import { UploadError } from '@/components/uploader/upload-client';
import { Button } from '@/components/ui/button';

type Option = { id: string; name: string };

/**
 * Message box. The message is sent first and its files are then attached through the resumable
 * upload pipeline. Staff also get canned replies and, in internal threads, a mention helper.
 */
export function Composer({
  threadId,
  clientId,
  templates = [],
  colleagues = [],
}: {
  threadId: string;
  clientId: string;
  templates?: Option[];
  colleagues?: Option[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);

  const insert = (text: string) => {
    const field = textarea.current;
    if (!field) return;
    field.value = field.value ? `${field.value.trimEnd()}\n${text}` : text;
    field.focus();
  };

  const submit = () =>
    startTransition(async () => {
      const data = new FormData(form.current!);
      const result = await sendMessageAction(threadId, String(data.get('body') ?? ''));
      if (result.error || !result.data) return setError(result.error ?? 'No se ha podido enviar.');
      setError('');
      try {
        for (const file of data.getAll('files')) {
          if (file instanceof File && file.size > 0) {
            await queuedUpload(
              file,
              { purpose: 'MESSAGE_ATTACHMENT', clientId, messageId: result.data },
              { onProgress: () => {}, onFileId: () => {} },
            );
          }
        }
      } catch (uploadError) {
        setError(
          `Mensaje enviado, pero un adjunto ha fallado: ${uploadError instanceof UploadError ? uploadError.message : 'error de conexión'}`,
        );
      }
      form.current?.reset();
      router.refresh();
    });

  return (
    <form
      ref={form}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor="body" className="text-sm font-medium">
        Tu mensaje
      </label>
      <textarea
        id="body"
        name="body"
        ref={textarea}
        rows={4}
        required
        className="rounded-md border border-border bg-surface px-3 py-2 text-base"
      />

      {(templates.length > 0 || colleagues.length > 0) && (
        <div className="flex flex-wrap gap-3 text-sm">
          {templates.length > 0 && (
            <label className="flex items-center gap-2">
              Plantilla
              <select
                defaultValue=""
                className="min-h-9 rounded-md border border-border bg-surface px-2"
                onChange={async (event) => {
                  const id = event.target.value;
                  event.target.value = '';
                  if (!id) return;
                  const rendered = await renderTemplateAction(id, clientId);
                  if (rendered.data) insert(rendered.data);
                  else setError(rendered.error ?? '');
                }}
              >
                <option value="">Insertar…</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {colleagues.length > 0 && (
            <label className="flex items-center gap-2">
              Mencionar
              <select
                defaultValue=""
                className="min-h-9 rounded-md border border-border bg-surface px-2"
                onChange={(event) => {
                  if (event.target.value) insert(`@${event.target.value} `);
                  event.target.value = '';
                }}
              >
                <option value="">Compañero…</option>
                {colleagues.map((person) => (
                  <option key={person.id} value={person.name}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5 text-sm">
        <label htmlFor="files" className="font-medium">
          Adjuntos (fotos o PDF, máx. 20 MB)
        </label>
        <input
          id="files"
          name="files"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/heic,application/pdf"
        />
      </div>
      <p aria-live="polite" className="text-sm text-danger empty:hidden">
        {error}
      </p>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Enviando…' : 'Enviar'}
      </Button>
    </form>
  );
}
