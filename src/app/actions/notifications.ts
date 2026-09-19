'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { runAction, type ActionState } from '@/lib/action';
import { requireUser } from '@/modules/auth/session';
import {
  markAllNotificationsRead,
  markNotificationRead,
  updateNotificationPrefs,
} from '@/modules/messaging/notifications';

/** Opening a notification marks it read and goes where it points. Only internal paths are followed. */
export async function openNotificationAction(id: string): Promise<void> {
  const link = await markNotificationRead(await requireUser(), id);
  revalidatePath('/', 'layout');
  redirect(link?.startsWith('/') && !link.startsWith('//') ? link : '/notificaciones');
}

export async function markAllReadAction(): Promise<void> {
  await markAllNotificationsRead(await requireUser());
  revalidatePath('/', 'layout');
}

export async function updatePrefsAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    await updateNotificationPrefs(await requireUser(), {
      email: formData.get('email') === 'on',
      push: formData.get('push') === 'on',
      mutedTypes: formData.getAll('muted').map(String),
    });
    return { success: 'Preferencias guardadas.' };
  });
}
