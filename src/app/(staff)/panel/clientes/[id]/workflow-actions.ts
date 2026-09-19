'use server';

import { revalidatePath } from 'next/cache';
import { formValues, runAction, type ActionState } from '@/lib/action';
import { parsePeriodValue } from '@/lib/periods';
import { requireUser } from '@/modules/auth/session';
import {
  addChecklistItem,
  removeChecklistItem,
  setChecklistItemFulfilled,
  setPeriodClosed,
} from '@/modules/checklists/service';
import type { PeriodRef } from '@/modules/checklists/light';
import { AppError } from '@/lib/errors';
import {
  createObligation,
  deleteObligation,
  fileObligation,
  reopenObligation,
  setEstimate,
  startObligation,
} from '@/modules/obligations/workflow';

const refresh = (clientId: string, success: string): ActionState => {
  revalidatePath(`/panel/clientes/${clientId}`);
  return { success };
};

// ── Obligations ──

export const startObligationAction = async (clientId: string, id: string): Promise<ActionState> =>
  runAction(async () => {
    await startObligation(await requireUser(), id);
    return refresh(clientId, 'En curso.');
  });

export const reopenObligationAction = async (clientId: string, id: string): Promise<ActionState> =>
  runAction(async () => {
    await reopenObligation(await requireUser(), id);
    return refresh(clientId, 'Reabierta.');
  });

export const deleteObligationAction = async (clientId: string, id: string): Promise<ActionState> =>
  runAction(async () => {
    await deleteObligation(await requireUser(), id);
    return refresh(clientId, 'Obligación eliminada.');
  });

export async function setEstimateAction(
  clientId: string,
  id: string,
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    await setEstimate(await requireUser(), id, formValues(formData).estimate ?? '');
    return refresh(clientId, 'Importe previsto guardado.');
  });
}

export const fileObligationAction = async (
  clientId: string,
  id: string,
  filing: { result: string; amount: string; directDebit: boolean },
): Promise<ActionState> =>
  runAction(async () => {
    await fileObligation(await requireUser(), id, { ...filing, result: filing.result as 'TO_PAY' });
    return refresh(clientId, 'Presentada. Hemos avisado al cliente.');
  });

export async function createObligationAction(
  clientId: string,
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { model = '', period = '' } = formValues(formData);
    const parsed = parsePeriodValue(period);
    if (!parsed) throw new AppError('VALIDATION', 'Elige un periodo.');
    await createObligation(await requireUser(), clientId, { model, period: parsed });
    return refresh(clientId, 'Obligación añadida.');
  });
}

// ── Checklist ──

export async function addChecklistItemAction(
  clientId: string,
  period: PeriodRef,
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { documentType = 'OTHER', label = '' } = formValues(formData);
    await addChecklistItem(await requireUser(), clientId, period, {
      documentType: documentType as 'OTHER',
      label,
    });
    return refresh(clientId, 'Añadido a la lista.');
  });
}

export const toggleChecklistItemAction = async (
  clientId: string,
  itemId: string,
  fulfilled: boolean,
): Promise<ActionState> =>
  runAction(async () => {
    await setChecklistItemFulfilled(await requireUser(), itemId, fulfilled);
    return refresh(clientId, '');
  });

export const removeChecklistItemAction = async (
  clientId: string,
  itemId: string,
): Promise<ActionState> =>
  runAction(async () => {
    await removeChecklistItem(await requireUser(), itemId);
    return refresh(clientId, '');
  });

export const setPeriodClosedAction = async (
  clientId: string,
  period: PeriodRef,
  closed: boolean,
): Promise<ActionState> =>
  runAction(async () => {
    await setPeriodClosed(await requireUser(), clientId, period, closed);
    return refresh(
      clientId,
      closed
        ? 'Documentación cerrada: el cliente ya no puede subir a este periodo.'
        : 'Documentación reabierta.',
    );
  });
