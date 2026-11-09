import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { AuditLogDto } from '@stockflow/shared';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/modules/audit/audit.js';
import { Notification } from '../src/modules/notifications/notifications.js';
import { PurchaseOrder } from '../src/modules/purchasing/models.js';
import { SalesOrder, Shipment } from '../src/modules/sales/models.js';
import { StockMovement } from '../src/modules/stock/stock-movement.model.js';
import { User } from '../src/modules/users/user.model.js';
import { api, createCategory, createProduct, createWarehouse, tokenFor } from './fixtures.js';
import { createUser, TEST_PASSWORD } from './helpers.js';

const app = createApp();
const ROUTERS = [
  '/users',
  '/settings',
  '/warehouses',
  '/categories',
  '/products',
  '/suppliers',
  '/customers',
  '/stock/levels',
  '/purchase-requests',
  '/purchase-orders',
  '/goods-receipts',
  '/sales-orders',
  '/shipments',
  '/stock-transfers',
  '/stock-counts',
  '/customer-returns',
  '/supplier-returns',
  '/warehouse-ops/summary',
  '/reports/overview',
  '/notifications',
  '/audit-logs',
];

/** Waits for an audit entry (they're written after the response is sent). */
async function auditEntry(filter: Record<string, unknown>) {
  for (let i = 0; i < 50; i++) {
    const entry = await AuditLog.findOne(filter).lean();
    if (entry) return entry;
    await new Promise((r) => setTimeout(r, 20));
  }
  return null;
}

describe('authentication and authorisation boundaries', () => {
  it('requires a valid token on every router, for reads and writes', async () => {
    for (const path of ROUTERS) {
      const read = await request(app).get(`/api/v1${path}`);
      expect(read.status, `GET ${path}`).toBe(401);
      const write = await request(app).post(`/api/v1${path}`).send({});
      expect(write.status, `POST ${path}`).toBe(401);
      const forged = await request(app)
        .get(`/api/v1${path}`)
        .set('Authorization', 'Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.');
      expect(forged.status, `forged token on ${path}`).toBe(401);
    }
  });

  it('keeps administration and audit logs to admins', async () => {
    for (const role of [
      'inventory_manager',
      'procurement_manager',
      'sales_manager',
      'staff',
    ] as const) {
      const client = api(app, await tokenFor(app, role));
      expect((await client.get('/users')).status, role).toBe(403);
      expect((await client.get('/audit-logs')).status, role).toBe(403);
      expect((await client.patch('/settings', { companyName: 'x' })).status, role).toBe(403);
    }
  });

  it('cannot escalate its own role or read another user’s notifications', async () => {
    const staff = await createUser({ role: 'staff' });
    const admin = api(app, await tokenFor(app, 'admin'));
    const staffClient = api(app, await tokenFor(app, 'staff'));
    expect((await staffClient.patch(`/users/${staff.id}`, { role: 'admin' })).status).toBe(403);
    const note = await Notification.create({
      userId: staff.id,
      type: 'transfer',
      title: 'Private',
    });
    expect((await admin.post(`/notifications/${note._id.toString()}/read`, {})).status).toBe(404);
  });
});

describe('input handling', () => {
  it('rejects operator injection, malformed ids and bad bodies with clean errors', async () => {
    const admin = api(app, await tokenFor(app, 'admin'));
    // Bracket syntax isn't parsed into objects, so no operator can reach a query...
    const all = (await admin.get('/products')).body.meta.total;
    const bracket = await admin.get('/products?status[$ne]=active');
    expect(bracket.status).toBe(200);
    expect(bracket.body.meta.total).toBe(all);
    // ...and values are validated against their allowed set.
    const operatorValue = await admin.get(
      `/products?status=${encodeURIComponent('{"$ne":"active"}')}`,
    );
    expect(operatorValue.status).toBe(400);
    const badSort = await admin.get('/purchase-orders?sort=$where');
    expect(badSort.status).toBe(400);
    // A malformed id is treated like a missing record: 404, never a database error.
    expect((await admin.get('/products/not-an-id')).status).toBe(404);
    expect((await admin.get('/products/64b7f0c2a1b2c3d4e5f60718')).status).toBe(404);

    const regex = await admin.get(`/products?search=${encodeURIComponent('(a+)+$')}`);
    expect(regex.status).toBe(200);

    const token = await tokenFor(app, 'admin');
    const invalidJson = await request(app)
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send('{"name":');
    expect(invalidJson.body.error.code).toBe('INVALID_JSON');
    const huge = await request(app)
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'x'.repeat(200_000) });
    expect(huge.status).toBe(413);
    // Unknown fields are dropped, not stored.
    const category = await admin.post('/categories', { name: 'Clean', code: 'CLN', isAdmin: true });
    expect(category.status).toBe(201);
    expect(category.body.data.isAdmin).toBeUndefined();
  });

  it('never leaks stack traces or internals in error responses', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/at \w+ \(|node_modules|stack/i);
  });

  it('sends security headers and refuses unlisted cross-origin requests', async () => {
    const res = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('stores passwords only as bcrypt hashes', async () => {
    const user = await createUser({ role: 'staff' });
    const stored = await User.findById(user.id).select('+passwordHash').lean();
    expect(stored!.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(JSON.stringify(stored)).not.toContain(TEST_PASSWORD);
  });
});

describe('audit log', () => {
  it('records successful changes with actor, route and record, but not reads or failures', async () => {
    const adminSession = await tokenFor(app, 'admin');
    const admin = api(app, adminSession);
    const category = await createCategory(admin, { code: 'AUD' });
    const entry = await auditEntry({ entityId: category.id });
    expect(entry).toMatchObject({
      method: 'POST',
      action: '/categories',
      entityType: 'categories',
      status: 201,
      actor: expect.objectContaining({ role: 'admin' }),
    });

    await admin.patch(`/categories/${category.id}`, { name: 'Audited' }).expect(200);
    expect(
      await auditEntry({ entityId: category.id, method: 'PATCH', action: '/categories/:id' }),
    ).not.toBeNull();

    await admin.get('/categories').expect(200);
    await admin.post('/categories', {}).expect(400);
    await new Promise((r) => setTimeout(r, 100));
    expect(await AuditLog.countDocuments({ method: 'GET' })).toBe(0);
    expect(await AuditLog.countDocuments({ status: 400 })).toBe(0);
  });

  it('records failed and successful sign-ins, and lists entries to admins with filters', async () => {
    const user = await createUser({ role: 'staff' });
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'wrong-password' })
      .expect(401);
    const failed = await auditEntry({ path: '/auth/login', status: 401 });
    expect(failed!.actor).toEqual({ email: user.email });

    const admin = api(app, await tokenFor(app, 'admin'));
    await new Promise((r) => setTimeout(r, 50));
    const res = await admin.get('/audit-logs?outcome=failed');
    expect(res.status).toBe(200);
    const rows = res.body.data as AuditLogDto[];
    expect(rows.some((r) => r.path === '/auth/login' && r.status === 401)).toBe(true);
    expect(rows.every((r) => r.status >= 400)).toBe(true);
    const byEntity = await admin.get('/audit-logs?entityType=auth');
    expect(byEntity.body.meta.total).toBeGreaterThanOrEqual(1);
  });
});

describe('indexes', () => {
  /** The winning plan of a query, flattened to its stage names. */
  async function stages(
    model: mongoose.Model<never>,
    filter: Record<string, unknown>,
    sort?: Record<string, 1 | -1>,
  ) {
    await model.createIndexes();
    const explained = (await model
      .find(filter as never)
      .sort(sort ?? {})
      .explain('queryPlanner')) as unknown as {
      queryPlanner: { winningPlan: unknown };
    };
    const names: string[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      const n = node as Record<string, unknown>;
      if (typeof n.stage === 'string') names.push(n.stage);
      for (const value of Object.values(n)) {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') walk(value);
      }
    };
    walk(explained.queryPlanner.winningPlan);
    return names;
  }

  it('serves the report and workflow queries from indexes, not collection scans', async () => {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const cases: [mongoose.Model<never>, Record<string, unknown>, Record<string, 1 | -1>?][] = [
      [
        StockMovement as never,
        { type: { $in: ['RECEIPT', 'SHIPMENT'] }, createdAt: { $gte: since } },
      ],
      [
        StockMovement as never,
        { productId: new mongoose.Types.ObjectId(), warehouseId: new mongoose.Types.ObjectId() },
        { createdAt: -1 },
      ],
      [SalesOrder as never, { confirmedAt: { $gte: since } }],
      [SalesOrder as never, { orderDate: { $gte: since } }],
      [PurchaseOrder as never, { orderDate: { $gte: since }, status: { $nin: ['draft'] } }],
      [
        Shipment as never,
        { status: { $in: ['dispatched', 'delivered'] }, dispatchedAt: { $gte: since } },
      ],
      [Notification as never, { userId: new mongoose.Types.ObjectId(), readAt: null }],
      [AuditLog as never, {}, { at: -1 }],
      [User as never, { role: { $in: ['admin'] }, isActive: true }],
    ];
    for (const [model, filter, sort] of cases) {
      const plan = await stages(model, filter, sort);
      expect(plan, `${model.modelName} ${JSON.stringify(filter)}`).toContain('IXSCAN');
      expect(plan).not.toContain('COLLSCAN');
    }
  });

  it('enforces the unique keys that protect stock and documents', async () => {
    const admin = api(app, await tokenFor(app, 'admin'));
    const category = await createCategory(admin, { code: 'UNQ' });
    const warehouse = await createWarehouse(admin, { code: 'UNQ' });
    const product = await createProduct(admin, category.id);
    expect((await admin.post('/warehouses', { code: 'UNQ', name: 'Again' })).status).toBe(409);
    expect(
      (await admin.post('/products', { ...product, sku: product.sku, categoryId: category.id }))
        .status,
    ).toBe(409);
    const indexes = await mongoose.connection.collection('stocklevels').indexes();
    expect(
      indexes.some((i) => i.unique && JSON.stringify(i.key) === '{"productId":1,"warehouseId":1}'),
    ).toBe(true);
    void warehouse;
  });
});
