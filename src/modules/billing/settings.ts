import { z } from 'zod';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/modules/audit/service';
import { assertCan, requireTenantId, type SessionUser } from '@/modules/auth/permissions';
import { parseBillingSettings, type BillingSettings } from './schema';

const days = (min: number, max: number, message: string) =>
  z.coerce.number({ message }).int(message).min(min, message).max(max, message);

/**
 * What the admin types. Unlike `billingSettingsSchema` (which reads stored JSON and falls back to
 * defaults), this one explains what is wrong instead of silently fixing it.
 */
export const billingSettingsInputSchema = z
  .object({
    paymentDays: days(0, 120, 'El plazo de pago debe estar entre 0 y 120 días.'),
    // "3, 10, 20" → [3, 10, 20]; empty = no reminders.
    dunningDays: z
      .string()
      .transform((text) =>
        text
          .split(/[\s,;]+/)
          .filter(Boolean)
          .map(Number),
      )
      .pipe(
        z
          .array(
            z
              .number({ message: 'Escribe los días de los recordatorios separados por comas.' })
              .int('Los días de los recordatorios deben ser números enteros.')
              .min(1, 'Los recordatorios empiezan como pronto 1 día después del vencimiento.')
              .max(120, 'Los recordatorios no pueden ir más allá de 120 días.'),
          )
          .max(6, 'Como máximo 6 recordatorios.'),
      )
      .transform((list) => [...new Set(list)].sort((a, b) => a - b)),
    delinquentAfterDays: days(1, 365, 'El paso a moroso debe estar entre 1 y 365 días.'),
    seriesCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{1,10}$/, 'La serie admite de 1 a 10 letras o números, sin espacios.')
      .refine(
        (code) => code !== 'R',
        'La serie R está reservada para las facturas rectificativas.',
      ),
  })
  .refine((value) => (value.dunningDays.at(-1) ?? 0) <= value.delinquentAfterDays, {
    message: 'El último recordatorio no puede ser posterior al paso a moroso.',
  });

export async function getBillingSettings(user: SessionUser): Promise<BillingSettings> {
  assertCan(user, 'tenantSettings.manage');
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: requireTenantId(user) } });
  return parseBillingSettings(tenant.settings);
}

/** §6.11 "Configurable": payment term, unpaid reminders, delinquency threshold and invoice series. */
export async function saveBillingSettings(
  user: SessionUser,
  input: unknown,
): Promise<BillingSettings> {
  assertCan(user, 'tenantSettings.manage');
  const tenantId = requireTenantId(user);
  const next = billingSettingsInputSchema.parse(input);

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const before = parseBillingSettings(tenant.settings);
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { settings: { ...(tenant.settings as object), billing: next } },
  });
  await recordAudit({
    tenantId,
    actor: user,
    action: 'tenantSettings.billing',
    entity: 'Tenant',
    entityId: tenantId,
    diff: { before, after: next },
  });
  return next;
}
