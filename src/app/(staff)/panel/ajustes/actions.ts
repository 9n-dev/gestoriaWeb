'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { formValues, runAction, type ActionState } from '@/lib/action';
import { inviteClientsInBulk, inviteStaff } from '@/modules/auth/invitations';
import { requireUser } from '@/modules/auth/session';
import { listClientsFor } from '@/modules/clients/service';
import { DOCUMENT_TYPE_LABELS } from '@/modules/clients/tax-profiles/labels';
import {
  archiveTaxProfile,
  cloneTaxProfile,
  updateTaxProfile,
} from '@/modules/clients/tax-profiles/service';
import { updateRejectionReasons } from '@/modules/documents/service';
import {
  completeOnboarding,
  createSampleData,
  deleteSampleData,
  updateBranding,
  updateReminderSettings,
  updateTenantProfile,
} from '@/modules/tenants/service';

export async function updateTenantProfileAction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    await updateTenantProfile(await requireUser(), { name: '', ...formValues(formData) });
    revalidatePath('/', 'layout');
    return { success: 'Datos guardados.' };
  });
}

export async function updateBrandingAction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const { primaryColor, accentColor } = formValues(formData);
    const logo = formData.get('logo');
    await updateBranding(await requireUser(), {
      primaryColor,
      accentColor,
      logo:
        logo instanceof File && logo.size > 0
          ? { name: logo.name, bytes: new Uint8Array(await logo.arrayBuffer()) }
          : undefined,
    });
    revalidatePath('/', 'layout');
    return { success: 'Marca guardada.' };
  });
}

export async function inviteStaffAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { email = '', name = '', role = '' } = formValues(formData);
    const invited = await inviteStaff(await requireUser(), {
      email,
      name,
      role: role as 'MANAGER',
    });
    revalidatePath('/panel/ajustes/equipo');
    return { success: `Invitación enviada a ${invited.email}.` };
  });
}

export async function cloneTaxProfileAction(id: string, _: ActionState): Promise<ActionState> {
  const result = await runAction(async () => ({
    data: (await cloneTaxProfile(await requireUser(), id)).id,
  }));
  if (result.error) return result;
  redirect(`/panel/ajustes/perfiles-fiscales/${String(result.data)}`);
}

export async function updateTaxProfileAction(
  id: string,
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const values = formValues(formData);
    await updateTaxProfile(await requireUser(), id, {
      name: values.name ?? '',
      description: values.description,
      rules: {
        regime: values.regime as 'DIRECT_SIMPLIFIED',
        vatPeriodicity: values.vatPeriodicity as 'QUARTER',
        hasEmployees: values.hasEmployees === 'on',
        withholdsRent: values.withholdsRent === 'on',
        intraCommunity: values.intraCommunity === 'on',
        models: formData.getAll('models').map(String),
        checklist: formData
          .getAll('checklist')
          .map(String)
          .map((documentType) => ({
            documentType: documentType as keyof typeof DOCUMENT_TYPE_LABELS,
            label:
              values[`label.${documentType}`] ||
              DOCUMENT_TYPE_LABELS[documentType as keyof typeof DOCUMENT_TYPE_LABELS],
          })),
      },
    });
    revalidatePath('/panel/ajustes/perfiles-fiscales');
    return { success: 'Perfil guardado. Las obligaciones de sus clientes se han actualizado.' };
  });
}

export async function archiveTaxProfileAction(id: string, _: ActionState): Promise<ActionState> {
  const result = await runAction(async () => {
    await archiveTaxProfile(await requireUser(), id);
    return {};
  });
  if (result.error) return result;
  revalidatePath('/panel/ajustes/perfiles-fiscales');
  redirect('/panel/ajustes/perfiles-fiscales');
}

/** Onboarding: invites every client that has an email and no users yet. */
export async function bulkInviteAction(_: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const clients = await listClientsFor(user);
    const report = await inviteClientsInBulk(
      user,
      clients.map((client) => client.id),
    );
    return {
      success: `${report.invited} invitaciones enviadas.`,
      data: report.skipped.filter((skipped) => skipped.reason !== 'Ya tiene usuarios.'),
    };
  });
}

export async function createSampleDataAction(_: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const created = await createSampleData(await requireUser());
    revalidatePath('/panel', 'layout');
    return {
      success: created
        ? `${created} clientes de ejemplo creados.`
        : 'Los datos de ejemplo ya estaban creados.',
    };
  });
}

export async function deleteSampleDataAction(_: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const deleted = await deleteSampleData(await requireUser());
    revalidatePath('/panel', 'layout');
    return { success: `${deleted} clientes de ejemplo eliminados.` };
  });
}

export async function completeOnboardingAction(_: ActionState): Promise<ActionState> {
  const result = await runAction(async () => {
    await completeOnboarding(await requireUser());
    return {};
  });
  if (result.error) return result;
  revalidatePath('/', 'layout');
  redirect('/panel');
}

export async function updateRejectionReasonsAction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const reasons = (formValues(formData).reasons ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    await updateRejectionReasons(await requireUser(), reasons);
    revalidatePath('/panel/ajustes/documentos');
    return { success: 'Motivos guardados.' };
  });
}

export async function updateReminderSettingsAction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const values = formValues(formData);
    await updateReminderSettings(await requireUser(), {
      enabled: values.enabled === 'on',
      offsets: (values.offsets ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map(Number),
      inactivityDays: Number(values.inactivityDays ?? ''),
    });
    revalidatePath('/panel/ajustes/recordatorios');
    return { success: 'Recordatorios guardados.' };
  });
}
