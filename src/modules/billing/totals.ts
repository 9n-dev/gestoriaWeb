export type LineInput = {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  irpfRate: number;
};
export type InvoiceTotals = {
  lines: Array<LineInput & { amount: number }>;
  subtotal: number;
  vatAmount: number;
  irpfAmount: number;
  total: number;
  /** Base and VAT per rate: what a Spanish invoice must show. */
  vatBreakdown: Array<{ rate: number; base: number; vat: number }>;
};

/** Cents arithmetic: floating point never touches a total. */
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Totals of an invoice (§6.11): VAT is computed per rate on the summed base, IRPF withholding on
 * the base of the lines that carry it. total = base + VAT − IRPF.
 */
export function computeTotals(input: LineInput[]): InvoiceTotals {
  const lines = input.map((line) => ({ ...line, amount: round(line.quantity * line.unitPrice) }));
  const byRate = new Map<number, number>();
  for (const line of lines)
    byRate.set(line.vatRate, round((byRate.get(line.vatRate) ?? 0) + line.amount));

  const vatBreakdown = [...byRate]
    .sort(([a], [b]) => b - a)
    .map(([rate, base]) => ({ rate, base, vat: round((base * rate) / 100) }));
  const subtotal = round(lines.reduce((sum, line) => sum + line.amount, 0));
  const vatAmount = round(vatBreakdown.reduce((sum, row) => sum + row.vat, 0));
  const irpfAmount = round(
    lines.reduce((sum, line) => sum + (line.amount * line.irpfRate) / 100, 0),
  );
  return {
    lines,
    subtotal,
    vatAmount,
    irpfAmount,
    total: round(subtotal + vatAmount - irpfAmount),
    vatBreakdown,
  };
}
