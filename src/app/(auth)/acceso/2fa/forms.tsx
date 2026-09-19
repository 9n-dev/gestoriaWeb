'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import type { ActionState } from '@/lib/action';
import { challengeAction, confirmEnrolmentAction } from './actions';

const codeField = {
  name: 'code',
  inputMode: 'numeric',
  autoComplete: 'one-time-code',
  required: true,
  autoFocus: true,
} as const;

export function ChallengeForm() {
  const [state, action, pending] = useActionState(challengeAction, {} as ActionState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field
        label="Código de verificación"
        aria-describedby="code-hint"
        {...codeField}
        inputMode="text"
      />
      <p id="code-hint" className="text-sm text-fg-muted">
        Los 6 dígitos de tu aplicación, o uno de tus códigos de recuperación.
      </p>
      <p aria-live="polite" className="min-h-5 text-sm text-danger">
        {state.error}
      </p>
      <Button type="submit" disabled={pending}>
        {pending ? 'Comprobando…' : 'Continuar'}
      </Button>
    </form>
  );
}

export function EnrolmentForm() {
  const [state, action, pending] = useActionState(
    confirmEnrolmentAction,
    {} as ActionState<string[]>,
  );

  if (state.data) {
    return (
      <section aria-labelledby="recovery-title" className="flex flex-col gap-4">
        <h2 id="recovery-title" className="text-lg font-semibold">
          Guarda tus códigos de recuperación
        </h2>
        <p className="text-sm text-fg-muted">
          Cada código sirve una sola vez para entrar si pierdes el móvil. No volveremos a
          mostrarlos: guárdalos en un lugar seguro.
        </p>
        <ul className="grid grid-cols-2 gap-2 rounded-md bg-surface-muted p-4 font-mono text-sm">
          {state.data.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <Link href="/" className="underline">
          Ya los he guardado, continuar
        </Link>
      </section>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Código de 6 dígitos que muestra la aplicación" {...codeField} />
      <p aria-live="polite" className="min-h-5 text-sm text-danger">
        {state.error}
      </p>
      <Button type="submit" disabled={pending}>
        {pending ? 'Comprobando…' : 'Activar'}
      </Button>
    </form>
  );
}
