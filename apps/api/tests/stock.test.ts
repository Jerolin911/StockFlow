import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CategoryDto, ProductDto, WarehouseDto } from '@stockflow/shared';
import { createApp } from '../src/app.js';
import { Product } from '../src/modules/products/product.model.js';
import { StockAdjustment } from '../src/modules/stock/stock-adjustment.model.js';
import { StockLevel } from '../src/modules/stock/stock-level.model.js';
import { StockMovement } from '../src/modules/stock/stock-movement.model.js';
import {
  api,
  createCategory,
  createProduct,
  createWarehouse,
  expectLedgerConsistent,
  onHand,
  openingStock,
  tokenFor,
  type Api,
} from './fixtures.js';

const app = createApp();
let admin: Api;
let category: CategoryDto;
let main: WarehouseDto;
let east: WarehouseDto;
let product: ProductDto;

beforeEach(async () => {
  admin = api(app, await tokenFor(app, 'admin'));
  category = await createCategory(admin, { code: 'HW' });
  main = await createWarehouse(admin, { code: 'MAIN' });
  east = await createWarehouse(admin, { code: 'EAST' });
  product = await createProduct(admin, category.id, { costPrice: 1000, reorderPoint: 5 });
});

afterEach(async () => {
  await expectLedgerConsistent();
});

const adjust = (
  warehouseId: string,
  lines: Record<string, unknown>[],
  reason = 'correction',
  client: Api = admin,
) => client.post('/stock/adjustments', { warehouseId, reason, lines });

describe('opening stock', () => {
  it('creates the stock level, a movement and a numbered document', async () => {
    const doc = await openingStock(admin, main.id, [{ productId: product.id, quantity: 40 }]);
    expect(doc).toMatchObject({
      type: 'opening',
      warehouse: { code: 'MAIN' },
      totalIn: 40,
      totalOut: 0,
      lines: [
        {
          sku: product.sku,
          quantityChange: 40,
          previousOnHand: 0,
          balanceAfter: 40,
          unitCost: 1000,
        },
      ],
    });
    expect(doc.number).toMatch(/^OPN-\d{4}-00001$/);

    expect(await onHand(product.id, main.id)).toBe(40);
    const movements = await StockMovement.find({ productId: product.id }).lean();
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: 'OPENING', quantity: 40, balanceAfter: 40 });
    expect(String(movements[0]!.reference!.id)).toBe(doc.id);
  });

  it('keeps quantities separate per warehouse', async () => {
    await openingStock(admin, main.id, [{ productId: product.id, quantity: 25 }]);
    await openingStock(admin, east.id, [{ productId: product.id, quantity: 7 }]);
    expect(await onHand(product.id, main.id)).toBe(25);
    expect(await onHand(product.id, east.id)).toBe(7);

    const levels = await admin.get(`/stock/levels?productId=${product.id}&sort=sku`);
    expect(
      levels.body.data.map((l: { warehouse: { code: string }; onHand: number }) => [
        l.warehouse.code,
        l.onHand,
      ]),
    ).toEqual([
      ['EAST', 7],
      ['MAIN', 25],
    ]);

    const detail = await admin.get(`/products/${product.id}`);
    expect(detail.body.data.stock).toMatchObject({
      onHand: 32,
      available: 32,
      stockedWarehouses: 2,
    });

    const mainOnly = await admin.get(`/products?warehouseId=${main.id}`);
    expect(mainOnly.body.data[0].stock.onHand).toBe(25);
  });

  it('is allowed only once per product and warehouse', async () => {
    await openingStock(admin, main.id, [{ productId: product.id, quantity: 10 }]);
    const again = await admin.post('/stock/opening', {
      warehouseId: main.id,
      lines: [{ productId: product.id, quantity: 5 }],
    });
    expect(again.status).toBe(400);
    expect(again.body.error.details[0].path).toBe('lines.0.productId');
    expect(await onHand(product.id, main.id)).toBe(10);

    // A different warehouse is still a first registration.
    await openingStock(admin, east.id, [{ productId: product.id, quantity: 5 }]);
  });

  it('sets the weighted average cost from opening costs', async () => {
    await openingStock(admin, main.id, [{ productId: product.id, quantity: 10, unitCost: 1000 }]);
    await openingStock(admin, east.id, [{ productId: product.id, quantity: 30, unitCost: 2000 }]);
    // (10 × 1000 + 30 × 2000) / 40 = 1750
    expect((await Product.findById(product.id).lean())!.avgCost).toBe(1750);
  });

  it('rejects inactive products and warehouses without side effects', async () => {
    await admin.patch(`/products/${product.id}`, { isActive: false }).expect(200);
    const inactiveProduct = await admin.post('/stock/opening', {
      warehouseId: main.id,
      lines: [{ productId: product.id, quantity: 1 }],
    });
    expect(inactiveProduct.status).toBe(400);

    const other = await createProduct(admin, category.id);
    await admin.patch(`/warehouses/${east.id}`, { isActive: false }).expect(200);
    const inactiveWarehouse = await admin.post('/stock/opening', {
      warehouseId: east.id,
      lines: [{ productId: other.id, quantity: 1 }],
    });
    expect(inactiveWarehouse.status).toBe(400);
    expect(await StockMovement.countDocuments()).toBe(0);
  });
});

describe('stock adjustments', () => {
  beforeEach(async () => {
    await openingStock(admin, main.id, [{ productId: product.id, quantity: 20 }]);
  });

  it('records stock-in and stock-out with running balances', async () => {
    const out = await adjust(main.id, [{ productId: product.id, quantityChange: -8 }], 'damage');
    expect(out.status).toBe(201);
    expect(out.body.data).toMatchObject({
      type: 'adjustment',
      reason: 'damage',
      totalOut: 8,
      lines: [{ quantityChange: -8, previousOnHand: 20, balanceAfter: 12 }],
    });
    expect(out.body.data.number).toMatch(/^ADJ-\d{4}-00001$/);

    await adjust(main.id, [{ productId: product.id, quantityChange: 3 }], 'found').expect(201);
    expect(await onHand(product.id, main.id)).toBe(15);

    const history = await admin.get(`/stock/movements?productId=${product.id}`);
    expect(
      history.body.data.map((m: { quantity: number; balanceAfter: number }) => [
        m.quantity,
        m.balanceAfter,
      ]),
    ).toEqual([
      [3, 15],
      [-8, 12],
      [20, 20],
    ]);

    const stockOut = await admin.get(`/stock/movements?productId=${product.id}&direction=out`);
    expect(stockOut.body.data.map((m: { quantity: number }) => m.quantity)).toEqual([-8]);
    const stockIn = await admin.get(`/stock/movements?productId=${product.id}&direction=in`);
    expect(stockIn.body.meta.total).toBe(2);
    expect(stockIn.body.data[0]).toMatchObject({
      type: 'ADJUSTMENT',
      warehouse: { code: 'MAIN' },
      reference: { type: 'adjustment' },
    });
  });

  it('refuses to remove more than is available and leaves nothing half-applied', async () => {
    const second = await createProduct(admin, category.id);
    await openingStock(admin, main.id, [{ productId: second.id, quantity: 5 }]);
    const movementsBefore = await StockMovement.countDocuments();

    const res = await adjust(main.id, [
      { productId: product.id, quantityChange: -4 },
      { productId: second.id, quantityChange: -6 },
    ]);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.error.details[0].path).toBe('lines.1.quantityChange');

    // The first line's change was rolled back with the failed transaction.
    expect(await onHand(product.id, main.id)).toBe(20);
    expect(await onHand(second.id, main.id)).toBe(5);
    expect(await StockMovement.countDocuments()).toBe(movementsBefore);
    expect(await StockAdjustment.countDocuments({ type: 'adjustment' })).toBe(0);

    // The aborted document number was not consumed.
    const ok = await adjust(main.id, [{ productId: product.id, quantityChange: -1 }]);
    expect(ok.body.data.number).toMatch(/-00001$/);
  });

  it('cannot remove stock from a warehouse that never held it', async () => {
    const res = await adjust(east.id, [{ productId: product.id, quantityChange: -1 }]);
    expect(res.status).toBe(409);
    expect(await StockLevel.countDocuments({ warehouseId: east.id })).toBe(0);
  });

  it('protects reserved stock', async () => {
    await StockLevel.updateOne({ productId: product.id, warehouseId: main.id }, { reserved: 15 });
    const tooMuch = await adjust(main.id, [{ productId: product.id, quantityChange: -6 }]);
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.message).toContain('Only 5');

    await adjust(main.id, [{ productId: product.id, quantityChange: -5 }]).expect(201);
    const level = await admin.get(`/stock/levels?productId=${product.id}`);
    expect(level.body.data[0]).toMatchObject({ onHand: 15, reserved: 15, available: 0 });
  });

  it('turns stock counts into the difference from on-hand', async () => {
    const res = await adjust(main.id, [{ productId: product.id, countedQuantity: 17 }], 'count');
    expect(res.status).toBe(201);
    expect(res.body.data.lines[0]).toMatchObject({
      quantityChange: -3,
      previousOnHand: 20,
      balanceAfter: 17,
    });

    const unchanged = await adjust(
      main.id,
      [{ productId: product.id, countedQuantity: 17 }],
      'count',
    );
    expect(unchanged.status).toBe(409);

    // Counting a product in a new warehouse records the found quantity.
    const newWarehouse = await adjust(
      east.id,
      [{ productId: product.id, countedQuantity: 4 }],
      'count',
    );
    expect(newWarehouse.body.data.lines[0]).toMatchObject({ quantityChange: 4, balanceAfter: 4 });
  });

  it('records the average cost on adjustments without changing it', async () => {
    await adjust(main.id, [{ productId: product.id, quantityChange: 5 }], 'found').expect(201);
    const movement = await StockMovement.findOne({ type: 'ADJUSTMENT' }).lean();
    expect(movement!.unitCost).toBe(1000);
    expect((await Product.findById(product.id).lean())!.avgCost).toBe(1000);
  });

  it('allows only admins and inventory managers to adjust', async () => {
    for (const role of ['staff', 'procurement_manager', 'sales_manager'] as const) {
      const client = api(app, await tokenFor(app, role));
      const res = await adjust(
        main.id,
        [{ productId: product.id, quantityChange: 1 }],
        'found',
        client,
      );
      expect(res.status, role).toBe(403);
    }
    const manager = api(app, await tokenFor(app, 'inventory_manager'));
    await adjust(main.id, [{ productId: product.id, quantityChange: 1 }], 'found', manager).expect(
      201,
    );
  });

  it('never oversells under concurrent withdrawals', async () => {
    await adjust(main.id, [{ productId: product.id, quantityChange: -15 }]).expect(201);
    expect(await onHand(product.id, main.id)).toBe(5);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        adjust(main.id, [{ productId: product.id, quantityChange: -1 }]),
      ),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);
    expect(await onHand(product.id, main.id)).toBe(0);

    const numbers = results
      .filter((r) => r.status === 201)
      .map((r) => r.body.data.number as string);
    expect(new Set(numbers).size).toBe(5);
  });

  it('handles concurrent stock-in to a brand-new location', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        adjust(east.id, [{ productId: product.id, quantityChange: 2 }], 'found'),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await onHand(product.id, east.id)).toBe(12);
    expect(await StockLevel.countDocuments({ productId: product.id, warehouseId: east.id })).toBe(
      1,
    );
  });
});

describe('stock levels and low-stock thresholds', () => {
  it('flags low stock per warehouse with optional overrides', async () => {
    await openingStock(admin, main.id, [{ productId: product.id, quantity: 4 }]);
    await openingStock(admin, east.id, [{ productId: product.id, quantity: 9 }]);

    const low = await admin.get('/stock/levels?status=low');
    expect(low.body.data.map((l: { warehouse: { code: string } }) => l.warehouse.code)).toEqual([
      'MAIN',
    ]);
    expect(low.body.data[0]).toMatchObject({
      reorderPoint: 5,
      reorderPointOverride: null,
      isLow: true,
    });

    const eastLevel = (await admin.get(`/stock/levels?warehouseId=${east.id}`)).body.data[0];
    const updated = await admin.patch(`/stock/levels/${eastLevel.id}`, { reorderPoint: 12 });
    expect(updated.body.data).toMatchObject({
      reorderPoint: 12,
      reorderPointOverride: 12,
      isLow: true,
    });

    const both = await admin.get('/stock/levels?status=low');
    expect(both.body.meta.total).toBe(2);

    await admin.patch(`/stock/levels/${eastLevel.id}`, { reorderPoint: null }).expect(200);
    expect((await admin.get('/stock/levels?status=low')).body.meta.total).toBe(1);

    // Changing a threshold is not a stock movement.
    expect(await StockMovement.countDocuments()).toBe(2);
  });

  it('filters by search, category, warehouse and availability', async () => {
    const other = await createCategory(admin, { code: 'OT' });
    const widget = await createProduct(admin, other.id, { name: 'Widget' });
    await openingStock(admin, main.id, [
      { productId: product.id, quantity: 3 },
      { productId: widget.id, quantity: 8 },
    ]);
    await adjust(main.id, [{ productId: product.id, quantityChange: -3 }]).expect(201);

    const total = async (qs: string) => (await admin.get(`/stock/levels?${qs}`)).body.meta.total;
    expect(await total('search=widget')).toBe(1);
    expect(await total(`categoryId=${other.id}`)).toBe(1);
    expect(await total(`warehouseId=${east.id}`)).toBe(0);
    expect(await total('status=out')).toBe(1);
    expect(await total('status=available')).toBe(1);

    const staff = api(app, await tokenFor(app, 'staff'));
    expect((await staff.get('/stock/levels')).status).toBe(200);
    expect(
      (await staff.patch(`/stock/levels/000000000000000000000000`, { reorderPoint: 1 })).status,
    ).toBe(403);
  });

  it('lists adjustment documents by type and warehouse', async () => {
    await openingStock(admin, main.id, [{ productId: product.id, quantity: 10 }]);
    await adjust(main.id, [{ productId: product.id, quantityChange: -2 }], 'damage').expect(201);

    const all = await admin.get('/stock/adjustments');
    expect(all.body.data.map((d: { type: string }) => d.type)).toEqual(['adjustment', 'opening']);
    const openings = await admin.get('/stock/adjustments?type=opening');
    expect(openings.body.meta.total).toBe(1);

    const doc = await admin.get(`/stock/adjustments/${all.body.data[0].id}`);
    expect(doc.body.data).toMatchObject({
      reason: 'damage',
      createdBy: { name: expect.any(String) },
    });
  });

  it('filters the movement ledger by date range', async () => {
    await openingStock(admin, main.id, [{ productId: product.id, quantity: 10 }]);
    const today = new Date().toISOString().slice(0, 10);
    expect((await admin.get(`/stock/movements?from=${today}&to=${today}`)).body.meta.total).toBe(1);
    expect((await admin.get('/stock/movements?to=2000-01-01')).body.meta.total).toBe(0);
    expect((await admin.get('/stock/movements?from=not-a-date')).status).toBe(400);
  });
});
