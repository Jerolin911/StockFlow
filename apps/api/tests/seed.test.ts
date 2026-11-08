import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { DEMO_PASSWORD, seedDatabase } from '../scripts/seed-data.js';
import { api, expectLedgerConsistent } from './fixtures.js';
import { login } from './helpers.js';

const app = createApp();

describe('demo seed', () => {
  it('produces consistent stock and keeps unique constraints after rebuilding the database', async () => {
    await seedDatabase();
    await expectLedgerConsistent();

    const { accessToken } = await login(app, 'admin@stockflow.test', DEMO_PASSWORD);
    const admin = api(app, accessToken);

    const low = await admin.get('/stock/levels?status=low');
    expect(low.body.meta.total).toBe(5);

    const orders = await admin.get('/sales-orders?pageSize=100');
    expect(
      Object.fromEntries(
        ['draft', 'confirmed', 'partially_shipped', 'delivered', 'cancelled'].map((status) => [
          status,
          orders.body.data.filter((o: { status: string }) => o.status === status).length,
        ]),
      ),
    ).toEqual({ draft: 1, confirmed: 3, partially_shipped: 1, delivered: 1, cancelled: 1 });
    const summary = await admin.get('/sales-orders/fulfilment-summary');
    expect(summary.body.data).toEqual({
      ordersToConfirm: 1,
      ordersToFulfil: 2,
      shipmentsToPick: 1,
      shipmentsToPack: 0,
      shipmentsToDispatch: 1,
      shipmentsInTransit: 1,
    });

    const ops = await admin.get('/warehouse-ops/summary');
    expect(ops.body.data).toEqual({
      transfersToApprove: 1,
      transfersToDispatch: 0,
      transfersInTransit: 1,
      countsInProgress: 1,
      returnsToApprove: 0,
      returnsToReceive: 0,
      returnsToInspect: 1,
      supplierReturnsOpen: 1,
      quarantinedUnits: 4,
    });

    const products = await admin.get('/products?pageSize=100');
    const existing = products.body.data[0];
    const duplicateSku = await admin.post('/products', {
      name: 'Duplicate',
      categoryId: existing.category.id,
      unit: 'pcs',
      costPrice: 1,
      sellingPrice: 1,
      sku: existing.sku,
    });
    expect(duplicateSku.status).toBe(409);

    const duplicateUser = await admin.post('/users', {
      name: 'Duplicate',
      email: 'staff@stockflow.test',
      role: 'staff',
      password: 'long-enough-password',
    });
    expect(duplicateUser.status).toBe(409);
  });
});
