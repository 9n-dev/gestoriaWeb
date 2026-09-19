'use server';

import { formValues, runAction, type ActionState } from '@/lib/action';
import { requireUser } from '@/modules/auth/session';
import { saveBillingSettings } from '@/modules/billing/settings';

export async function saveBillingSettingsAction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    await saveBillingSettings(await requireUser(), formValues(formData));
    return { success: 'Ajustes de facturación guardados.' };
  });
}
