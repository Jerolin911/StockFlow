import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  CategoryDto,
  ProductDto,
  PurchaseOrderDto,
  SupplierDto,
  WarehouseDto,
} from '@stockflow/shared';
import { createApp } from '../src/app.js';
import { Product } from '../src/modules/products/product.model.js';
import { GoodsReceipt, PurchaseOrder } from '../src/modules/purchasing/models.js';
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
let buyer: Api; // procurement manager
let approver: Api; // second procurement manager
let receiver: Api; // staff
let category: CategoryDto;
let warehouse: WarehouseDto;
let supplier: SupplierDto;
let widget: ProductDto;
let gadget: ProductDto;

beforeEach(async () => {
  admin = api(app, await tokenFor(app, 'admin'));
  buyer = api(app, await tokenFor(app, 'procurement_manager'));
  approver = api(app, await tokenFor(app, 'procurement_manager'));
  receiver = api(app, await tokenFor(app, 'staff'));
  category = await createCategory(admin, { code: 'PRC' });
  warehouse = await createWarehouse(admin, { code: 'MAIN' });
  supplier = (await admin.post('/suppliers', { name: 'Acme Components', leadTimeDays: 5 })).body
    .data;
  widget = await createProduct(admin, category.id, {
    name: 'Widget',
    costPrice: 500,
    taxRate: 1000,
  });
  gadget = await createProduct(admin, category.id, { name: 'Gadget', costPrice: 2000 });
});

afterEach(async () => {
  await expectLedgerConsistent();
});

async function draftOrder(lines: { productId: string; quantity: number; unitCost?: number }[]) {
  const res = await buyer.post('/purchase-orders', {
    supplierId: supplier.id,
    warehouseId: warehouse.id,
    lines,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as PurchaseOrderDto;
}

async function approvedOrder(lines: { productId: string; quantity: number; unitCost?: number }[]) {
  const po = await draftOrder(lines);
  await buyer.post(`/purchase-orders/${po.id}/submit`, {}).expect(200);
  const res = await approver.post(`/purchase-orders/${po.id}/approve`, {});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as PurchaseOrderDto;
}

function receive(
  po: PurchaseOrderDto,
  lines: {
    product: ProductDto;
    accepted?: number;
    rejected?: number;
    damaged?: number;
    reason?: string;
  }[],
  extra: Record<string, unknown> = {},
  client: Api = receiver,
) {
  return client.post('/goods-receipts', {
    purchaseOrderId: po.id,
    ...extra,
    lines: lines.map((l) => ({
      poLineId: po.lines.find((pl) => pl.productId === l.product.id)!.id,
      acceptedQuantity: l.accepted ?? 0,
      rejectedQuantity: l.rejected ?? 0,
      damagedQuantity: l.damaged ?? 0,
      rejectionReason: l.reason ?? '',
    })),
  });
}

const getOrder = async (id: string) =>
  (await admin.get(`/purchase-orders/${id}`)).body.data as PurchaseOrderDto;
const line = (po: PurchaseOrderDto, product: ProductDto) =>
  po.lines.find((l) => l.productId === product.id)!;

describe('supplier prices', () => {
  it('prices order lines from the supplier, falling back to the product cost', async () => {
    await buyer
      .put(`/suppliers/${supplier.id}/prices/${widget.id}`, { unitCost: 450, supplierSku: 'AC-W1' })
      .expect(200);

    const prices = await buyer.get(`/suppliers/${supplier.id}/prices`);
    expect(prices.body.data).toEqual([
      expect.objectContaining({
        unitCost: 450,
        supplierSku: 'AC-W1',
        product: expect.objectContaining({ sku: widget.sku }),
      }),
    ]);
    const byProduct = await buyer.get(`/products/${widget.id}/supplier-prices`);
    expect(byProduct.body.data[0].supplier).toMatchObject({
      id: supplier.id,
      name: 'Acme Components',
    });

    const po = await draftOrder([
      { productId: widget.id, quantity: 10 },
      { productId: gadget.id, quantity: 2 },
      {
        productId: (await createProduct(admin, category.id, { costPrice: 100 })).id,
        quantity: 1,
        unitCost: 80,
      },
    ]);
    expect(po.lines.map((l) => l.unitCost)).toEqual([450, 2000, 80]);
    // Widget: 10 × 4.50 = 45.00 + 10% tax = 4.50
    expect(line(po, widget)).toMatchObject({ lineSubtotal: 4500, lineTax: 450, lineTotal: 4950 });
    expect(po).toMatchObject({ subtotal: 4500 + 4000 + 80, taxTotal: 450, total: 9030 });
    expect(po.number).toMatch(/^PO-\d{4}-00001$/);
    // Expected date defaults from the supplier's 5-day lead time.
    const expected = new Date();
    expected.setUTCDate(expected.getUTCDate() + 5);
    expect(po.expectedDate).toBe(expected.toISOString().slice(0, 10));
  });

  it('only lets supplier managers edit prices', async () => {
    const res = await receiver.put(`/suppliers/${supplier.id}/prices/${widget.id}`, {
      unitCost: 1,
    });
    expect(res.status).toBe(403);
    await buyer.put(`/suppliers/${supplier.id}/prices/${widget.id}`, { unitCost: 1 }).expect(200);
    await buyer.delete(`/suppliers/${supplier.id}/prices/${widget.id}`).expect(204);
    expect((await buyer.get(`/suppliers/${supplier.id}/prices`)).body.data).toEqual([]);
  });
});

describe('purchase requests', () => {
  const requestBody = () => ({
    warehouseId: warehouse.id,
    neededBy: '2030-01-31',
    notes: 'Running low before the promotion',
    lines: [
      { productId: widget.id, quantity: 30, note: 'Blue only' },
      { productId: gadget.id, quantity: 4 },
    ],
  });

  it('runs from request to approval to a draft purchase order', async () => {
    const requester = api(app, await tokenFor(app, 'inventory_manager'));
    const created = await requester.post('/purchase-requests', requestBody());
    expect(created.status).toBe(201);
    const pr = created.body.data;
    expect(pr).toMatchObject({
      status: 'draft',
      neededBy: '2030-01-31',
      lines: [{ quantity: 30, note: 'Blue only' }, { quantity: 4 }],
    });
    expect(pr.number).toMatch(/^PR-\d{4}-00001$/);

    await requester.post(`/purchase-requests/${pr.id}/submit`, {}).expect(200);
    const approved = await buyer.post(`/purchase-requests/${pr.id}/approve`, {});
    expect(approved.body.data.status).toBe('approved');

    await buyer
      .put(`/suppliers/${supplier.id}/prices/${gadget.id}`, { unitCost: 1800 })
      .expect(200);
    const converted = await buyer.post(`/purchase-requests/${pr.id}/convert`, {
      supplierId: supplier.id,
    });
    expect(converted.status).toBe(201);
    const po = await getOrder(converted.body.data.purchaseOrderId);
    expect(po).toMatchObject({
      status: 'draft',
      purchaseRequest: { id: pr.id, number: pr.number },
      warehouse: { id: warehouse.id },
      supplier: { id: supplier.id },
    });
    expect(po.lines.map((l) => [l.sku, l.quantity, l.unitCost])).toEqual([
      [widget.sku, 30, 500],
      [gadget.sku, 4, 1800],
    ]);

    const after = (await buyer.get(`/purchase-requests/${pr.id}`)).body.data;
    expect(after).toMatchObject({
      status: 'ordered',
      purchaseOrder: { id: po.id, number: po.number },
    });
    expect(after.history.map((h: { action: string }) => h.action)).toEqual([
      'created',
      'submitted',
      'approved',
      'ordered',
    ]);

    // Converting twice isn't possible.
    expect(
      (await buyer.post(`/purchase-requests/${pr.id}/convert`, { supplierId: supplier.id })).status,
    ).toBe(409);

    // Deleting the draft order puts the request back to approved so it can be ordered again.
    await buyer.delete(`/purchase-orders/${po.id}`).expect(204);
    expect((await buyer.get(`/purchase-requests/${pr.id}`)).body.data).toMatchObject({
      status: 'approved',
      purchaseOrder: null,
    });
  });

  it('enforces separation of duties and permissions', async () => {
    const own = (await buyer.post('/purchase-requests', requestBody())).body.data;
    await buyer.post(`/purchase-requests/${own.id}/submit`, {}).expect(200);
    const selfApprove = await buyer.post(`/purchase-requests/${own.id}/approve`, {});
    expect(selfApprove.status).toBe(409);
    await approver.post(`/purchase-requests/${own.id}/approve`, {}).expect(200);

    const sales = api(app, await tokenFor(app, 'sales_manager'));
    expect((await sales.post('/purchase-requests', requestBody())).status).toBe(403);

    const staffRequest = (await receiver.post('/purchase-requests', requestBody())).body.data;
    // Another requester can't edit or submit someone else's draft.
    const other = api(app, await tokenFor(app, 'staff'));
    expect((await other.post(`/purchase-requests/${staffRequest.id}/submit`, {})).status).toBe(403);
    // Staff can't approve.
    await receiver.post(`/purchase-requests/${staffRequest.id}/submit`, {}).expect(200);
    expect((await receiver.post(`/purchase-requests/${staffRequest.id}/approve`, {})).status).toBe(
      403,
    );
  });

  it('can be rejected with a reason or cancelled', async () => {
    const pr = (await receiver.post('/purchase-requests', requestBody())).body.data;
    await receiver.post(`/purchase-requests/${pr.id}/submit`, {}).expect(200);
    expect((await buyer.post(`/purchase-requests/${pr.id}/reject`, {})).status).toBe(400);
    const rejected = await buyer.post(`/purchase-requests/${pr.id}/reject`, {
      reason: 'Stock arriving from North',
    });
    expect(rejected.body.data).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Stock arriving from North',
    });
    expect(
      (await receiver.post(`/purchase-requests/${pr.id}/cancel`, { reason: 'x' })).status,
    ).toBe(409);

    const second = (await receiver.post('/purchase-requests', requestBody())).body.data;
    const cancelled = await receiver.post(`/purchase-requests/${second.id}/cancel`, {
      reason: 'Duplicate',
    });
    expect(cancelled.body.data.status).toBe('cancelled');
  });

  it('only edits drafts and validates lines', async () => {
    const pr = (await receiver.post('/purchase-requests', requestBody())).body.data;
    const edited = await receiver.patch(`/purchase-requests/${pr.id}`, {
      ...requestBody(),
      lines: [{ productId: widget.id, quantity: 5 }],
    });
    expect(edited.body.data.lines).toHaveLength(1);
    await receiver.post(`/purchase-requests/${pr.id}/submit`, {}).expect(200);
    expect((await receiver.patch(`/purchase-requests/${pr.id}`, requestBody())).status).toBe(409);

    const invalid = await receiver.post('/purchase-requests', {
      warehouseId: warehouse.id,
      lines: [],
    });
    expect(invalid.status).toBe(400);
    await admin.patch(`/products/${gadget.id}`, { isActive: false }).expect(200);
    const inactive = await receiver.post('/purchase-requests', requestBody());
    expect(inactive.status).toBe(400);
    expect(inactive.body.error.details[0].path).toBe('lines.1.productId');
  });
});

describe('purchase order lifecycle', () => {
  it('moves through submit, reject, approve with an audit history', async () => {
    const po = await draftOrder([{ productId: widget.id, quantity: 5 }]);
    await buyer
      .patch(`/purchase-orders/${po.id}`, {
        supplierId: supplier.id,
        warehouseId: warehouse.id,
        expectedDate: '2030-06-01',
        lines: [{ productId: widget.id, quantity: 8 }],
      })
      .expect(200);

    await buyer.post(`/purchase-orders/${po.id}/submit`, {}).expect(200);
    expect(
      (
        await buyer.patch(`/purchase-orders/${po.id}`, {
          supplierId: supplier.id,
          warehouseId: warehouse.id,
          lines: [{ productId: widget.id, quantity: 1 }],
        })
      ).status,
    ).toBe(409);

    const rejected = await approver.post(`/purchase-orders/${po.id}/reject`, {
      reason: 'Use the framework price',
    });
    expect(rejected.body.data).toMatchObject({
      status: 'draft',
      rejectionReason: 'Use the framework price',
    });

    await buyer.post(`/purchase-orders/${po.id}/submit`, {}).expect(200);
    const selfApproval = await buyer.post(`/purchase-orders/${po.id}/approve`, {});
    expect(selfApproval.status).toBe(409);
    expect((await receiver.post(`/purchase-orders/${po.id}/approve`, {})).status).toBe(403);

    const approved = (await approver.post(`/purchase-orders/${po.id}/approve`, {})).body
      .data as PurchaseOrderDto;
    expect(approved).toMatchObject({
      status: 'approved',
      expectedDate: '2030-06-01',
      approvedBy: { name: expect.any(String) },
    });
    expect(approved.lines[0]).toMatchObject({ quantity: 8, pendingQuantity: 8 });
    expect(approved.history.map((h) => h.action)).toEqual([
      'created',
      'submitted',
      'rejected',
      'submitted',
      'approved',
    ]);

    // Admins may approve their own orders.
    const adminPo = (
      await admin.post('/purchase-orders', {
        supplierId: supplier.id,
        warehouseId: warehouse.id,
        lines: [{ productId: gadget.id, quantity: 1 }],
      })
    ).body.data;
    await admin.post(`/purchase-orders/${adminPo.id}/submit`, {}).expect(200);
    await admin.post(`/purchase-orders/${adminPo.id}/approve`, {}).expect(200);
  });

  it('cancels before any receipt and refuses afterwards', async () => {
    const draft = await draftOrder([{ productId: widget.id, quantity: 5 }]);
    expect((await buyer.post(`/purchase-orders/${draft.id}/cancel`, {})).status).toBe(400);
    const cancelled = await buyer.post(`/purchase-orders/${draft.id}/cancel`, {
      reason: 'Supplier discontinued it',
    });
    expect(cancelled.body.data).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Supplier discontinued it',
      lines: [{ pendingQuantity: 0 }],
    });
    expect((await receive(cancelled.body.data, [{ product: widget, accepted: 1 }])).status).toBe(
      409,
    );

    const approved = await approvedOrder([{ productId: widget.id, quantity: 5 }]);
    await buyer
      .post(`/purchase-orders/${approved.id}/cancel`, { reason: 'Found a cheaper supplier' })
      .expect(200);

    const received = await approvedOrder([{ productId: widget.id, quantity: 5 }]);
    await receive(received, [{ product: widget, accepted: 2 }]).expect(201);
    const refused = await buyer.post(`/purchase-orders/${received.id}/cancel`, {
      reason: 'Too late',
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toContain('Close the remaining quantities');
  });

  it('rejects receipts against orders that are not approved', async () => {
    const draft = await draftOrder([{ productId: widget.id, quantity: 5 }]);
    expect((await receive(draft, [{ product: widget, accepted: 5 }])).status).toBe(409);
    await buyer.post(`/purchase-orders/${draft.id}/submit`, {}).expect(200);
    expect((await receive(draft, [{ product: widget, accepted: 5 }])).status).toBe(409);
    expect(await onHand(widget.id, warehouse.id)).toBe(0);
  });
});

describe('goods receipts', () => {
  it('receives a complete delivery into stock', async () => {
    const po = await approvedOrder([
      { productId: widget.id, quantity: 10, unitCost: 600 },
      { productId: gadget.id, quantity: 3 },
    ]);
    const res = await receive(
      po,
      [
        { product: widget, accepted: 10 },
        { product: gadget, accepted: 3 },
      ],
      { deliveryNote: 'DN-4471' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({
      purchaseOrder: { id: po.id },
      supplier: { id: supplier.id },
      deliveryNote: 'DN-4471',
      totals: { accepted: 13, rejected: 0, damaged: 0 },
    });
    expect(res.body.data.number).toMatch(/^GRN-\d{4}-00001$/);

    const after = await getOrder(po.id);
    expect(after.status).toBe('received');
    expect(after.lines.map((l) => [l.receivedQuantity, l.pendingQuantity])).toEqual([
      [10, 0],
      [3, 0],
    ]);
    expect(after.receiptCount).toBe(1);

    expect(await onHand(widget.id, warehouse.id)).toBe(10);
    expect(await onHand(gadget.id, warehouse.id)).toBe(3);
    const movement = await StockMovement.findOne({ productId: widget.id }).lean();
    expect(movement).toMatchObject({ type: 'RECEIPT', quantity: 10, unitCost: 600 });
    expect(String(movement!.reference!.id)).toBe(res.body.data.id);
    expect((await Product.findById(widget.id).lean())!.avgCost).toBe(600);

    // Nothing left to receive.
    expect((await receive(after, [{ product: widget, accepted: 1 }])).status).toBe(409);
  });

  it('keeps outstanding quantities open across partial deliveries', async () => {
    const po = await approvedOrder([
      { productId: widget.id, quantity: 10 },
      { productId: gadget.id, quantity: 4 },
    ]);

    await receive(po, [{ product: widget, accepted: 6 }]).expect(201);
    let current = await getOrder(po.id);
    expect(current.status).toBe('partially_received');
    expect(line(current, widget)).toMatchObject({ receivedQuantity: 6, pendingQuantity: 4 });
    expect(line(current, gadget)).toMatchObject({ receivedQuantity: 0, pendingQuantity: 4 });

    const tooMany = await receive(current, [{ product: widget, accepted: 5 }]);
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.details[0]).toEqual({
      path: 'lines.0.acceptedQuantity',
      message: `Only 4 pcs of ${widget.sku} outstanding`,
    });

    await receive(current, [
      { product: widget, accepted: 4 },
      { product: gadget, accepted: 1 },
    ]).expect(201);
    current = await getOrder(po.id);
    expect(current.status).toBe('partially_received');
    expect(line(current, gadget).pendingQuantity).toBe(3);

    await receive(current, [{ product: gadget, accepted: 3 }]).expect(201);
    current = await getOrder(po.id);
    expect(current.status).toBe('received');
    expect(current.receiptCount).toBe(3);
    expect(await onHand(widget.id, warehouse.id)).toBe(10);
    expect(await onHand(gadget.id, warehouse.id)).toBe(4);

    const receipts = await admin.get(`/goods-receipts?purchaseOrderId=${po.id}`);
    expect(receipts.body.meta.total).toBe(3);
  });

  it('stocks only accepted goods; rejected and damaged stay outstanding', async () => {
    await openingStock(admin, warehouse.id, [{ productId: widget.id, quantity: 2 }]);
    const po = await approvedOrder([{ productId: widget.id, quantity: 20 }]);

    const res = await receive(po, [
      {
        product: widget,
        accepted: 12,
        rejected: 3,
        damaged: 5,
        reason: 'Wrong colour; crushed cartons',
      },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.totals).toEqual({ accepted: 12, rejected: 3, damaged: 5 });
    expect(res.body.data.lines[0].rejectionReason).toBe('Wrong colour; crushed cartons');

    expect(await onHand(widget.id, warehouse.id)).toBe(14);
    const receipts = await StockMovement.find({ productId: widget.id, type: 'RECEIPT' }).lean();
    expect(receipts.map((m) => m.quantity)).toEqual([12]);

    const after = await getOrder(po.id);
    expect(after.status).toBe('partially_received');
    expect(after.lines[0]).toMatchObject({
      quantity: 20,
      receivedQuantity: 12,
      rejectedQuantity: 3,
      damagedQuantity: 5,
      pendingQuantity: 8,
    });

    // The replacement delivery completes the order.
    await receive(after, [{ product: widget, accepted: 8 }]).expect(201);
    expect((await getOrder(po.id)).status).toBe('received');
    expect(await onHand(widget.id, warehouse.id)).toBe(22);
  });

  it('records a delivery that is entirely rejected without touching stock', async () => {
    const po = await approvedOrder([{ productId: widget.id, quantity: 5 }]);
    const res = await receive(po, [{ product: widget, rejected: 5, reason: 'Failed inspection' }]);
    expect(res.status).toBe(201);
    expect(await StockMovement.countDocuments({ type: 'RECEIPT' })).toBe(0);
    const after = await getOrder(po.id);
    expect(after).toMatchObject({
      status: 'partially_received',
      lines: [{ pendingQuantity: 5, rejectedQuantity: 5 }],
    });
  });

  it('validates receipt input', async () => {
    const po = await approvedOrder([{ productId: widget.id, quantity: 5 }]);
    const noReason = await receive(po, [{ product: widget, accepted: 2, damaged: 1 }]);
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.details[0].path).toBe('lines.0.rejectionReason');

    const empty = await receive(po, [{ product: widget }]);
    expect(empty.status).toBe(400);

    const future = await receive(po, [{ product: widget, accepted: 1 }], {
      receivedAt: '2999-01-01',
    });
    expect(future.status).toBe(400);
    expect(future.body.error.details[0].path).toBe('receivedAt');

    const foreignLine = await receiver.post('/goods-receipts', {
      purchaseOrderId: po.id,
      lines: [{ poLineId: '000000000000000000000000', acceptedQuantity: 1 }],
    });
    expect(foreignLine.status).toBe(400);

    const sales = api(app, await tokenFor(app, 'sales_manager'));
    expect((await receive(po, [{ product: widget, accepted: 1 }], {}, sales)).status).toBe(403);
    expect(await GoodsReceipt.countDocuments()).toBe(0);
  });

  it('closes a partially received order, ending what is outstanding', async () => {
    const po = await approvedOrder([{ productId: widget.id, quantity: 10 }]);
    expect((await buyer.post(`/purchase-orders/${po.id}/close`, { reason: 'x' })).status).toBe(409);
    await receive(po, [{ product: widget, accepted: 7 }]).expect(201);

    const closed = await buyer.post(`/purchase-orders/${po.id}/close`, {
      reason: 'Supplier can’t supply the rest',
    });
    expect(closed.body.data).toMatchObject({
      status: 'closed',
      lines: [{ receivedQuantity: 7, pendingQuantity: 0 }],
    });
    expect((await receive(closed.body.data, [{ product: widget, accepted: 1 }])).status).toBe(409);
    expect(await onHand(widget.id, warehouse.id)).toBe(7);
  });

  it('never receives more than ordered under concurrent receipts', async () => {
    const po = await approvedOrder([{ productId: widget.id, quantity: 5 }]);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => receive(po, [{ product: widget, accepted: 2 }])),
    );
    const statuses = results.map((r) => r.status);
    // 2 + 2 fit; a third 2 doesn't (only 1 left).
    expect(statuses.filter((s) => s === 201)).toHaveLength(2);
    expect(await onHand(widget.id, warehouse.id)).toBe(4);
    const after = await PurchaseOrder.findById(po.id).lean();
    expect(after!.lines[0]!.receivedQuantity).toBe(4);
    expect(after!.receiptCount).toBe(2);
  });

  it('reports supplier delivery history and on-time performance', async () => {
    const onTimeOrder = await draftOrder([{ productId: widget.id, quantity: 4 }]);
    await buyer.patch(`/purchase-orders/${onTimeOrder.id}`, {
      supplierId: supplier.id,
      warehouseId: warehouse.id,
      expectedDate: '2099-12-31',
      lines: [{ productId: widget.id, quantity: 4 }],
    });
    await buyer.post(`/purchase-orders/${onTimeOrder.id}/submit`, {});
    await approver.post(`/purchase-orders/${onTimeOrder.id}/approve`, {});
    await receive(await getOrder(onTimeOrder.id), [
      { product: widget, accepted: 3, damaged: 1, reason: 'Dented' },
    ]).expect(201);

    const lateOrder = await approvedOrder([{ productId: gadget.id, quantity: 2 }]);
    await PurchaseOrder.updateOne(
      { _id: lateOrder.id },
      { expectedDate: new Date('2020-01-01T00:00:00Z') },
    );
    await receive(lateOrder, [{ product: gadget, accepted: 2 }]).expect(201);

    const overdue = await approvedOrder([{ productId: gadget.id, quantity: 1 }]);
    await PurchaseOrder.updateOne(
      { _id: overdue.id },
      { expectedDate: new Date('2020-01-01T00:00:00Z') },
    );

    const summary = await admin.get(`/suppliers/${supplier.id}/delivery-summary`);
    expect(summary.body.data).toEqual({
      receipts: 2,
      onTime: 1,
      late: 1,
      acceptedUnits: 5,
      rejectedUnits: 0,
      damagedUnits: 1,
      openOrders: 2,
      overdueOrders: 1,
    });

    const list = await admin.get(`/goods-receipts?supplierId=${supplier.id}&issues=true`);
    expect(list.body.meta.total).toBe(1);
    expect((await getOrder(overdue.id)).isOverdue).toBe(true);

    const overdueList = await admin.get('/purchase-orders?overdue=true');
    expect(overdueList.body.data.map((p: PurchaseOrderDto) => p.id)).toEqual([overdue.id]);

    const open = await admin.get(`/purchase-orders?open=true&productId=${gadget.id}`);
    expect(open.body.data.map((p: PurchaseOrderDto) => p.id)).toEqual([overdue.id]);
  });
});
