import type { ObligationResult } from '@prisma/client';
import { daysBetween, type IsoDate } from '@/lib/dates';
import { formatEuros } from '@/lib/money';

export const OBLIGATION_RESULT: Record<ObligationResult, string> = {
  TO_PAY: 'A pagar',
  TO_REFUND: 'A devolver',
  ZERO: 'Sin importe',
};

/** "A pagar 1.234,56 € (domiciliado)" */
export function resultLabel(o: {
  result: ObligationResult | null;
  resultAmount: unknown;
  directDebit: boolean;
}): string {
  if (!o.result) return '';
  if (o.result === 'ZERO') return OBLIGATION_RESULT.ZERO;
  return `${OBLIGATION_RESULT[o.result]} ${formatEuros(String(o.resultAmount))}${o.result === 'TO_PAY' && o.directDebit ? ' (domiciliado)' : ''}`;
}

/** "hoy", "mañana", "en 12 días", "hace 3 días" */
export function relativeDays(today: IsoDate, date: IsoDate): string {
  const days = daysBetween(today, date);
  if (days === 0) return 'hoy';
  if (days === 1) return 'mañana';
  return days > 0 ? `en ${days} días` : `hace ${-days} días`;
}
