'use client';

import { signDeliveryAction } from '@/app/actions/deliveries';
import { ActionForm, SubmitButton } from '@/components/ui/form';

export function SignForm({ id }: { id: string }) {
  return (
    <ActionForm
      action={signDeliveryAction.bind(null, id)}
      className="flex flex-col gap-3 rounded-md border border-border p-4"
    >
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="accepted" required className="mt-0.5 size-5" />
        <span>He leído el documento y estoy conforme con su contenido.</span>
      </label>
      <p className="text-xs text-fg-muted">
        Al firmar guardamos la fecha y hora, tu dirección IP, tu navegador y la huella digital del
        documento, y generamos un certificado que podrás descargar.
      </p>
      <SubmitButton pendingLabel="Firmando…">Firmar</SubmitButton>
    </ActionForm>
  );
}
