'use server';

import { revalidatePath } from 'next/cache';
import { formValues, runAction, type ActionState } from '@/lib/action';
import { AppError } from '@/lib/errors';
import { setOwnPassword } from '@/modules/auth/invitations';
import { requireUser } from '@/modules/auth/session';
import { revokeOtherSessions, revokeSession } from '@/modules/auth/sessions';

export async function setPasswordAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { password = '', confirmation = '' } = formValues(formData);
    if (password !== confirmation)
      throw new AppError('VALIDATION', 'Las contraseñas no coinciden.');
    await setOwnPassword(await requireUser(), password);
    return { success: 'Contraseña guardada. Ya puedes usarla para entrar.' };
  });
}

export async function revokeSessionAction(sessionId: string): Promise<void> {
  await revokeSession(await requireUser(), sessionId);
  revalidatePath('/cuenta');
}

export async function revokeOtherSessionsAction(): Promise<void> {
  const user = await requireUser();
  await revokeOtherSessions(user, user.sessionId);
  revalidatePath('/cuenta');
}
