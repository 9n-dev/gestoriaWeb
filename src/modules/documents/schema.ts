import { z } from 'zod';
import { ACCEPTED_MIME_TYPES, MAX_FILE_BYTES } from '@/lib/files/sniff';
import { taxIdSchema } from '@/modules/clients/schema';

export const DOCUMENT_TYPES = [
  'ISSUED_INVOICE',
  'RECEIVED_INVOICE',
  'RECEIPT',
  'PAYROLL',
  'BANK_STATEMENT',
  'RENT_RECEIPT',
  'OTHER',
] as const;

export const PERMANENT_CATEGORIES = [
  'DEED',
  'CERTIFICATE',
  'CENSUS_REGISTRATION',
  'POWER_OF_ATTORNEY',
  'ID_DOCUMENT',
  'CONTRACT',
  'OTHER',
] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha no válida.');
const blankToNull = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' || value === undefined ? null : value), schema.nullable());

const fileSchema = z.object({
  clientId: z.string().min(1),
  fileName: z.string().trim().min(1).max(200),
  // Declared by the browser: only a first filter. The worker decides from the bytes.
  mimeType: z.enum(ACCEPTED_MIME_TYPES, 'Solo se admiten fotos (JPG, PNG, HEIC) y PDF.'),
  sizeBytes: z
    .number()
    .int()
    .positive('El archivo está vacío.')
    .max(MAX_FILE_BYTES, 'El archivo supera el máximo de 20 MB.'),
});

export const uploadRequestSchema = z.discriminatedUnion('purpose', [
  fileSchema.extend({
    purpose: z.literal('DOCUMENT'),
    documentType: z.enum(DOCUMENT_TYPES).default('OTHER'),
    period: blankToNull(
      z.object({
        year: z.number().int().min(2000).max(2100),
        type: z.enum(['MONTH', 'QUARTER', 'YEAR']),
        ordinal: z.number().int().min(0).max(12),
      }),
    ),
  }),
  fileSchema.extend({
    purpose: z.literal('PERMANENT_DOCUMENT'),
    title: z.string().trim().min(2, 'Indica un título.').max(200),
    category: z.enum(PERMANENT_CATEGORIES).default('OTHER'),
    expiresAt: blankToNull(isoDate),
  }),
  fileSchema.extend({
    purpose: z.literal('MESSAGE_ATTACHMENT'),
    messageId: z.string().min(1),
  }),
  fileSchema.extend({
    purpose: z.literal('DELIVERY'),
    title: z.string().trim().min(2, 'Indica un título.').max(200),
    category: z.enum(['FILED_FORM', 'LEDGER', 'LETTER', 'CERTIFICATE', 'OTHER']).default('OTHER'),
    period: blankToNull(
      z.object({
        year: z.number().int(),
        type: z.enum(['MONTH', 'QUARTER', 'YEAR']),
        ordinal: z.number().int(),
      }),
    ),
    /** Day from which the client sees it. Empty = at once. */
    visibleFrom: blankToNull(isoDate),
    requiresSignature: z.boolean().default(false),
  }),
  fileSchema.extend({
    purpose: z.literal('OBLIGATION_RECEIPT'),
    obligationId: z.string().min(1),
  }),
]);
export type UploadRequest = z.input<typeof uploadRequestSchema>;

const amount = blankToNull(
  z.preprocess(
    // Spanish decimal comma: "1.234,56" → 1234.56
    (value) =>
      typeof value === 'string' ? Number(value.replace(/\./g, '').replace(',', '.')) : value,
    z.number('Importe no válido.').finite().min(-99_999_999).max(99_999_999),
  ),
);

/** Fields a manager types by hand today and the AI extractor will propose from phase 7. */
export const documentFieldsSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  period: blankToNull(
    z.object({
      year: z.number().int(),
      type: z.enum(['MONTH', 'QUARTER', 'YEAR']),
      ordinal: z.number().int(),
    }),
  ),
  supplierName: blankToNull(z.string().trim().max(200)),
  supplierTaxId: blankToNull(taxIdSchema),
  invoiceNumber: blankToNull(z.string().trim().max(60)),
  invoiceDate: blankToNull(isoDate),
  taxBase: amount,
  vatRate: amount,
  vatAmount: amount,
  total: amount,
});
/** Form-shaped input: everything optional arrives as a string, possibly empty. */
export type DocumentFieldsInput = {
  type: (typeof DOCUMENT_TYPES)[number];
  period: { year: number; type: 'MONTH' | 'QUARTER' | 'YEAR'; ordinal: number } | null;
} & Partial<
  Record<
    | 'supplierName'
    | 'supplierTaxId'
    | 'invoiceNumber'
    | 'invoiceDate'
    | 'taxBase'
    | 'vatRate'
    | 'vatAmount'
    | 'total',
    string | null
  >
>;

export const rejectionSchema = z.object({
  reason: z.string().trim().min(1, 'Elige un motivo.').max(120),
  note: blankToNull(z.string().trim().max(1000)),
});

/** Default list of `Tenant.settings.rejectionReasons`; each gestoría can edit it. */
export const DEFAULT_REJECTION_REASONS = [
  'No se lee bien: vuelve a hacer la foto',
  'Falta parte del documento',
  'No es una factura válida (falta NIF, número o fecha)',
  'Documento de otro periodo',
  'Documento personal, no deducible',
  'Archivo bloqueado por seguridad',
];

export const tenantDocumentSettingsSchema = z.object({
  rejectionReasons: z
    .array(z.string().trim().min(3).max(120))
    .min(1)
    .max(30)
    .catch(DEFAULT_REJECTION_REASONS),
});
