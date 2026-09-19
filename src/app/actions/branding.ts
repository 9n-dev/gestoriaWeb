'use server';

import { revalidatePath } from 'next/cache';
import { formValues, runAction, type ActionState } from '@/lib/action';
import { requireUser } from '@/modules/auth/session';
import {
  removeCustomDomain,
  removeSendingDomain,
  requestCustomDomain,
  requestSendingDomain,
  verifyCustomDomain,
} from '@/modules/branding/domains';
import {
  previewEmailTemplate,
  resetEmailTemplate,
  saveEmailTemplate,
} from '@/modules/branding/email-templates';

const done = (success: string): ActionState => {
  revalidatePath('/panel/ajustes', 'layout');
  return { success };
};

export async function requestCustomDomainAction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    await requestCustomDomain(await requireUser(), formValues(formData).domain ?? '');
    return done('Dominio guardado. Crea ahora los registros DNS que ves abajo.');
  });
}

export async function verifyCustomDomainAction(_: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await verifyCustomDomain(await requireUser());
    return done('Dominio verificado. El certificado SSL se emite automáticamente en unos minutos.');
  });
}

export async function removeCustomDomainAction(_: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await removeCustomDomain(await requireUser());
    return done('Dominio eliminado.');
  });
}

export async function requestSendingDomainAction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    await requestSendingDomain(await requireUser(), formValues(formData).domain ?? '');
    return done('Dominio de envío guardado. Crea los registros DNS que ves abajo.');
  });
}

export async function removeSendingDomainAction(_: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await removeSendingDomain(await requireUser());
    return done('Dominio de envío eliminado.');
  });
}

const templateInput = (key: string, formData: FormData) => {
  const { subject = '', body = '' } = formValues(formData);
  return { key: key as 'auth.invitation', subject, body };
};

/** One form, two buttons: "preview" renders with sample data, "save" stores the override. */
export async function emailTemplateAction(
  key: string,
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const intent = formData.get('intent');
    if (intent === 'reset') {
      await resetEmailTemplate(user, key);
      return done('Restaurado el texto original.');
    }
    if (intent === 'save') {
      await saveEmailTemplate(user, templateInput(key, formData));
      return done('Plantilla guardada.');
    }
    return { data: await previewEmailTemplate(user, templateInput(key, formData)) };
  });
}
