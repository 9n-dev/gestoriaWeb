import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { ZodError } from 'zod';
import { reportError } from '@/lib/report-error';
import { AppError, toUserMessage } from './errors';

export type ActionState<T = unknown> = { error?: string; success?: string; data?: T };

/**
 * Wraps the body of a server action: validation and AppErrors become a Spanish message for the
 * form, anything else is logged and collapses to the generic message. Redirects pass through.
 */
export async function runAction<T>(body: () => Promise<ActionState<T>>): Promise<ActionState<T>> {
  try {
    return await body();
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ZodError)
      return { error: error.issues[0]?.message ?? toUserMessage(error) };
    if (!(error instanceof AppError)) reportError(error, { where: 'action' });
    return { error: toUserMessage(error) };
  }
}

/** FormData → plain object of trimmed strings (files are skipped). */
export function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData) if (typeof value === 'string') values[key] = value.trim();
  return values;
}
