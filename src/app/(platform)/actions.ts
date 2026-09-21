'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { rateLimitByIp } from '@/lib/rate-limit';
import { formValues, runAction, type ActionState } from '@/lib/action';
import { requireUser } from '@/modules/auth/session';
import { reactivateTenant } from '@/modules/gdpr/erasure';
import {
  createTenantAsSuperadmin,
  registerTenant,
  setTenantStatus,
  verifyTenantRegistration,
} from '@/modules/tenants/service';

const registration = (formData: FormData) => ({
  name: '',
  slug: '',
  adminName: '',
  adminEmail: '',
  ...formValues(formData),
});

export async function registerTenantAction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    await rateLimitByIp('signup');
    await registerTenant(registration(formData));
    return {
      success:
        'Te hemos enviado un correo para confirmar tu dirección. Ábrelo para activar el portal.',
    };
  });
}

export async function verifyRegistrationAction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await runAction(async () => ({
    data: await verifyTenantRegistration(formValues(formData).token ?? ''),
  }));
  if (result.error) return result;
  redirect(String(result.data));
}

export async function createTenantAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const tenant = await createTenantAsSuperadmin(await requireUser(), registration(formData));
    revalidatePath('/plataforma');
    return { success: `Gestoría «${tenant.name}» creada. Hemos invitado a su administrador.` };
  });
}

export async function reactivateTenantAction(
  tenantId: string,
  _: ActionState,
): Promise<ActionState> {
  return runAction(async () => {
    await reactivateTenant(await requireUser(), tenantId);
    revalidatePath('/plataforma');
    return {};
  });
}

export async function setTenantStatusAction(
  tenantId: string,
  status: 'ACTIVE' | 'SUSPENDED',
  _: ActionState,
): Promise<ActionState> {
  return runAction(async () => {
    await setTenantStatus(await requireUser(), tenantId, status);
    revalidatePath('/plataforma');
    return {};
  });
}
