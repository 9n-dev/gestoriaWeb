'use server';

import { revalidatePath } from 'next/cache';
import { formValues, runAction, type ActionState } from '@/lib/action';
import { requireUser } from '@/modules/auth/session';
import { grantSupportAccess, revokeSupportAccess } from '@/modules/platform/support';

const PAGE = '/panel/ajustes/soporte';

export async function grantSupportAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { hours, reason = '' } = formValues(formData);
    await grantSupportAccess(await requireUser(), { hours: Number(hours), reason });
    revalidatePath(PAGE);
    return { success: 'Modo soporte activado.' };
  });
}

export async function revokeSupportAction(grantId: string, _: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await revokeSupportAccess(await requireUser(), grantId);
    revalidatePath(PAGE);
    return { success: 'Acceso cerrado.' };
  });
}
