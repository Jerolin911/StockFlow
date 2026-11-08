import { beforeEach, describe, expect, it } from 'vitest';
import { ROLES } from '@stockflow/shared';
import { createApp } from '../src/app.js';
import { Product } from '../src/modules/products/product.model.js';
import {
  api,
  createCategory,
  createProduct,
  createWarehouse,
  openingStock,
  tokenFor,
  type Api,
} from './fixtures.js';

const app = createApp();
let admin: Api;

beforeEach(async () => {
  admin = api(app, await tokenFor(app, 'admin'));
});

describe('settings', () => {
  it('returns defaults and lets only admins change them', async () => {
    const res = await admin.get('/settings');
    expect(res.body.data).toEqual({ companyName: 'My Company', currency: 'USD' });

    const staff = api(app, await tokenFor(app, 'staff'));
    expect((await staff.get('/settings')).status).toBe(200);
    expect((await staff.patch('/settings', { currency: 'EUR' })).status).toBe(403);

    const updated = await admin.patch('/settings', {
      companyName: 'Northwind Supplies',
      currency: 'EUR',
    });
    expect(updated.body.data).toEqual({ companyName: 'Northwind Supplies', currency: 'EUR' });
    expect((await admin.patch('/settings', { currency: 'JPY' })).status).toBe(400);
  });
});

describe('categories', () => {
  it('enforces unique names (case-insensitive) and codes', async () => {
    await createCategory(admin, { name: 'Electronics', code: 'ELC' });
    const dupName = await admin.post('/categories', { name: 'electronics', code: 'EL2' });
    expect(dupName.status).toBe(409);
    expect(dupName.body.error.details[0].path).toBe('name');

    const dupCode = await admin.post('/categories', { name: 'Electrical', code: 'elc' });
    expect(dupCode.status).toBe(409);
    expect(dupCode.body.error.details[0].path).toBe('code');
  });

  it('counts products and blocks deleting categories in use', async () => {
    const used = await createCategory(admin);
    const unused = await createCategory(admin);
    await createProduct(admin, used.id);

    const list = await admin.get('/categories');
    const row = list.body.data.find((c: { id: string }) => c.id === used.id);
    expect(row.productCount).toBe(1);

    expect((await admin.delete(`/categories/${used.id}`)).status).toBe(409);
    expect((await admin.delete(`/categories/${unused.id}`)).status).toBe(204);
  });

  it('restricts writes to admins and inventory managers', async () => {
    const allowed = new Set(['admin', 'inventory_manager']);
    for (const role of ROLES) {
      const client = api(app, await tokenFor(app, role));
      const res = await client.post('/categories', {
        name: `By ${role}`,
        code: role.slice(0, 4).toUpperCase(),
      });
      expect(res.status, role).toBe(allowed.has(role) ? 201 : 403);
      expect((await client.get('/categories')).status).toBe(200);
    }
  });
});

describe('warehouses', () => {
  it('creates, lists and rejects duplicate codes', async () => {
    const created = await createWarehouse(admin, { code: 'main', name: 'Main Warehouse' });
    expect(created).toMatchObject({
      code: 'MAIN',
      isActive: true,
      stock: { skuCount: 0, onHand: 0 },
    });

    const dup = await admin.post('/warehouses', { code: 'MAIN', name: 'Another' });
    expect(dup.status).toBe(409);

    const list = await admin.get('/warehouses?search=main');
    expect(list.body.meta.total).toBe(1);
  });

  it('only deactivates a warehouse once it holds no stock', async () => {
    const category = await createCategory(admin);
    const product = await createProduct(admin, category.id);
    const warehouse = await createWarehouse(admin);
    await openingStock(admin, warehouse.id, [{ productId: product.id, quantity: 3 }]);

    const summary = await admin.get(`/warehouses/${warehouse.id}`);
    expect(summary.body.data.stock).toEqual({ skuCount: 1, onHand: 3 });

    const blocked = await admin.patch(`/warehouses/${warehouse.id}`, { isActive: false });
    expect(blocked.status).toBe(409);

    await admin
      .post('/stock/adjustments', {
        warehouseId: warehouse.id,
        reason: 'loss',
        lines: [{ productId: product.id, quantityChange: -3 }],
      })
      .expect(201);
    const ok = await admin.patch(`/warehouses/${warehouse.id}`, { isActive: false });
    expect(ok.status).toBe(200);
    expect(ok.body.data.isActive).toBe(false);
  });
});

describe('products and SKUs', () => {
  it('generates sequential SKUs from the category code', async () => {
    const category = await createCategory(admin, { code: 'ELC' });
    const a = await createProduct(admin, category.id);
    const b = await createProduct(admin, category.id);
    expect(a.sku).toBe('ELC-00001');
    expect(b.sku).toBe('ELC-00002');
    expect(a.category).toMatchObject({ id: category.id, code: 'ELC' });
  });

  it('normalises manual SKUs and rejects duplicates regardless of case', async () => {
    const category = await createCategory(admin);
    const product = await createProduct(admin, category.id, { sku: ' lamp-01 ' });
    expect(product.sku).toBe('LAMP-01');

    const dup = await admin.post('/products', {
      name: 'Another lamp',
      categoryId: category.id,
      unit: 'pcs',
      costPrice: 100,
      sellingPrice: 200,
      sku: 'Lamp-01',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details).toEqual([
      { path: 'sku', message: 'This SKU is already in use' },
    ]);
    expect(await Product.countDocuments({ sku: 'LAMP-01' })).toBe(1);
  });

  it('skips generated numbers already taken by a manual SKU', async () => {
    const category = await createCategory(admin, { code: 'TLS' });
    await createProduct(admin, category.id, { sku: 'TLS-00001' });
    const generated = await createProduct(admin, category.id);
    expect(generated.sku).toBe('TLS-00002');
  });

  it('generates unique SKUs under concurrent creation', async () => {
    const category = await createCategory(admin, { code: 'CON' });
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        admin.post('/products', {
          name: `Concurrent ${i}`,
          categoryId: category.id,
          unit: 'pcs',
          costPrice: 100,
          sellingPrice: 150,
        }),
      ),
    );
    const skus = results.map((r) => r.body.data.sku as string);
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(skus).size).toBe(12);
  });

  it('keeps SKUs immutable and barcodes unique', async () => {
    const category = await createCategory(admin);
    const product = await createProduct(admin, category.id, { barcode: '4006381333931' });

    const renamed = await admin.patch(`/products/${product.id}`, {
      name: 'Renamed',
      sku: 'NEW-SKU',
    });
    expect(renamed.status).toBe(200);
    // A partial update leaves every other field as stored.
    expect(renamed.body.data).toEqual({
      ...product,
      name: 'Renamed',
      updatedAt: expect.any(String),
    });

    const dup = await admin.post('/products', {
      name: 'Barcode clash',
      categoryId: category.id,
      unit: 'pcs',
      costPrice: 1,
      sellingPrice: 2,
      barcode: '4006381333931',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details[0].path).toBe('barcode');

    // Several products without barcodes are fine.
    await createProduct(admin, category.id);
    await createProduct(admin, category.id);
  });

  it('validates input and the category reference', async () => {
    const res = await admin.post('/products', {
      name: '',
      categoryId: '000000000000000000000000',
      unit: 'crate',
      costPrice: -1,
      sellingPrice: 10.5,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
      'costPrice',
      'name',
      'sellingPrice',
      'unit',
    ]);

    const missingCategory = await admin.post('/products', {
      name: 'Orphan',
      categoryId: '000000000000000000000000',
      unit: 'pcs',
      costPrice: 1,
      sellingPrice: 1,
    });
    expect(missingCategory.status).toBe(400);
    expect(missingCategory.body.error.details[0].path).toBe('categoryId');
  });

  it('lets every role read products but only admins and inventory managers write', async () => {
    const category = await createCategory(admin);
    for (const role of ROLES) {
      const client = api(app, await tokenFor(app, role));
      expect((await client.get('/products')).status).toBe(200);
      const res = await client.post('/products', {
        name: `By ${role}`,
        categoryId: category.id,
        unit: 'pcs',
        costPrice: 1,
        sellingPrice: 1,
      });
      expect(res.status, role).toBe(['admin', 'inventory_manager'].includes(role) ? 201 : 403);
    }
  });

  it('filters by search, category, status and stock state', async () => {
    const tools = await createCategory(admin, { name: 'Tools', code: 'TOOL' });
    const paint = await createCategory(admin, { name: 'Paint', code: 'PNT' });
    const warehouse = await createWarehouse(admin);
    const hammer = await createProduct(admin, tools.id, { name: 'Claw hammer', reorderPoint: 10 });
    const drill = await createProduct(admin, tools.id, { name: 'Cordless drill', reorderPoint: 2 });
    const primer = await createProduct(admin, paint.id, { name: 'Primer 1L' });
    await admin.patch(`/products/${primer.id}`, { isActive: false }).expect(200);
    await openingStock(admin, warehouse.id, [
      { productId: hammer.id, quantity: 4 },
      { productId: drill.id, quantity: 9 },
    ]);

    const names = async (qs: string) =>
      ((await admin.get(`/products?${qs}`)).body.data as { name: string }[]).map((p) => p.name);

    expect(await names('search=drill')).toEqual(['Cordless drill']);
    expect(await names(`search=${hammer.sku.toLowerCase()}`)).toEqual(['Claw hammer']);
    expect(await names(`categoryId=${tools.id}`)).toEqual(['Claw hammer', 'Cordless drill']);
    expect(await names('status=inactive')).toEqual(['Primer 1L']);
    expect(await names('stock=low')).toEqual(['Claw hammer']);
    expect(await names('stock=out')).toEqual(['Primer 1L']);
    expect(await names('stock=in&sort=-name')).toEqual(['Cordless drill', 'Claw hammer']);

    const detail = await admin.get(`/products/${hammer.id}`);
    expect(detail.body.data.stock).toEqual({
      onHand: 4,
      reserved: 0,
      available: 4,
      stockedWarehouses: 1,
      lowStockWarehouses: 1,
    });
  });
});

describe('suppliers and customers', () => {
  it('generates codes, rejects duplicates and searches', async () => {
    const first = await admin.post('/suppliers', {
      name: 'Acme Components',
      email: 'Sales@Acme.test',
      leadTimeDays: 7,
    });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({
      code: 'SUP-0001',
      email: 'sales@acme.test',
      leadTimeDays: 7,
    });

    const second = await admin.post('/suppliers', { name: 'Brightline Paper' });
    expect(second.body.data.code).toBe('SUP-0002');

    const manual = await admin.post('/suppliers', { name: 'Clash', code: 'sup-0002' });
    expect(manual.status).toBe(409);

    const search = await admin.get('/suppliers?search=acme');
    expect(search.body.data.map((s: { name: string }) => s.name)).toEqual(['Acme Components']);

    const customer = await admin.post('/customers', {
      name: 'Harbor Cafe',
      shippingAddress: '12 Pier Rd',
    });
    expect(customer.body.data).toMatchObject({ code: 'CUS-0001', shippingAddress: '12 Pier Rd' });
  });

  it('validates emails and applies role permissions', async () => {
    expect((await admin.post('/customers', { name: 'Bad Email Ltd', email: 'nope' })).status).toBe(
      400,
    );

    const procurement = api(app, await tokenFor(app, 'procurement_manager'));
    const sales = api(app, await tokenFor(app, 'sales_manager'));
    expect((await procurement.post('/suppliers', { name: 'P Supplier' })).status).toBe(201);
    expect((await procurement.post('/customers', { name: 'P Customer' })).status).toBe(403);
    expect((await sales.post('/customers', { name: 'S Customer' })).status).toBe(201);
    expect((await sales.post('/suppliers', { name: 'S Supplier' })).status).toBe(403);
  });

  it('updates and deactivates without changing the code', async () => {
    const created = await admin.post('/customers', { name: 'Old Name' });
    const id = created.body.data.id as string;
    const res = await admin.patch(`/customers/${id}`, {
      name: 'New Name',
      isActive: false,
      code: 'X',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'New Name', isActive: false, code: 'CUS-0001' });

    const inactive = await admin.get('/customers?status=inactive');
    expect(inactive.body.meta.total).toBe(1);
  });
});
