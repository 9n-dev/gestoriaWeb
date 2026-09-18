'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { magicLinkRequestAction, passwordLoginAction, type LoginState } from './actions';

const initial: LoginState = {};

function Feedback({ state }: { state: LoginState }) {
  return (
    <div aria-live="polite" className="min-h-5 text-sm">
      {state.error && <p className="text-danger">{state.error}</p>}
      {state.info && <p>{state.info}</p>}
    </div>
  );
}

export function LoginForm() {
  const [passwordState, passwordAction, passwordPending] = useActionState(
    passwordLoginAction,
    initial,
  );
  const [linkState, linkAction, linkPending] = useActionState(magicLinkRequestAction, initial);

  return (
    <div className="flex flex-col gap-8">
      <form action={passwordAction} className="flex flex-col gap-4">
        <Field
          label="Correo electrónico"
          name="email"
          type="email"
          autoComplete="username"
          required
        />
        <Field
          label="Contraseña"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <Feedback state={passwordState} />
        <Button type="submit" disabled={passwordPending}>
          {passwordPending ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>

      <form action={linkAction} className="flex flex-col gap-4 border-t border-border pt-6">
        <h2 className="text-base font-semibold">¿Prefieres entrar sin contraseña?</h2>
        <Field
          label="Correo electrónico"
          name="email"
          id="magic-link-email"
          type="email"
          autoComplete="email"
          required
        />
        <Feedback state={linkState} />
        <Button type="submit" variant="secondary" disabled={linkPending}>
          {linkPending ? 'Enviando…' : 'Enviarme un enlace de acceso'}
        </Button>
      </form>
    </div>
  );
}
