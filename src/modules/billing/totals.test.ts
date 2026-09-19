import { describe, expect, it } from 'vitest';
import { computeTotals } from './totals';

const line = (unitPrice: number, overrides = {}) => ({
  description: 'Cuota mensual',
  quantity: 1,
  unitPrice,
  vatRate: 21,
  irpfRate: 0,
  ...overrides,
});

describe('computeTotals', () => {
  it('adds VAT', () => {
    expect(computeTotals([line(90)])).toMatchObject({
      subtotal: 90,
      vatAmount: 18.9,
      irpfAmount: 0,
      total: 108.9,
    });
  });
  it('subtracts IRPF withholding', () => {
    expect(computeTotals([line(100, { irpfRate: 15 })])).toMatchObject({
      subtotal: 100,
      vatAmount: 21,
      irpfAmount: 15,
      total: 106,
    });
  });
  it('groups VAT by rate and rounds to cents without floating point drift', () => {
    const totals = computeTotals([
      line(33.33, { quantity: 3 }),
      line(0.1),
      line(0.2),
      line(50, { vatRate: 10 }),
    ]);
    expect(totals.vatBreakdown).toEqual([
      { rate: 21, base: 100.29, vat: 21.06 },
      { rate: 10, base: 50, vat: 5 },
    ]);
    expect(totals).toMatchObject({ subtotal: 150.29, vatAmount: 26.06, total: 176.35 });
  });
  it('handles negative lines of rectifying invoices', () => {
    expect(computeTotals([line(-90)])).toMatchObject({
      subtotal: -90,
      vatAmount: -18.9,
      total: -108.9,
    });
  });
});
