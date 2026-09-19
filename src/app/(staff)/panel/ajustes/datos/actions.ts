'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { formValues, runAction, type ActionState } from '@/lib/action';
import { AppError } from '@/lib/errors';
import { formatLongDate } from '@/lib/dates';
import { requireUser } from '@/modules/auth/session';
import {
  cancelClientErasure,
  cancelTenant,
  requestClientErasure,
  setRetentionYears,
} from '@/modules/gdpr/erasure';
import { requestExport } from '@/modules/gdpr/export';

const PAGE = '/panel/ajustes/datos';
const QUEUED = 'Exportación en marcha. Te enviaremos un correo con el enlace cuando esté lista.';

export async function exportTenantAction(_: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await requestExport(await requireUser(), null);
    revalidatePath(PAGE);
    return { success: QUEUED };
  });
}

/** One form, two buttons: export everything about a client, or erase it (30 days of grace). */
export async function clientDataAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { clientId = '', intent, understood } = formValues(formData);
    const user = await requireUser();
    if (intent === 'export') {
      await requestExport(user, clientId);
      revalidatePath(PAGE);
      return { success: QUEUED };
    }
    if (understood !== 'on') {
      throw new AppError('VALIDATION', 'Marca la casilla para confirmar la supresión.');
    }
    const purgeAfter = await requestClientErasure(user, clientId);
    revalidatePath(PAGE);
    return {
      success: `Cliente ocultado. Se borrará definitivamente el ${formatLongDate(purgeAfter)}; hasta entonces puedes recuperarlo.`,
    };
  });
}

export async function cancelErasureAction(clientId: string, _: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await cancelClientErasure(await requireUser(), clientId);
    revalidatePath(PAGE);
    return { success: 'Cliente recuperado.' };
  });
}

export async function retentionAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    await setRetentionYears(await requireUser(), Number(formValues(formData).years));
    return { success: 'Política de retención guardada.' };
  });
}

export async function cancelTenantAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const result = await runAction(async () => {
    await cancelTenant(await requireUser(), formValues(formData).confirmation ?? '');
    return {};
  });
  if (result.error) return result;
  redirect('/acceso');
}
