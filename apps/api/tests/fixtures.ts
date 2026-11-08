import type { Express } from 'express';
import request from 'supertest';
import { expect } from 'vitest';
import type { CategoryDto, CustomerDto, ProductDto, Role, WarehouseDto } from '@stockflow/shared';
import { SalesOrder, Shipment } from '../src/modules/sales/models.js';
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
    _id: { productId: string; warehouseId: string };
    total: number;
  }>([
    { $sort: { createdAt: 1, _id: 1 } },
    {
      $group: {
        _id: { productId: '$productId', warehouseId: '$warehouseId' },
        total: { $sum: '$quantity' },
        last: { $last: '$balanceAfter' },
      },
    },
  ]);
  const byKey = new Map(
    sums.map((s) => [`${String(s._id.productId)}:${String(s._id.warehouseId)}`, s]),
  );

  for (const level of levels) {
    const key = `${String(level.productId)}:${String(level.warehouseId)}`;
    const ledger = byKey.get(key) as { total: number; last: number } | undefined;
    expect(level.onHand, `on-hand vs ledger for ${key}`).toBe(ledger?.total ?? 0);
    if (ledger) expect(ledger.last, `last balance for ${key}`).toBe(level.onHand);
    expect(level.onHand).toBeGreaterThanOrEqual(0);
    expect(level.reserved).toBeGreaterThanOrEqual(0);
    expect(level.reserved).toBeLessThanOrEqual(level.onHand);
    byKey.delete(key);
  }
  expect([...byKey.keys()], 'movements without a stock level').toEqual([]);
  await expectReservationsConsistent(levels);
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
