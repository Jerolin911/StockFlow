import type { Express } from 'express';
import request from 'supertest';
import { expect } from 'vitest';
import type { CategoryDto, CustomerDto, ProductDto, Role, WarehouseDto } from '@stockflow/shared';
import { CustomerReturn, SupplierReturn } from '../src/modules/returns/models.js';
import { SalesOrder, Shipment } from '../src/modules/sales/models.js';
import { StockTransfer } from '../src/modules/warehouse-ops/models.js';
import { StockLevel } from '../src/modules/stock/stock-level.model.js';
import { StockMovement } from '../src/modules/stock/stock-movement.model.js';
import { bearer, createAndLogin } from './helpers.js';

export async function tokenFor(app: Express, role: Role) {
  return (await createAndLogin(app, role)).accessToken;
}

export function api(app: Express, token: string) {
  const auth = bearer(token);
  return {
    get: (url: string) => request(app).get(`/api/v1${url}`).set(auth),
    post: (url: string, body: object) => request(app).post(`/api/v1${url}`).set(auth).send(body),
    patch: (url: string, body: object) => request(app).patch(`/api/v1${url}`).set(auth).send(body),
    put: (url: string, body: object) => request(app).put(`/api/v1${url}`).set(auth).send(body),
    delete: (url: string) => request(app).delete(`/api/v1${url}`).set(auth),
  };
}

export type Api = ReturnType<typeof api>;

let seq = 0;

export async function createCategory(
  client: Api,
  overrides: Partial<{ name: string; code: string }> = {},
) {
  seq += 1;
  const res = await client.post('/categories', {
    name: `Category ${seq}`,
    code: `C${seq}`,
    ...overrides,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as CategoryDto;
}

export async function createWarehouse(
  client: Api,
  overrides: Partial<{ code: string; name: string }> = {},
) {
  seq += 1;
  const res = await client.post('/warehouses', {
    code: `WH${seq}`,
    name: `Warehouse ${seq}`,
    ...overrides,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as WarehouseDto;
}

export async function createProduct(
  client: Api,
  categoryId: string,
  overrides: Record<string, unknown> = {},
) {
  seq += 1;
  const res = await client.post('/products', {
    name: `Product ${seq}`,
    categoryId,
    unit: 'pcs',
    costPrice: 1000,
    sellingPrice: 1500,
    ...overrides,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as ProductDto;
}

export async function openingStock(
  client: Api,
  warehouseId: string,
  lines: { productId: string; quantity: number; unitCost?: number }[],
) {
  const res = await client.post('/stock/opening', { warehouseId, lines });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
}

export async function onHand(productId: string, warehouseId: string) {
  const level = await StockLevel.findOne({ productId, warehouseId }).lean();
  return level?.onHand ?? 0;
}

/**
 * Asserts the inventory invariants: every stock level equals the sum of its movements,
 * the latest movement's balance matches on-hand, and nothing is negative or over-reserved.
 */
export async function expectLedgerConsistent() {
  const levels = await StockLevel.find().lean();
  const sums = await StockMovement.aggregate<{
    _id: { productId: string; warehouseId: string; bucket: string };
    total: number;
    last: number;
  }>([
    { $sort: { createdAt: 1, _id: 1 } },
    {
      $group: {
        _id: {
          productId: '$productId',
          warehouseId: '$warehouseId',
          bucket: { $ifNull: ['$bucket', 'usable'] },
        },
        total: { $sum: '$quantity' },
        last: { $last: '$balanceAfter' },
      },
    },
  ]);
  const byKey = new Map(
    sums.map((s) => [`${String(s._id.productId)}:${String(s._id.warehouseId)}:${s._id.bucket}`, s]),
  );

  for (const level of levels) {
    const key = `${String(level.productId)}:${String(level.warehouseId)}`;
    for (const [bucket, balance] of [
      ['usable', level.onHand],
      ['quarantine', level.quarantine ?? 0],
    ] as const) {
      const ledger = byKey.get(`${key}:${bucket}`);
      expect(balance, `${bucket} vs ledger for ${key}`).toBe(ledger?.total ?? 0);
      if (ledger) expect(ledger.last, `last ${bucket} balance for ${key}`).toBe(balance);
      byKey.delete(`${key}:${bucket}`);
    }
    expect(level.onHand).toBeGreaterThanOrEqual(0);
    expect(level.quarantine ?? 0).toBeGreaterThanOrEqual(0);
    expect(level.reserved).toBeGreaterThanOrEqual(0);
    expect(level.reserved).toBeLessThanOrEqual(level.onHand);
  }
  expect([...byKey.keys()], 'movements without a stock level').toEqual([]);
  await expectReservationsConsistent(levels);
  await expectWarehouseOpsConsistent();
}

/**
 * Transfers: TRANSFER_OUT movements equal what was dispatched and TRANSFER_IN movements what
 * was received, damaged or written off. Returns: order-line return counters match active
 * returns, and each return's movements match its quantities.
 */
async function expectWarehouseOpsConsistent() {
  const movementsFor = async (type: string, referenceType: string) => {
    const rows = await StockMovement.aggregate<{ _id: unknown; total: number }>([
      { $match: { type, 'reference.type': referenceType } },
      { $group: { _id: '$reference.id', total: { $sum: '$quantity' } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), r.total]));
  };

  const transfers = await StockTransfer.find().lean();
  const out = await movementsFor('TRANSFER_OUT', 'transfer');
  const into = await movementsFor('TRANSFER_IN', 'transfer');
  for (const t of transfers) {
    const sum = (pick: (l: (typeof t.lines)[number]) => number) =>
      t.lines.reduce((s, l) => s + pick(l), 0);
    for (const l of t.lines) {
      expect(l.receivedQuantity + l.damagedQuantity + l.lostQuantity).toBeLessThanOrEqual(
        l.dispatchedQuantity,
      );
      expect(l.dispatchedQuantity).toBeLessThanOrEqual(l.quantity);
    }
    expect(0 - (out.get(String(t._id)) ?? 0), `${t.number} dispatched`).toBe(
      sum((l) => l.dispatchedQuantity),
    );
    expect(into.get(String(t._id)) ?? 0, `${t.number} received`).toBe(
      sum((l) => l.receivedQuantity + l.damagedQuantity + l.lostQuantity),
    );
  }

  const returns = await CustomerReturn.find().lean();
  const returned = new Map<string, number>();
  const received = await movementsFor('CUSTOMER_RETURN', 'customerReturn');
  for (const r of returns) {
    const total = r.lines.reduce((s, l) => s + l.receivedQuantity, 0);
    expect(received.get(String(r._id)) ?? 0, `${r.number} received`).toBe(total);
    for (const l of r.lines) {
      if (r.status === 'completed') {
        expect(l.restockedQuantity + l.quarantinedQuantity).toBe(l.receivedQuantity);
      }
      const active = ['requested', 'approved'].includes(r.status)
        ? l.quantity
        : ['received', 'completed'].includes(r.status)
          ? l.receivedQuantity
          : 0;
      returned.set(String(l.soLineId), (returned.get(String(l.soLineId)) ?? 0) + active);
    }
  }
  for (const so of await SalesOrder.find().lean()) {
    for (const l of so.lines) {
      expect(l.returnedQuantity ?? 0, `${so.number} ${l.sku} returned`).toBe(
        returned.get(String(l._id)) ?? 0,
      );
      expect(l.returnedQuantity ?? 0).toBeLessThanOrEqual(l.shippedQuantity);
    }
  }

  const supplierReturns = await SupplierReturn.find().lean();
  const sent = await movementsFor('SUPPLIER_RETURN', 'supplierReturn');
  for (const r of supplierReturns) {
    const expected = r.status === 'dispatched' ? r.lines.reduce((s, l) => s + l.quantity, 0) : 0;
    expect(0 - (sent.get(String(r._id)) ?? 0), `${r.number} sent`).toBe(expected);
  }
}

/**
 * Asserts the fulfilment invariants: reserved stock equals what open orders still hold,
 * order line counters agree with their shipments, and SHIPMENT movements match what shipped.
 */
async function expectReservationsConsistent(
  levels: { productId: unknown; warehouseId: unknown; reserved: number }[],
) {
  const orders = await SalesOrder.find({ status: { $ne: 'draft' } }).lean();
  const shipments = await Shipment.find().lean();
  const held = new Map<string, number>();
  const allocated = new Map<string, number>();
  const shipped = new Map<string, number>();
  const shippedByKey = new Map<string, number>();

  for (const so of orders) {
    for (const l of so.lines) {
      const key = `${String(l.productId)}:${String(so.warehouseId)}`;
      held.set(key, (held.get(key) ?? 0) + l.quantity - l.shippedQuantity - l.cancelledQuantity);
      expect(
        l.allocatedQuantity + l.shippedQuantity + l.cancelledQuantity,
        `${so.number} ${l.sku} is over-committed`,
      ).toBeLessThanOrEqual(l.quantity);
      expect(l.deliveredQuantity).toBeLessThanOrEqual(l.shippedQuantity);
      allocated.set(String(l._id), 0);
      shipped.set(String(l._id), 0);
    }
  }
  for (const s of shipments) {
    for (const l of s.lines) {
      const id = String(l.soLineId);
      const units = l.pickedQuantity ?? l.quantity;
      if (['picking', 'picked', 'packed'].includes(s.status)) {
        allocated.set(id, (allocated.get(id) ?? 0) + units);
      } else if (s.status !== 'cancelled') {
        shipped.set(id, (shipped.get(id) ?? 0) + units);
        const key = `${String(l.productId)}:${String(s.warehouseId)}`;
        shippedByKey.set(key, (shippedByKey.get(key) ?? 0) + units);
      }
    }
  }
  for (const so of orders) {
    for (const l of so.lines) {
      expect(l.allocatedQuantity, `${so.number} ${l.sku} allocated`).toBe(
        allocated.get(String(l._id)),
      );
      expect(l.shippedQuantity, `${so.number} ${l.sku} shipped`).toBe(shipped.get(String(l._id)));
    }
  }
  for (const level of levels) {
    const key = `${String(level.productId)}:${String(level.warehouseId)}`;
    expect(level.reserved, `reserved for ${key}`).toBe(held.get(key) ?? 0);
    held.delete(key);
  }
  expect(
    [...held.entries()].filter(([, units]) => units !== 0),
    'reservations without a stock level',
  ).toEqual([]);

  const issued = await StockMovement.aggregate<{ _id: { p: unknown; w: unknown }; total: number }>([
    { $match: { type: 'SHIPMENT' } },
    { $group: { _id: { p: '$productId', w: '$warehouseId' }, total: { $sum: '$quantity' } } },
  ]);
  const issuedByKey = new Map(
    issued.map((i) => [`${String(i._id.p)}:${String(i._id.w)}`, -i.total]),
  );
  expect(Object.fromEntries(issuedByKey), 'SHIPMENT movements vs dispatched shipments').toEqual(
    Object.fromEntries(shippedByKey),
  );
}

export async function createCustomer(client: Api, overrides: Record<string, unknown> = {}) {
  seq += 1;
  const res = await client.post('/customers', { name: `Customer ${seq}`, ...overrides });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as CustomerDto;
}

export async function reserved(productId: string, warehouseId: string) {
  const level = await StockLevel.findOne({ productId, warehouseId }).lean();
  return level?.reserved ?? 0;
}
