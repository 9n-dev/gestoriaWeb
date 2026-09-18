import type { InputHTMLAttributes } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & { label: string; name: string };

/** Labelled input. The label is always visible: placeholders are not labels. */
export function Field({ label, name, id = name, className = '', ...props }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        className={`min-h-11 rounded-md border border-border bg-surface px-3 text-base ${className}`}
        {...props}
      />
    </div>
  );
}
