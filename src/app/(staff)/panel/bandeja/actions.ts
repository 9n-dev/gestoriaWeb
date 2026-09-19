'use server';

import { revalidatePath } from 'next/cache';
import { formValues, runAction, type ActionState } from '@/lib/action';
import { parsePeriodValue } from '@/lib/periods';
import { requireUser } from '@/modules/auth/session';
import { deleteSavedView, saveView } from '@/modules/documents/saved-views';
import {
  bookDocument,
  confirmFields,
  markDuplicate,
  rejectDocument,
  reopenDocument,
  updateDocumentFields,
  type InboxFilters,
} from '@/modules/documents/service';

const done = (success: string): ActionState => {
  revalidatePath('/panel/bandeja');
  return { success };
};

export const bookAction = async (id: string): Promise<ActionState> =>
  runAction(async () => {
    await bookDocument(await requireUser(), id);
    return done('Contabilizado.');
  });

export const duplicateAction = async (id: string): Promise<ActionState> =>
  runAction(async () => {
    await markDuplicate(await requireUser(), id);
    return done('Marcado como duplicado.');
  });

export const reopenAction = async (id: string): Promise<ActionState> =>
  runAction(async () => {
    await reopenDocument(await requireUser(), id);
    return done('Devuelto a la bandeja.');
  });

export const confirmAction = async (id: string): Promise<ActionState> =>
  runAction(async () => {
    await confirmFields(await requireUser(), id);
    return done('Datos confirmados.');
  });

export const rejectAction = async (
  id: string,
  reason: string,
  note: string,
): Promise<ActionState> =>
  runAction(async () => {
    await rejectDocument(await requireUser(), id, { reason, note });
    return done('Rechazado. Hemos avisado al cliente.');
  });

export async function saveFieldsAction(
  id: string,
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { period = '', ...values } = formValues(formData);
    const result = await updateDocumentFields(await requireUser(), id, {
      ...values,
      type: values.type as 'OTHER',
      period: parsePeriodValue(period),
    });
    return done(
      result.possibleDuplicateOfId
        ? 'Guardado. Ojo: ya hay un documento con el mismo NIF, número y fecha. Pulsa D si es un duplicado.'
        : 'Datos guardados.',
    );
  });
}

export const saveViewAction = async (name: string, filters: InboxFilters): Promise<ActionState> =>
  runAction(async () => {
    await saveView(await requireUser(), { name, filters });
    return done('Vista guardada.');
  });

export const deleteViewAction = async (id: string): Promise<ActionState> =>
  runAction(async () => {
    await deleteSavedView(await requireUser(), id);
    return done('Vista eliminada.');
  });
