import { z } from 'zod';

const money = z.preprocess(
  (value) =>
    typeof value === 'string' ? Number(value.replace(/\./g, '').replace(',', '.')) : value,
  z.number('Importe no válido.').finite().min(-99_999_999).max(99_999_999),
);
const rate = z.preprocess(
  (value) => (typeof value === 'string' ? Number(value.replace(',', '.')) : value),
  z.number().min(0).max(100),
);

export const lineSchema = z.object({
  description: z.string().trim().min(2, 'Describe el concepto.').max(300),
  quantity: money.default(1),
  unitPrice: money,
  vatRate: rate.default(21),
  irpfRate: rate.default(0),
});

export const invoiceInputSchema = z.object({
  clientId: z.string().min(1),
  lines: z.array(lineSchema).min(1, 'Añade al menos un concepto.').max(50),
  paymentMethod: z.enum(['CARD', 'SEPA_DEBIT', 'BANK_TRANSFER', 'OTHER']).default('BANK_TRANSFER'),
});

export const feeInputSchema = z.object({
  concept: z.string().trim().min(2, 'Describe el concepto.').max(200),
  amount: money.refine((value) => value > 0, 'El importe debe ser mayor que cero.'),
  vatRate: rate.default(21),
  irpfRate: rate.default(0),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha no válida.'),
  endsOn: z
    .preprocess(
      (v) => (v === '' ? null : v),
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable(),
    )
    .default(null),
});

/** `Tenant.settings.billing` (§6.11: everything about unpaid invoices is configurable). */
export const billingSettingsSchema = z.object({
  paymentDays: z.number().int().min(0).max(120).catch(15),
  dunningDays: z.array(z.number().int().min(1).max(120)).max(6).catch([3, 10, 20]),
  delinquentAfterDays: z.number().int().min(1).max(365).catch(30),
  seriesCode: z
    .string()
    .regex(/^[A-Z0-9]{1,10}$/)
    .catch('A'),
});
export type BillingSettings = z.infer<typeof billingSettingsSchema>;
export const parseBillingSettings = (settings: unknown): BillingSettings =>
  billingSettingsSchema.parse((settings as { billing?: unknown } | null)?.billing ?? {});
