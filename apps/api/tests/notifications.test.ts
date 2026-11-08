import { beforeEach, describe, expect, it } from 'vitest';
import type {
  NotificationDto,
  ProductDto,
  PurchaseOrderDto,
  WarehouseDto,
} from '@stockflow/shared';
import { createApp } from '../src/app.js';
import { Notification } from '../src/modules/notifications/notifications.js';
import { User } from '../src/modules/users/user.model.js';
import {
  api,
  createCategory,
  createCustomer,
  createProduct,
  createWarehouse,
  expectLedgerConsistent,
  openingStock,
  type Api,
} from './fixtures.js';
import { bearer, createAndLogin } from './helpers.js';

const app = createApp();
let admin: Api;
let buyer: Api;
let buyerId: string;
let approver: Api;
let approverId: string;
let inventory: Api;
let inventoryId: string;
let staff: Api;
let staffId: string;
let sales: Api;
let main: WarehouseDto;
let tape: ProductDto;

async function loginAs(role: Parameters<typeof createAndLogin>[1]) {
  const session = await createAndLogin(app, role);
  return { client: api(app, session.accessToken), id: session.body.user.id };
}

beforeEach(async () => {
  admin = (await loginAs('admin')).client;
  ({ client: buyer, id: buyerId } = await loginAs('procurement_manager'));
  ({ client: approver, id: approverId } = await loginAs('procurement_manager'));
  ({ client: inventory, id: inventoryId } = await loginAs('inventory_manager'));
  ({ client: staff, id: staffId } = await loginAs('staff'));
  sales = (await loginAs('sales_manager')).client;
  const category = await createCategory(admin, { code: 'NTF' });
  main = await createWarehouse(admin, { code: 'MAIN' });
  tape = await createProduct(admin, category.id, { name: 'Tape', reorderPoint: 10 });
  await openingStock(admin, main.id, [{ productId: tape.id, quantity: 15 }]);
});

const inbox = async (client: Api) =>
  (await client.get('/notifications')).body.data as NotificationDto[];
const forUser = (userId: string, type?: string) =>
  Notification.find({ userId, ...(type ? { type } : {}) }).lean();

describe('workflow notifications', () => {
  it('asks approvers to approve a submitted order and tells the creator the outcome', async () => {
    const supplier = (await admin.post('/suppliers', { name: 'Acme' })).body.data;
    const po = (
      await buyer.post('/purchase-orders', {
        supplierId: supplier.id,
        warehouseId: main.id,
        lines: [{ productId: tape.id, quantity: 5 }],
      })
    ).body.data as PurchaseOrderDto;
    await buyer.post(`/purchase-orders/${po.id}/submit`, {}).expect(200);

    // The other procurement manager and admins are asked; the submitter isn't.
    expect((await inbox(approver)).map((n) => n.title)).toEqual([`${po.number} needs approval`]);
    expect(await inbox(buyer)).toEqual([]);
    expect(await forUser(inventoryId, 'purchase_order')).toEqual([]);

    await approver.post(`/purchase-orders/${po.id}/approve`, {}).expect(200);
    const [approved] = await inbox(buyer);
    expect(approved).toMatchObject({
      type: 'purchase_order',
      title: `${po.number} approved`,
      link: `/purchase-orders/${po.id}`,
      readAt: null,
    });

    await staff
      .post('/goods-receipts', {
        purchaseOrderId: po.id,
        lines: [{ poLineId: po.lines[0]!.id, acceptedQuantity: 5 }],
      })
      .expect(201);
    expect((await inbox(buyer))[0]).toMatchObject({ type: 'goods_receipt' });
    expect((await inbox(buyer))[0]!.body).toContain('5 accepted; order complete');
    await expectLedgerConsistent();
  });

  it('alerts once when available stock crosses the low-stock threshold, including by reservation', async () => {
    const adjust = (change: number) =>
      inventory.post('/stock/adjustments', {
        warehouseId: main.id,
        reason: 'damage',
        lines: [{ productId: tape.id, quantityChange: change }],
      });
    await adjust(-3).expect(201); // 12 left: above 10
    expect(await forUser(inventoryId, 'low_stock')).toHaveLength(0);

    // A reservation that takes available to 9 crosses the threshold.
    const customer = await createCustomer(admin);
    const so = await sales.post('/sales-orders', {
      customerId: customer.id,
      warehouseId: main.id,
      lines: [{ productId: tape.id, quantity: 3 }],
    });
    await sales.post(`/sales-orders/${so.body.data.id}/confirm`, {}).expect(200);
    const alerts = await inbox(inventory);
    expect(alerts.filter((n) => n.type === 'low_stock')).toEqual([
      expect.objectContaining({
        title: `Low stock: ${tape.sku} at MAIN`,
        body: 'Tape: 9 pcs available, threshold 10',
        link: `/products/${tape.id}`,
      }),
    ]);
    // Procurement hears too; sales doesn't.
    expect(await forUser(buyerId, 'low_stock')).toHaveLength(1);

    // Already low: no repeat.
    await adjust(-2).expect(201);
    expect(await forUser(inventoryId, 'low_stock')).toHaveLength(1);
    await expectLedgerConsistent();
  });

  it('leaves no notification behind when the action rolls back', async () => {
    const customer = await createCustomer(admin);
    const so = await sales.post('/sales-orders', {
      customerId: customer.id,
      warehouseId: main.id,
      lines: [{ productId: tape.id, quantity: 99 }],
    });
    expect((await sales.post(`/sales-orders/${so.body.data.id}/confirm`, {})).status).toBe(409);
    expect(await Notification.countDocuments()).toBe(0);
  });

  it('skips deactivated users and the person who acted', async () => {
    await User.updateOne({ _id: approverId }, { isActive: false });
    const t = await staff.post('/stock-transfers', {
      fromWarehouseId: main.id,
      toWarehouseId: (await createWarehouse(admin, { code: 'NORTH' })).id,
      lines: [{ productId: tape.id, quantity: 1 }],
    });
    expect(await forUser(inventoryId, 'transfer')).toHaveLength(1);
    expect(await forUser(staffId, 'transfer')).toHaveLength(0);
    await inventory.post(`/stock-transfers/${t.body.data.id}/approve`, {}).expect(200);
    expect((await inbox(staff)).map((n) => n.title)).toEqual([`${t.body.data.number} approved`]);
  });
});

describe('notification inbox', () => {
  it('reads one or all of my notifications, but never someone else’s', async () => {
    await Notification.insertMany([
      { userId: inventoryId, type: 'low_stock', title: 'A' },
      { userId: inventoryId, type: 'transfer', title: 'B' },
      { userId: staffId, type: 'transfer', title: 'Not yours' },
    ]);
    const mine = await inbox(inventory);
    expect(mine.map((n) => n.title).sort()).toEqual(['A', 'B']);
    const filtered = await inventory.get('/notifications?type=transfer');
    expect(filtered.body.data.map((n: NotificationDto) => n.title)).toEqual(['B']);

    const theirs = await Notification.findOne({ userId: staffId }).lean();
    expect((await inventory.post(`/notifications/${theirs!._id.toString()}/read`, {})).status).toBe(
      404,
    );
    const read = await inventory.post(`/notifications/${mine[0]!.id}/read`, {});
    expect(read.body.data.readAt).not.toBeNull();
    // Reading again keeps the first time it was read.
    const again = await inventory.post(`/notifications/${mine[0]!.id}/read`, {});
    expect(again.body.data.readAt).toBe(read.body.data.readAt);

    expect((await inventory.get('/notifications?unread=true')).body.meta.total).toBe(1);
    expect((await inventory.post('/notifications/read-all', {})).body.data).toEqual({ updated: 1 });
    expect((await inventory.get('/notifications/summary')).body.data.unread).toBe(0);
    expect((await staff.get('/notifications/summary')).body.data.unread).toBe(1);
  });

  it('summarises approvals waiting for me, excluding my own requests', async () => {
    await staff
      .post('/purchase-requests', {
        warehouseId: main.id,
        lines: [{ productId: tape.id, quantity: 4 }],
      })
      .then(async (r) => staff.post(`/purchase-requests/${r.body.data.id}/submit`, {}));
    const buyerTransfer = await inventory.post('/stock-transfers', {
      fromWarehouseId: main.id,
      toWarehouseId: (await createWarehouse(admin, { code: 'EAST' })).id,
      lines: [{ productId: tape.id, quantity: 1 }],
    });
    expect(buyerTransfer.status).toBe(201);

    const forBuyer = (await buyer.get('/notifications/summary')).body.data.approvals;
    expect(forBuyer).toMatchObject({ purchaseRequests: 1, transfers: 0, total: 1 });
    // The inventory manager requested the transfer, so it isn't waiting on them.
    const forInventory = (await inventory.get('/notifications/summary')).body.data.approvals;
    expect(forInventory).toMatchObject({ purchaseRequests: 0, transfers: 0, total: 0 });
    const forAdmin = (await admin.get('/notifications/summary')).body.data.approvals;
    expect(forAdmin).toMatchObject({ purchaseRequests: 1, transfers: 1, total: 2 });
    expect((await staff.get('/notifications/summary')).body.data.approvals.total).toBe(0);
  });

  it('requires authentication', async () => {
    const res = await (
      await import('supertest')
    )
      .default(app)
      .get('/api/v1/notifications')
      .set(bearer('bad'));
    expect(res.status).toBe(401);
  });
});
