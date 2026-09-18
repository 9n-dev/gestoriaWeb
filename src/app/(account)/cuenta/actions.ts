'use server';

import { formValues, runAction, type ActionState } from '@/lib/action';
import { AppError } from '@/lib/errors';
import { setOwnPassword } from '@/modules/auth/invitations';
import { requireUser } from '@/modules/auth/session';

export async function setPasswordAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { password = '', confirmation = '' } = formValues(formData);
    if (password !== confirmation)
      throw new AppError('VALIDATION', 'Las contraseñas no coinciden.');
    await setOwnPassword(await requireUser(), password);
    return { success: 'Contraseña guardada. Ya puedes usarla para entrar.' };
  });
}
