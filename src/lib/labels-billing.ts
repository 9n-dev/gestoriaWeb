import type { InvoiceStatus } from '@prisma/client';

export const INVOICE_STATUS: Record<InvoiceStatus, string> = {
  DRAFT: 'Borrador',
  ISSUED: 'Emitida',
  PAID: 'Cobrada',
  OVERDUE: 'Vencida',
  CANCELLED: 'Anulada',
};
