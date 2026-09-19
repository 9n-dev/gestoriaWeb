'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { uploadFile, UploadError } from '@/components/uploader/upload-client';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { SelectField } from '@/components/ui/form';
import { DELIVERY_CATEGORY } from '@/lib/labels-documents';
import { parsePeriodValue, type PeriodOption } from '@/lib/periods';

export function DeliveryUpload({
  clientId,
  periods,
}: {
  clientId: string;
  periods: PeriodOption[];
}) {
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
          purpose: 'DELIVERY',
          clientId,
          title: String(data.get('title') ?? ''),
          category: String(data.get('category') ?? 'OTHER'),
          period: parsePeriodValue(String(data.get('period') ?? '')),
          visibleFrom: String(data.get('visibleFrom') ?? ''),
          requiresSignature: data.get('requiresSignature') === 'on',
        },
        { onProgress: (progress) => setState({ progress }), onFileId: () => {} },
      );
      form.reset();
      setState({
        success: 'Documento entregado. Avisaremos al cliente en cuanto pase el antivirus.',
      });
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
        <Field label="Título" name="title" id="delivery-title" required minLength={2} />
        <SelectField
          label="Categoría"
          name="category"
          id="delivery-category"
          defaultValue="FILED_FORM"
        >
          {Object.entries(DELIVERY_CATEGORY).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Periodo" name="period" id="delivery-period" defaultValue="">
          <option value="">Sin periodo</option>
          {periods.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
        <Field
          label="Visible desde (vacío = ya)"
          name="visibleFrom"
          id="delivery-visible"
          type="date"
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="delivery-file" className="text-sm font-medium">
            Archivo (PDF o imagen, máx. 20 MB)
          </label>
          <input
            id="delivery-file"
            name="file"
            type="file"
            required
            accept="application/pdf,image/jpeg,image/png"
            className="text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="requiresSignature" className="size-4" /> Pedir la conformidad
          del cliente (firma)
        </label>
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
        Entregar documento
      </Button>
    </form>
  );
}
