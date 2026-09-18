'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { uploadFile, UploadError } from '@/components/uploader/upload-client';
import { Field } from '@/components/ui/field';
import { SelectField } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { PERMANENT_CATEGORY } from '@/lib/labels-documents';

/** Single-file upload of a permanent document, through the same resumable pipeline as client uploads. */
export function PermanentUpload({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ progress?: number; error?: string; success?: string }>({});

  const submit = async (form: HTMLFormElement) => {
    const data = new FormData(form);
    const file = data.get('file');
    if (!(file instanceof File) || file.size === 0) return setState({ error: 'Elige un archivo.' });
    setState({ progress: 0 });
    try {
      await uploadFile(
        file,
        {
          purpose: 'PERMANENT_DOCUMENT',
          clientId,
          title: String(data.get('title') ?? ''),
          category: String(data.get('category') ?? 'OTHER'),
          expiresAt: String(data.get('expiresAt') ?? ''),
        },
        { onProgress: (progress) => setState({ progress }), onFileId: () => {} },
      );
      form.reset();
      setState({ success: 'Documento guardado.' });
      router.refresh();
    } catch (error) {
      setState({
        error: error instanceof UploadError ? error.message : 'No se ha podido subir el archivo.',
      });
    }
  };

  return (
    <form
      className="flex max-w-2xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(event.currentTarget);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Título" name="title" required minLength={2} />
        <SelectField label="Categoría" name="category" defaultValue="OTHER">
          {Object.entries(PERMANENT_CATEGORY).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <Field label="Caduca el (opcional)" name="expiresAt" type="date" />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="permanent-file" className="text-sm font-medium">
            Archivo (PDF o imagen, máx. 20 MB)
          </label>
          <input
            id="permanent-file"
            name="file"
            type="file"
            required
            accept="application/pdf,image/jpeg,image/png,image/heic"
            className="text-sm"
          />
        </div>
      </div>
      <div aria-live="polite" className="text-sm empty:hidden">
        {state.progress !== undefined && (
          <progress
            value={state.progress}
            max={1}
            aria-label="Progreso de la subida"
            className="h-1.5 w-full"
          />
        )}
        {state.error && <p className="text-danger">{state.error}</p>}
        {state.success && <p className="text-accent">{state.success}</p>}
      </div>
      <Button
        type="submit"
        variant="secondary"
        className="self-start"
        disabled={state.progress !== undefined}
      >
        Añadir documento
      </Button>
    </form>
  );
}
