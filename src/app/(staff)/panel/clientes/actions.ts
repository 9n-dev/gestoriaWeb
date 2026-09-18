'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { formValues, runAction, type ActionState } from '@/lib/action';
import { AppError } from '@/lib/errors';
import { inviteClientUser, resendInvitation } from '@/modules/auth/invitations';
import { requireUser } from '@/modules/auth/session';
import { importClients } from '@/modules/clients/import';
import {
  assignManager,
  assignTaxProfile,
  createClient,
  deleteClient,
  updateClient,
  updateInternalNotes,
} from '@/modules/clients/service';

const MAX_IMPORT_BYTES = 1024 * 1024;

const clientInput = (formData: FormData) => {
  const { tags = '', ...values } = formValues(formData);
  return {
    legalName: '',
    taxId: '',
    ...values,
    tags: tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
  };
};

export async function createClientAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const result = await runAction(async () => {
    const client = await createClient(await requireUser(), clientInput(formData));
    return { data: client.id };
  });
  if (result.error) return result;
  revalidatePath('/panel/clientes');
  redirect(`/panel/clientes/${String(result.data)}`);
}

export async function updateClientAction(
  id: string,
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await runAction(async () => {
    await updateClient(await requireUser(), id, clientInput(formData));
    return {};
  });
  if (result.error) return result;
  revalidatePath('/panel/clientes');
  redirect(`/panel/clientes/${id}`);
}

export async function assignTaxProfileAction(
  id: string,
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const diff = await assignTaxProfile(
      await requireUser(),
      id,
      formValues(formData).taxProfileId || null,
    );
    revalidatePath(`/panel/clientes/${id}`);
    return {
      success:
        diff.added.length + diff.removed.length === 0
          ? 'Perfil guardado. Las obligaciones no cambian.'
          : `Perfil guardado: ${diff.added.length} obligaciones nuevas y ${diff.removed.length} eliminadas (${diff.kept} se mantienen).`,
      data: diff,
    };
  });
}

export async function assignManagerAction(
  id: string,
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    await assignManager(await requireUser(), id, formValues(formData).managerId || null);
    revalidatePath(`/panel/clientes/${id}`);
    return { success: 'Gestor actualizado.' };
  });
}

export async function updateNotesAction(
  id: string,
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    await updateInternalNotes(await requireUser(), id, formValues(formData).internalNotes ?? '');
    revalidatePath(`/panel/clientes/${id}`);
    return { success: 'Notas guardadas.' };
  });
}

export async function inviteClientUserAction(
  id: string,
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { email = '', name = '' } = formValues(formData);
    const invited = await inviteClientUser(await requireUser(), id, { email, name });
    revalidatePath(`/panel/clientes/${id}`);
    return { success: `Invitación enviada a ${invited.email}.` };
  });
}

export async function resendInvitationAction(userId: string, _: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await resendInvitation(await requireUser(), userId);
    return { success: 'Invitación reenviada.' };
  });
}

export async function deleteClientAction(id: string, _: ActionState): Promise<ActionState> {
  const result = await runAction(async () => {
    await deleteClient(await requireUser(), id);
    return {};
  });
  if (result.error) return result;
  revalidatePath('/panel/clientes');
  redirect('/panel/clientes');
}

export async function importClientsAction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      throw new AppError('VALIDATION', 'Selecciona el archivo CSV con tus clientes.');
    }
    if (file.size > MAX_IMPORT_BYTES)
      throw new AppError('VALIDATION', 'El archivo no puede superar 1 MB.');

    const report = await importClients(user, await file.text());
    revalidatePath('/panel/clientes');
    return {
      success: `${report.imported} clientes importados${report.rejected.length ? `, ${report.rejected.length} filas con errores` : ''}.`,
      data: report,
    };
  });
}
