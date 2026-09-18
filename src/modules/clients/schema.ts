import { z } from 'zod';
import { validateTaxId } from '@/lib/tax-id';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullish()
    .transform((value) => value ?? null);

export const taxIdSchema = z.string().transform((raw, ctx) => {
  const result = validateTaxId(raw);
  if (!result.valid) {
    ctx.addIssue({
      code: 'custom',
      message: 'El NIF no es válido. Revisa el número y la letra de control.',
    });
    return z.NEVER;
  }
  return result.normalized;
});

export const clientInputSchema = z.object({
  legalName: z.string().trim().min(2, 'Indica el nombre o la razón social.').max(200),
  tradeName: optionalText(200),
  taxId: taxIdSchema,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) => value || null)
    .nullish()
    .transform((value) => value ?? null)
    .pipe(z.email('El correo electrónico no es válido.').nullable()),
  phone: optionalText(30),
  addressLine: optionalText(200),
  postalCode: optionalText(10),
  city: optionalText(100),
  province: optionalText(100),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  taxProfileId: z
    .string()
    .min(1)
    .nullish()
    .transform((value) => value || null),
  assignedManagerId: z
    .string()
    .min(1)
    .nullish()
    .transform((value) => value || null),
});

export type ClientInput = z.input<typeof clientInputSchema>;

export const internalNotesSchema = z
  .string()
  .max(10_000)
  .transform((value) => value.trim() || null);
