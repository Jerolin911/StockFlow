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
