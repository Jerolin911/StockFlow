import { beforeEach, describe, expect, it } from 'vitest';
import type {
  AvailabilityRowDto,
  CategoryDto,
  CategoryReportRowDto,
  DeliveryRowDto,
  FulfilmentStatsDto,
  OverviewDto,
  PendingPurchaseRowDto,
  ProductDto,
  PurchaseOrderDto,
  SalesOrderDto,
  SalesOrderReportRowDto,
  ShipmentDto,
  SupplierDto,
  SupplierPerformanceDto,
  TopProductRowDto,
  TransferDto,
  TrendDto,
  VelocityRowDto,
  WarehouseDto,
} from '@stockflow/shared';
import { createApp } from '../src/app.js';
import { PurchaseOrder } from '../src/modules/purchasing/models.js';
import {
  api,
  createCategory,
  createCustomer,
  createProduct,
  createWarehouse,
  openingStock,
  tokenFor,
  type Api,
} from './fixtures.js';

const app = createApp();
let admin: Api;
let inventory: Api;
let procurement: Api;
let sales: Api;
let staff: Api;
let office: CategoryDto;
let tools: CategoryDto;
let main: WarehouseDto;
let north: WarehouseDto;
let supplier: SupplierDto;
let paper: ProductDto; // ships well
let drill: ProductDto; // sits on the shelf
let tape: ProductDto; // low stock

const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

beforeEach(async () => {
  admin = api(app, await tokenFor(app, 'admin'));
  inventory = api(app, await tokenFor(app, 'inventory_manager'));
  procurement = api(app, await tokenFor(app, 'procurement_manager'));
  sales = api(app, await tokenFor(app, 'sales_manager'));
  staff = api(app, await tokenFor(app, 'staff'));
  office = await createCategory(admin, { name: 'Office', code: 'OFF' });
  tools = await createCategory(admin, { name: 'Tools', code: 'TLS' });
  main = await createWarehouse(admin, { code: 'MAIN' });
  north = await createWarehouse(admin, { code: 'NORTH' });
  supplier = (await admin.post('/suppliers', { name: 'Acme', leadTimeDays: 5 })).body.data;
  paper = await createProduct(admin, office.id, {
    name: 'Paper',
    costPrice: 300,
    sellingPrice: 500,
  });
  drill = await createProduct(admin, tools.id, {
    name: 'Drill',
    costPrice: 5000,
    sellingPrice: 9000,
  });
  tape = await createProduct(admin, office.id, {
    name: 'Tape',
    costPrice: 100,
    sellingPrice: 200,
    reorderPoint: 10,
  });
  await openingStock(admin, main.id, [
    { productId: paper.id, quantity: 100, unitCost: 300 },
    { productId: drill.id, quantity: 20, unitCost: 5000 },
    { productId: tape.id, quantity: 8, unitCost: 100 },
  ]);
  await openingStock(admin, north.id, [{ productId: paper.id, quantity: 40, unitCost: 300 }]);
});

async function approvedPo(
  lines: { productId: string; quantity: number; unitCost?: number }[],
  expectedDate?: string,
) {
  const po = (
    await procurement.post('/purchase-orders', {
      supplierId: supplier.id,
      warehouseId: main.id,
      ...(expectedDate ? { expectedDate } : {}),
      lines,
    })
  ).body.data as PurchaseOrderDto;
  await procurement.post(`/purchase-orders/${po.id}/submit`, {}).expect(200);
  await admin.post(`/purchase-orders/${po.id}/approve`, {}).expect(200);
  return (await admin.get(`/purchase-orders/${po.id}`)).body.data as PurchaseOrderDto;
}

/** Confirms an order and ships all of it; returns the order. */
async function shippedOrder(
  lines: { productId: string; quantity: number; discountRate?: number }[],
  requiredDate?: string,
) {
  const customer = await createCustomer(admin);
  const so = (
    await sales.post('/sales-orders', {
      customerId: customer.id,
      warehouseId: main.id,
      ...(requiredDate ? { requiredDate } : {}),
      lines,
    })
  ).body.data as SalesOrderDto;
  await sales.post(`/sales-orders/${so.id}/confirm`, {}).expect(200);
  const shipment = (
    await staff.post('/shipments', {
      salesOrderId: so.id,
      lines: so.lines.map((l) => ({ soLineId: l.id, quantity: l.quantity })),
    })
  ).body.data as ShipmentDto;
  await staff
    .post(`/shipments/${shipment.id}/pick`, {
      lines: shipment.lines.map((l) => ({ lineId: l.id, pickedQuantity: l.quantity })),
    })
    .expect(200);
  await staff.post(`/shipments/${shipment.id}/pack`, { packageCount: 1 }).expect(200);
  await staff.post(`/shipments/${shipment.id}/dispatch`, { carrier: 'Van' }).expect(200);
  return { so, shipment };
}

describe('dashboard overview', () => {
  it('counts products, stock, low and out-of-stock items and pending work from live records', async () => {
    await admin.post('/products', {
      name: 'Retired',
      categoryId: office.id,
      unit: 'pcs',
      costPrice: 1,
      sellingPrice: 1,
    });
    const retired = (await admin.get('/products?search=Retired')).body.data[0];
    await admin.patch(`/products/${retired.id}`, { isActive: false }).expect(200);
    // Drill sells out in NORTH: give it a level there with nothing available.
    await openingStock(admin, north.id, [{ productId: drill.id, quantity: 1 }]);
    await inventory
      .post('/stock/adjustments', {
        warehouseId: north.id,
        reason: 'loss',
        lines: [{ productId: drill.id, quantityChange: -1 }],
      })
      .expect(201);
    await approvedPo([{ productId: tape.id, quantity: 50 }], daysAgo(2));
    await sales.post('/sales-orders', {
      customerId: (await createCustomer(admin)).id,
      warehouseId: main.id,
      lines: [{ productId: paper.id, quantity: 1 }],
    });

    const res = await inventory.get('/reports/overview');
    expect(res.status).toBe(200);
    const o = res.body.data as OverviewDto;
    expect(o.products).toEqual({ active: 3, inactive: 1 });
    expect(o.stock).toMatchObject({ onHand: 168, reserved: 0, available: 168, quarantine: 0 });
    // 100×3.00 + 20×50.00 + 8×1.00 + 40×3.00
    expect(o.stock.value).toBe(30000 + 100000 + 800 + 12000);
    expect(o.lowStock).toBe(1); // tape in MAIN
    expect(o.outOfStock).toBe(1); // drill in NORTH
    expect(o.warehouses.map((w) => [w.warehouse.code, w.onHand, w.skus])).toEqual([
      ['MAIN', 128, 3],
      ['NORTH', 40, 1],
    ]);
    expect(o.purchasing).toEqual({ pendingApproval: 0, open: 1, overdue: 1, pendingUnits: 50 });
    expect(o.sales).toMatchObject({ toConfirm: 1, open: 0 });
    expect(o.recentMovements).toHaveLength(6);
    expect(o.recentMovements[0]!.type).toBe('ADJUSTMENT');

    // Without reports:inventory, cost-based values are withheld.
    const staffView = (await staff.get('/reports/overview')).body.data as OverviewDto;
    expect(staffView.stock.value).toBeNull();
    expect(staffView.warehouses.every((w) => w.value === null)).toBe(true);
  });
});

describe('inventory analytics', () => {
  it('trends units in and out, and classifies fast and slow movers by days of cover', async () => {
    await shippedOrder([{ productId: paper.id, quantity: 60 }]);
    const trend = (
      await inventory.get(`/reports/inventory/movement-trend?from=${daysAgo(6)}&to=${today}`)
    ).body.data as TrendDto;
    expect(trend.interval).toBe('day');
    expect(trend.points).toHaveLength(7);
    expect(trend.points.at(-1)!.values).toEqual({ in: 168, out: 60 });
    expect(trend.points.slice(0, -1).every((p) => p.values.in === 0 && p.values.out === 0)).toBe(
      true,
    );

    const velocity = await inventory.get(
      `/reports/inventory/velocity?from=${daysAgo(29)}&to=${today}`,
    );
    const rows = velocity.body.data as VelocityRowDto[];
    // 60 shipped over 30 days = 2/day; 80 left = 40 days of cover → steady.
    expect(rows[0]).toMatchObject({
      product: { sku: paper.sku },
      unitsOut: 60,
      dailyRate: 2,
      onHand: 80,
      daysOfCover: 40,
      movement: 'normal',
    });
    expect(rows.find((r) => r.product.id === drill.id)).toMatchObject({
      unitsOut: 0,
      movement: 'slow',
    });

    // Over the last week, the same 60 units are 8.57/day: fast.
    const week = (
      await inventory.get(
        `/reports/inventory/velocity?from=${daysAgo(6)}&to=${today}&movement=fast`,
      )
    ).body.data as VelocityRowDto[];
    expect(week.map((r) => r.product.id)).toEqual([paper.id]);

    const byWarehouse = (await inventory.get(`/reports/inventory/velocity?warehouseId=${north.id}`))
      .body.data as VelocityRowDto[];
    expect(byWarehouse.find((r) => r.product.id === paper.id)).toMatchObject({
      onHand: 40,
      unitsOut: 0,
    });
  });

  it('reports availability with incoming and in-transit stock, and category totals', async () => {
    await approvedPo([{ productId: tape.id, quantity: 30 }]);
    const t = (
      await staff.post('/stock-transfers', {
        fromWarehouseId: main.id,
        toWarehouseId: north.id,
        lines: [{ productId: paper.id, quantity: 10 }],
      })
    ).body.data as TransferDto;
    await inventory.post(`/stock-transfers/${t.id}/approve`, {}).expect(200);
    await staff.post(`/stock-transfers/${t.id}/dispatch`, {}).expect(200);

    const res = await inventory.get('/reports/inventory/availability');
    const rows = res.body.data as AvailabilityRowDto[];
    expect(rows.find((r) => r.product.id === tape.id)).toMatchObject({
      available: 8,
      incoming: 30,
      reorderPoint: 10,
      status: 'low',
    });
    expect(rows.find((r) => r.product.id === paper.id)).toMatchObject({
      onHand: 130,
      inTransit: 10,
    });
    const northOnly = (
      await inventory.get(`/reports/inventory/availability?warehouseId=${north.id}&status=out`)
    ).body.data as AvailabilityRowDto[];
    expect(northOnly.map((r) => r.product.id).sort()).toEqual([drill.id, tape.id].sort());

    const categories = (await inventory.get('/reports/inventory/categories')).body
      .data as CategoryReportRowDto[];
    expect(categories.find((c) => c.category?.name === 'Office')).toMatchObject({
      products: 2,
      onHand: 138,
      value: 130 * 300 + 8 * 100,
    });
    expect(categories.find((c) => c.category?.name === 'Tools')).toMatchObject({
      products: 1,
      onHand: 20,
    });
  });

  it('exports CSV with escaped cells and neutralised formulas', async () => {
    await admin
      .patch(`/products/${drill.id}`, { name: '=HYPERLINK("x"), "big" drill' })
      .expect(200);
    const res = await inventory.get('/reports/inventory/availability?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="inventory-availability.csv"',
    );
    const lines = res.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toBe(
      'SKU,Product,Category,On hand,Reserved,Available,Quarantine,Incoming,In transit,Reorder point,Status',
    );
    expect(lines).toHaveLength(4);
    expect(lines.find((l) => l.startsWith(drill.sku))).toContain(
      `"'=HYPERLINK(""x""), ""big"" drill"`,
    );
  });

  it('restricts analytics by permission and validates ranges', async () => {
    expect((await staff.get('/reports/inventory/velocity')).status).toBe(403);
    expect((await sales.get('/reports/inventory/availability')).status).toBe(403);
    expect((await sales.get('/reports/purchasing/suppliers')).status).toBe(403);
    expect((await procurement.get('/reports/sales/top-products')).status).toBe(403);
    expect((await inventory.get('/reports/sales/trend')).status).toBe(403);
    const backwards = await inventory.get(
      `/reports/inventory/movement-trend?from=${today}&to=${daysAgo(3)}`,
    );
    expect(backwards.status).toBe(400);
    expect(backwards.body.error.details[0].path).toBe('to');
    const tooLong = await inventory.get(
      '/reports/inventory/movement-trend?from=2020-01-01&to=2026-01-01',
    );
    expect(tooLong.status).toBe(400);
  });
});

describe('procurement analytics', () => {
  it('measures supplier delivery performance and lists pending quantities', async () => {
    const late = await approvedPo([{ productId: tape.id, quantity: 20, unitCost: 90 }]);
    await PurchaseOrder.updateOne(
      { _id: late.id },
      { expectedDate: new Date(`${daysAgo(3)}T00:00:00Z`) },
    );
    const onTime = await approvedPo([{ productId: paper.id, quantity: 10 }], daysAgo(-5));

    const receive = (po: PurchaseOrderDto, accepted: number, damaged = 0) =>
      staff.post('/goods-receipts', {
        purchaseOrderId: po.id,
        lines: [
          {
            poLineId: po.lines[0]!.id,
            acceptedQuantity: accepted,
            damagedQuantity: damaged,
            rejectionReason: damaged ? 'Crushed' : '',
          },
        ],
      });
    await receive(late, 15, 5).expect(201);
    await receive(onTime, 10).expect(201);

    const perf = (await procurement.get('/reports/purchasing/suppliers')).body
      .data as SupplierPerformanceDto[];
    expect(perf).toEqual([
      expect.objectContaining({
        supplier: expect.objectContaining({ name: 'Acme' }),
        orders: 2,
        orderedValue: 20 * 90 + 10 * 300,
        receipts: 2,
        onTime: 1,
        late: 1,
        onTimeRate: 0.5,
        averageDaysLate: 1.5,
        acceptedUnits: 25,
        damagedUnits: 5,
        issueRate: 0.1667,
        openOrders: 1,
        overdueOrders: 1,
      }),
    ]);

    const deliveriesRes = (await procurement.get('/reports/purchasing/deliveries')).body;
    expect(deliveriesRes.meta.total).toBe(2);
    const lateRow = (deliveriesRes.data as DeliveryRowDto[]).find(
      (d) => d.purchaseOrder.id === late.id,
    )!;
    expect(lateRow).toMatchObject({ daysLate: 3, acceptedUnits: 15, damagedUnits: 5 });

    const pending = (await procurement.get('/reports/purchasing/pending')).body;
    expect(pending.data as PendingPurchaseRowDto[]).toEqual([
      expect.objectContaining({ ordered: 20, received: 15, pending: 5, isOverdue: true }),
    ]);

    const trend = (await procurement.get('/reports/purchasing/trend')).body.data as TrendDto;
    expect(trend.points.at(-1)!.values).toEqual({ orders: 2, value: 4800, received: 25 });

    const csv = await procurement.get('/reports/purchasing/pending?format=csv');
    expect(csv.text).toContain(
      'Purchase order,Supplier,Warehouse,SKU,Product,Ordered,Received,Pending,Expected,Overdue',
    );
  });
});

describe('sales analytics', () => {
  it('ranks top products by units with net revenue and reports fulfilment', async () => {
    await shippedOrder([{ productId: paper.id, quantity: 30, discountRate: 1000 }], daysAgo(-3));
    await shippedOrder([
      { productId: paper.id, quantity: 10 },
      { productId: drill.id, quantity: 2 },
    ]);
    const pending = await sales.post('/sales-orders', {
      customerId: (await createCustomer(admin)).id,
      warehouseId: main.id,
      lines: [{ productId: drill.id, quantity: 1 }],
    });
    await sales.post(`/sales-orders/${pending.body.data.id}/confirm`, {}).expect(200);

    const top = (await sales.get('/reports/sales/top-products')).body.data as TopProductRowDto[];
    expect(top.map((t) => [t.product.sku, t.unitsShipped, t.orders])).toEqual([
      [paper.sku, 40, 2],
      [drill.sku, 2, 1],
    ]);
    // 30 × 5.00 less 10% = 135.00, plus 10 × 5.00 = 50.00.
    expect(top[0]!.revenue).toBe(13500 + 5000);
    expect(top[0]!.cost).toBe(40 * 300);

    const stats = (await sales.get('/reports/sales/fulfilment')).body.data as FulfilmentStatsDto;
    expect(stats).toMatchObject({
      ordersCreated: 3,
      ordersConfirmed: 3,
      ordersCompleted: 2,
      ordersCancelled: 0,
      unitsShipped: 42,
      shipmentsDispatched: 2,
      shortPicks: 0,
      openByStatus: { confirmed: 1, shipped: 2 },
      shipmentsByStatus: { dispatched: 2 },
    });
    expect(stats.averageHoursToDispatch).toBeGreaterThanOrEqual(0);

    const trend = (await sales.get('/reports/sales/trend')).body.data as TrendDto;
    expect(trend.points.at(-1)!.values).toMatchObject({ orders: 3, shipped: 42 });

    const pendingOrders = (await sales.get('/reports/sales/orders?state=pending')).body;
    expect(pendingOrders.meta.total).toBe(1);
    const completed = (await sales.get('/reports/sales/orders?state=completed')).body
      .data as SalesOrderReportRowDto[];
    expect(completed.map((r) => r.shipped).sort()).toEqual([12, 30]);
  });
});
