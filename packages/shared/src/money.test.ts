import { describe, expect, it } from 'vitest';
import { basisPointsToPercent, minorToDecimal, parseMoney, parsePercent } from './money.js';
import {
  createProductSchema,
  updateCustomerSchema,
  updateProductSchema,
  updateWarehouseSchema,
} from './schemas/master-data.js';
import { stockAdjustmentSchema } from './schemas/stock.js';

describe('money helpers', () => {
  it('parses decimal strings into minor units without floating point error', () => {
    expect(parseMoney('12.5')).toBe(1250);
    expect(parseMoney('0.29')).toBe(29);
    expect(parseMoney('1,234.56')).toBe(123456);
    expect(parseMoney('19.99')).toBe(1999);
    expect(parseMoney('7')).toBe(700);
  });

  it('rejects negative, malformed and over-precise amounts', () => {
    for (const value of ['-1', 'abc', '1.234', '', '1.2.3']) expect(parseMoney(value)).toBeNull();
  });

  it('round-trips minor units to decimal strings', () => {
    expect(minorToDecimal(1250)).toBe('12.50');
    expect(minorToDecimal(5)).toBe('0.05');
    expect(minorToDecimal(-305)).toBe('-3.05');
  });

  it('converts percentages to basis points', () => {
    expect(parsePercent('7.25')).toBe(725);
    expect(parsePercent('18')).toBe(1800);
    expect(parsePercent('100.01')).toBeNull();
    expect(basisPointsToPercent(725)).toBe('7.25');
    expect(basisPointsToPercent(1800)).toBe('18');
    expect(basisPointsToPercent(0)).toBe('0');
  });
});

describe('product schema', () => {
  const base = {
    name: 'Desk lamp',
    categoryId: '0123456789abcdef01234567',
    unit: 'pcs',
    costPrice: 1200,
    sellingPrice: 1999,
  };

  it('normalises SKUs and allows blank for generation', () => {
    expect(createProductSchema.parse({ ...base, sku: ' lamp-01 ' }).sku).toBe('LAMP-01');
    expect(createProductSchema.parse(base).sku).toBe('');
    expect(createProductSchema.safeParse({ ...base, sku: 'has space' }).success).toBe(false);
  });

  it('does not inject defaults into partial updates', () => {
    expect(updateProductSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
    expect(updateCustomerSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
    expect(updateWarehouseSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
  });

  it('rejects fractional money and negative thresholds', () => {
    expect(createProductSchema.safeParse({ ...base, costPrice: 12.5 }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...base, reorderPoint: -1 }).success).toBe(false);
  });
});

describe('stock adjustment schema', () => {
  const line = { productId: '0123456789abcdef01234567' };

  it('requires counted quantities for stock counts and changes otherwise', () => {
    expect(
      stockAdjustmentSchema.safeParse({
        warehouseId: line.productId,
        reason: 'count',
        lines: [{ ...line, countedQuantity: 4 }],
      }).success,
    ).toBe(true);
    expect(
      stockAdjustmentSchema.safeParse({
        warehouseId: line.productId,
        reason: 'damage',
        lines: [{ ...line, countedQuantity: 4 }],
      }).success,
    ).toBe(false);
  });

  it('rejects zero changes, duplicate products and unexplained "other" adjustments', () => {
    const parse = (data: object) =>
      stockAdjustmentSchema.safeParse({ warehouseId: line.productId, reason: 'loss', ...data });
    expect(parse({ lines: [{ ...line, quantityChange: 0 }] }).success).toBe(false);
    expect(
      parse({
        lines: [
          { ...line, quantityChange: 1 },
          { ...line, quantityChange: -1 },
        ],
      }).success,
    ).toBe(false);
    expect(
      stockAdjustmentSchema.safeParse({
        warehouseId: line.productId,
        reason: 'other',
        lines: [{ ...line, quantityChange: 2 }],
      }).success,
    ).toBe(false);
  });
});
