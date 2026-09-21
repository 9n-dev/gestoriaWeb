'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { formValues, runAction, type ActionState } from '@/lib/action';
import { parsePeriodValue } from '@/lib/periods';
import { can } from '@/modules/auth/permissions';
import { requireUser } from '@/modules/auth/session';
import {
  createThread,
  sendMessage,
  setThreadMuted,
  setThreadStatus,
} from '@/modules/messaging/service';
import {
  deleteMessageTemplate,
  renderMessageTemplate,
  saveMessageTemplate,
} from '@/modules/messaging/templates';

const threadPath = async (threadId: string) =>
  can(await requireUser(), 'area.staff') ? `/panel/mensajes/${threadId}` : `/mensajes/${threadId}`;

/** Returns the message id so the composer can attach files to it. */
export const sendMessageAction = async (
  threadId: string,
  body: string,
): Promise<ActionState<string>> =>
  runAction(async () => {
    const message = await sendMessage(await requireUser(), threadId, body);
    revalidatePath(await threadPath(threadId));
    return { data: message.id };
  });

export async function createThreadAction(
  clientId: string,
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await runAction(async () => {
    const { subject = '', body = '', type = 'GENERAL', period = '' } = formValues(formData);
    const created = await createThread(await requireUser(), {
      clientId,
      subject,
      body,
      type: type as 'GENERAL',
      period: parsePeriodValue(period),
    });
    return { data: created.threadId };
  });
  if (result.error) return result;
  redirect(await threadPath(String(result.data)));
}

export const setThreadStatusAction = async (
  threadId: string,
  status: 'OPEN' | 'CLOSED',
): Promise<ActionState> =>
  runAction(async () => {
    await setThreadStatus(await requireUser(), threadId, status);
    revalidatePath(`/panel/mensajes/${threadId}`);
    return { success: status === 'CLOSED' ? 'Conversación cerrada.' : 'Conversación reabierta.' };
  });

export const setThreadMutedAction = async (
  threadId: string,
  muted: boolean,
): Promise<ActionState> =>
  runAction(async () => {
    await setThreadMuted(await requireUser(), threadId, muted);
    return {};
  });

export const renderTemplateAction = async (
  templateId: string,
  clientId: string,
): Promise<ActionState<string>> =>
  runAction(async () => ({
    data: await renderMessageTemplate(await requireUser(), templateId, clientId),
  }));

export async function saveTemplateAction(
  id: string | null,
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { name = '', body = '' } = formValues(formData);
    await saveMessageTemplate(await requireUser(), { name, body }, id ?? undefined);
    revalidatePath('/panel/ajustes/plantillas');
    return { success: 'Plantilla guardada.' };
  });
}

export async function deleteTemplateAction(id: string, _: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await deleteMessageTemplate(await requireUser(), id);
    revalidatePath('/panel/ajustes/plantillas');
    return {};
  });
}
