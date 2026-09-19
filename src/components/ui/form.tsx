'use client';

import {
  useActionState,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from './button';

export type FormState = { error?: string; success?: string; data?: unknown };
type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** Form bound to a server action, with an aria-live area for its result. */
export function ActionForm({
  action,
  children,
  className = 'flex flex-col gap-4',
  renderResult,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  /** Extra output built from `state.data` (import reports, diffs…). */
  renderResult?: (state: FormState) => ReactNode;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className={className}>
      {children}
      <div aria-live="polite" className="text-sm empty:hidden">
        {state.error && <p className="text-danger">{state.error}</p>}
        {state.success && <p className="text-accent">{state.success}</p>}
        {renderResult?.(state)}
      </div>
    </form>
  );
}

export function SubmitButton({
  children,
  pendingLabel = 'Guardando…',
  variant,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} className="self-start">
      {pending ? pendingLabel : children}
    </Button>
  );
}

const control = 'min-h-11 rounded-md border border-border bg-surface px-3 text-base';

export function SelectField({
  label,
  name,
  id = name,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; name: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select id={id} name={name} className={control} {...props}>
        {children}
      </select>
    </div>
  );
}

export function TextareaField({
  label,
  name,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; name: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <textarea id={name} name={name} rows={4} className={`${control} py-2`} {...props} />
    </div>
  );
}
