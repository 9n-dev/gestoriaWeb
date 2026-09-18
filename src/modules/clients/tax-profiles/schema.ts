import { z } from 'zod';
import { knownModels } from '@/modules/obligations/calendar';

export const REGIMES = {
  DIRECT_SIMPLIFIED: 'Estimación directa simplificada',
  DIRECT_NORMAL: 'Estimación directa normal',
  MODULES: 'Estimación objetiva (módulos)',
  CORPORATE: 'Impuesto sobre Sociedades',
  ATTRIBUTION: 'Atribución de rentas (CB, sociedad civil)',
  NON_BUSINESS: 'Sin actividad económica',
} as const;

export const VAT_PERIODICITIES = {
  QUARTER: 'Trimestral',
  MONTH: 'Mensual',
  NONE: 'No presenta IVA',
} as const;

const documentTypeSchema = z.enum([
  'ISSUED_INVOICE',
  'RECEIVED_INVOICE',
  'RECEIPT',
  'PAYROLL',
  'BANK_STATEMENT',
  'RENT_RECEIPT',
  'OTHER',
]);

/** Shape of `TaxProfile.rules`. `models` is the source of truth for obligation generation. */
export const taxProfileRulesSchema = z.object({
  regime: z.enum(Object.keys(REGIMES) as [keyof typeof REGIMES, ...Array<keyof typeof REGIMES>]),
  vatPeriodicity: z.enum(['QUARTER', 'MONTH', 'NONE']),
  hasEmployees: z.boolean(),
  withholdsRent: z.boolean(),
  intraCommunity: z.boolean(),
  models: z
    .array(z.string())
    .min(1, 'Selecciona al menos un modelo.')
    .refine((models) => new Set(models).size === models.length, 'Hay modelos repetidos.')
    .refine(
      (models) => models.every((model) => knownModels().includes(model)),
      'Hay modelos que no están en el calendario fiscal.',
    ),
  /** Documents the client must provide every VAT period (or quarter when there is no VAT). */
  checklist: z.array(
    z.object({ documentType: documentTypeSchema, label: z.string().min(1).max(120) }),
  ),
});

export type TaxProfileRules = z.infer<typeof taxProfileRulesSchema>;

export const taxProfileInputSchema = z.object({
  name: z.string().trim().min(3, 'El nombre es demasiado corto.').max(120),
  description: z.string().trim().max(500).optional(),
  rules: taxProfileRulesSchema,
});

export type TaxProfileInput = z.infer<typeof taxProfileInputSchema>;

type Flags = Pick<
  TaxProfileRules,
  'regime' | 'vatPeriodicity' | 'hasEmployees' | 'withholdsRent' | 'intraCommunity'
>;

/** Starting point when building a profile from its flags; the admin can still edit the list. */
export function suggestModels(flags: Flags): string[] {
  const models: string[] = [];
  if (flags.vatPeriodicity !== 'NONE') models.push('303', '390');
  if (flags.regime === 'DIRECT_SIMPLIFIED' || flags.regime === 'DIRECT_NORMAL') models.push('130');
  if (flags.regime === 'MODULES') models.push('131');
  if (flags.hasEmployees) models.push('111', '190');
  if (flags.withholdsRent) models.push('115', '180');
  if (flags.intraCommunity) models.push('349');
  if (flags.regime === 'CORPORATE') models.push('347', '200');
  else if (flags.regime === 'ATTRIBUTION') models.push('184', '347');
  else models.push('100');
  return models;
}
