'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { magicLinkLoginAction, type LoginState } from '../actions';

const initial: LoginState = {};

export function ConfirmForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(magicLinkLoginAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <div aria-live="polite" className="min-h-5 text-sm text-danger">
        {state.error}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Entrando…' : 'Entrar'}
      </Button>
      {state.error && (
        <Link href="/acceso" className="text-center text-sm underline">
          Pedir un enlace nuevo
        </Link>
      )}
    </form>
  );
}
