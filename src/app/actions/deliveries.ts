'use server';

import { revalidatePath } from 'next/cache';
import { runAction, type ActionState } from '@/lib/action';
import { requestMeta } from '@/lib/request';
import { requireUser } from '@/modules/auth/session';
import { deleteDelivery, signDelivery } from '@/modules/deliveries/service';

export async function signDeliveryAction(
  id: string,
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    await signDelivery(
      await requireUser(),
      id,
      formData.get('accepted') === 'on',
      await requestMeta(),
    );
    revalidatePath(`/entregas/${id}`);
    return { success: 'Firmado. Hemos generado tu certificado de conformidad.' };
  });
}

export async function deleteDeliveryAction(
  clientId: string,
  id: string,
  _: ActionState,
): Promise<ActionState> {
  return runAction(async () => {
    await deleteDelivery(await requireUser(), id);
    revalidatePath(`/panel/clientes/${clientId}`);
    return {};
  });
}
