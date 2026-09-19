'use server';

import { redirect } from 'next/navigation';
import { formValues, runAction, type ActionState } from '@/lib/action';
import { AppError } from '@/lib/errors';
import { rateLimitByIp } from '@/lib/rate-limit';
import { getPendingUser } from '@/modules/auth/session';
import {
  confirmEnrolment,
  disableTwoFactor,
  verifyChallenge,
} from '@/modules/auth/two-factor/service';

async function pendingUser() {
  const user = await getPendingUser();
  if (!user) throw new AppError('UNAUTHENTICATED', 'Tu sesión ha caducado. Vuelve a entrar.');
  await rateLimitByIp('twoFactor', user.id);
  return user;
}

export async function challengeAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await pendingUser();
    await verifyChallenge(user, user.sessionId, formValues(formData).code ?? '');
    redirect('/');
  });
}

/** On success the recovery codes travel back once, to be shown and never again. */
export async function confirmEnrolmentAction(
  _: ActionState<string[]>,
  formData: FormData,
): Promise<ActionState<string[]>> {
  return runAction(async () => {
    const user = await pendingUser();
    const codes = await confirmEnrolment(user, user.sessionId, formValues(formData).code ?? '');
    return { data: codes };
  });
}

export async function disableTwoFactorAction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    await disableTwoFactor(await pendingUser(), formValues(formData).code ?? '');
    return { success: 'Verificación en dos pasos desactivada.' };
  });
}
