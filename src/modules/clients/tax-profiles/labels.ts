import type { DocumentType } from '@prisma/client';

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  ISSUED_INVOICE: 'Facturas emitidas',
  RECEIVED_INVOICE: 'Facturas recibidas y gastos',
  RECEIPT: 'Tickets y recibos',
  PAYROLL: 'Nóminas y seguros sociales',
  BANK_STATEMENT: 'Extractos bancarios',
  RENT_RECEIPT: 'Recibos de alquiler',
  OTHER: 'Otra documentación',
};

// Kept apart from schema.ts so client components can import them without the tax calendars.
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
