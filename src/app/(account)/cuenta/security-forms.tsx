'use client';

import { useActionState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import type { ActionState } from '@/lib/action';
import { disableTwoFactorAction } from '@/app/(auth)/acceso/2fa/actions';
import { revokeOtherSessionsAction, revokeSessionAction } from './actions';

export function DisableTwoFactorForm() {
  const [state, action, pending] = useActionState(disableTwoFactorAction, {} as ActionState);
  return (
    <form action={action} className="flex max-w-sm flex-col gap-3">
      <Field
        label="Código actual, para desactivarla"
        name="code"
        id="disable-2fa-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
      />
      <p aria-live="polite" className="min-h-5 text-sm">
        {state.error && <span className="text-danger">{state.error}</span>}
        {state.success}
      </p>
      <Button type="submit" variant="secondary" disabled={pending}>
        Desactivar
      </Button>
    </form>
  );
}

export function RevokeSessionButton({ sessionId }: { sessionId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="secondary"
      disabled={pending}
      onClick={() => start(() => revokeSessionAction(sessionId))}
    >
      Cerrar sesión
    </Button>
  );
}

export function RevokeOthersButton() {
  const [pending, start] = useTransition();
  return (
    <div>
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() => start(() => revokeOtherSessionsAction())}
      >
        Cerrar las demás sesiones
      </Button>
    </div>
  );
}
