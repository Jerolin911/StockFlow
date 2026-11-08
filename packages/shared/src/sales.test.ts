import { describe, expect, it } from 'vitest';
import { salesDocumentTotals, salesLineAmounts } from './schemas/sales.js';

describe('sales pricing', () => {
  it('applies the discount before tax and rounds each per line', () => {
    // 3 × 9.99 = 29.97; 12.5% off = 3.74625 → 3.75; 26.22 net; 8.25% tax = 2.16315 → 2.16.
    expect(salesLineAmounts(3, 999, 1250, 825)).toEqual({
      lineGross: 2997,
      lineDiscount: 375,
      lineSubtotal: 2622,
      lineTax: 216,
      lineTotal: 2838,
    });
  });

  it('handles no discount, full discount and zero tax', () => {
    expect(salesLineAmounts(2, 500, 0, 0).lineTotal).toBe(1000);
    expect(salesLineAmounts(2, 500, 10_000, 2000)).toMatchObject({ lineSubtotal: 0, lineTotal: 0 });
  });

  it('sums document totals from line amounts', () => {
    const lines = [salesLineAmounts(1, 1000, 1000, 1000), salesLineAmounts(2, 250, 0, 0)];
    expect(salesDocumentTotals(lines)).toEqual({
      grossTotal: 1500,
      discountTotal: 100,
      subtotal: 1400,
      taxTotal: 90,
      total: 1490,
    });
  });
});
