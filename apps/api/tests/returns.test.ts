import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  CustomerDto,
  CustomerReturnDto,
  ProductDto,
  SalesOrderDto,
  ShipmentDto,
  SupplierDto,
  SupplierReturnDto,
  WarehouseDto,
} from '@stockflow/shared';
import { createApp } from '../src/app.js';
import { Product } from '../src/modules/products/product.model.js';
import { StockLevel } from '../src/modules/stock/stock-level.model.js';
import { StockMovement } from '../src/modules/stock/stock-movement.model.js';
import {
  api,
  createCategory,
  createCustomer,
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
let sales: Api;
let staff: Api;
let inventory: Api;
let procurement: Api;
let main: WarehouseDto;
let customer: CustomerDto;
let supplier: SupplierDto;
let widget: ProductDto;
let gadget: ProductDto;

beforeEach(async () => {
  admin = api(app, await tokenFor(app, 'admin'));
  sales = api(app, await tokenFor(app, 'sales_manager'));
  staff = api(app, await tokenFor(app, 'staff'));
  inventory = api(app, await tokenFor(app, 'inventory_manager'));
  procurement = api(app, await tokenFor(app, 'procurement_manager'));
  const category = await createCategory(admin, { code: 'RET' });
  main = await createWarehouse(admin, { code: 'MAIN' });
  customer = await createCustomer(admin, { name: 'Harbor Cafe' });
  supplier = (await admin.post('/suppliers', { name: 'Acme Components' })).body.data;
  widget = await createProduct(admin, category.id, { name: 'Widget', costPrice: 500 });
  gadget = await createProduct(admin, category.id, { name: 'Gadget', costPrice: 2000 });
  await openingStock(admin, main.id, [
    { productId: widget.id, quantity: 20, unitCost: 500 },
    { productId: gadget.id, quantity: 5, unitCost: 2000 },
  ]);
});

afterEach(async () => {
  await expectLedgerConsistent();
});

const quarantine = async (productId: string, warehouseId: string) =>
  (await StockLevel.findOne({ productId, warehouseId }).lean())?.quarantine ?? 0;

/** A sales order with the given quantities confirmed and fully dispatched. */
async function shippedOrder(lines: { product: ProductDto; quantity: number }[]) {
  const created = await sales.post('/sales-orders', {
    customerId: customer.id,
    warehouseId: main.id,
    lines: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
  });
  const so = created.body.data as SalesOrderDto;
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
  return (await admin.get(`/sales-orders/${so.id}`)).body.data as SalesOrderDto;
}

const soLine = (so: SalesOrderDto, p: ProductDto) => so.lines.find((l) => l.productId === p.id)!;
const retLine = (r: CustomerReturnDto, p: ProductDto) => r.lines.find((l) => l.productId === p.id)!;

function requestReturn(
  so: SalesOrderDto,
  lines: { product: ProductDto; quantity: number }[],
  extra: Record<string, unknown> = {},
) {
  return sales.post('/customer-returns', {
    salesOrderId: so.id,
    reason: 'damaged',
    lines: lines.map((l) => ({ soLineId: soLine(so, l.product).id, quantity: l.quantity })),
    ...extra,
  });
}

async function approvedReturn(
  so: SalesOrderDto,
  lines: { product: ProductDto; quantity: number }[],
) {
  const res = await requestReturn(so, lines);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const approved = await sales.post(`/customer-returns/${res.body.data.id}/approve`, {});
  expect(approved.status).toBe(200);
  return approved.body.data as CustomerReturnDto;
}

describe('customer returns', () => {
  it('receives into quarantine, then restocks what passes inspection', async () => {
    const so = await shippedOrder([
      { product: widget, quantity: 6 },
      { product: gadget, quantity: 2 },
    ]);
    expect(await onHand(widget.id, main.id)).toBe(14);

    const requested = await requestReturn(
      so,
      [
        { product: widget, quantity: 4 },
        { product: gadget, quantity: 1 },
      ],
      { notes: 'Two cartons crushed' },
    );
    expect(requested.status, JSON.stringify(requested.body)).toBe(201);
    const ret = requested.body.data as CustomerReturnDto;
    expect(ret).toMatchObject({
      status: 'requested',
      number: expect.stringMatching(/^RMA-\d{4}-\d{5}$/),
      salesOrder: { id: so.id },
      warehouse: { code: 'MAIN' },
    });
    // Returned at the cost they shipped at.
    expect(retLine(ret, widget).unitCost).toBe(500);
    expect(
      soLine((await admin.get(`/sales-orders/${so.id}`)).body.data, widget).returnedQuantity,
    ).toBe(4);

    expect((await staff.post(`/customer-returns/${ret.id}/receive`, { lines: [] })).status).toBe(
      400,
    );
    await sales.post(`/customer-returns/${ret.id}/approve`, {}).expect(200);
    const received = await staff.post(`/customer-returns/${ret.id}/receive`, {
      lines: [
        { lineId: retLine(ret, widget).id, receivedQuantity: 4 },
        { lineId: retLine(ret, gadget).id, receivedQuantity: 1 },
      ],
    });
    expect(received.status, JSON.stringify(received.body)).toBe(200);
    expect(received.body.data.status).toBe('received');
    // Isolated until inspected: not usable, not available.
    expect(await onHand(widget.id, main.id)).toBe(14);
    expect(await quarantine(widget.id, main.id)).toBe(4);
    const inMovement = await StockMovement.findOne({
      type: 'CUSTOMER_RETURN',
      productId: widget.id,
    }).lean();
    expect(inMovement).toMatchObject({ bucket: 'quarantine', quantity: 4, unitCost: 500 });

    const badSplit = await staff.post(`/customer-returns/${ret.id}/inspect`, {
      lines: [
        { lineId: retLine(ret, widget).id, restockQuantity: 2, quarantineQuantity: 1 },
        { lineId: retLine(ret, gadget).id, restockQuantity: 1, quarantineQuantity: 0 },
      ],
    });
    expect(badSplit.status).toBe(400);
    expect(badSplit.body.error.details[0].message).toBe(
      `Split all 4 received pcs of ${widget.sku}`,
    );

    const inspected = await staff.post(`/customer-returns/${ret.id}/inspect`, {
      lines: [
        {
          lineId: retLine(ret, widget).id,
          restockQuantity: 3,
          quarantineQuantity: 1,
          note: 'One cracked',
        },
        { lineId: retLine(ret, gadget).id, restockQuantity: 1, quarantineQuantity: 0 },
      ],
    });
    expect(inspected.status, JSON.stringify(inspected.body)).toBe(200);
    expect(inspected.body.data).toMatchObject({
      status: 'completed',
      totals: { requested: 5, received: 5, restocked: 4, quarantined: 1 },
    });
    expect(await onHand(widget.id, main.id)).toBe(17);
    expect(await quarantine(widget.id, main.id)).toBe(1);
    expect(await onHand(gadget.id, main.id)).toBe(4);
    const order = (await admin.get(`/sales-orders/${so.id}`)).body.data as SalesOrderDto;
    expect(order.history.map((h) => h.action)).toEqual(
      expect.arrayContaining(['return_requested', 'return_received', 'return_inspected']),
    );
  });

  it('caps returns at what shipped and frees the cap on rejection and short receipts', async () => {
    const so = await shippedOrder([{ product: widget, quantity: 5 }]);
    const over = await requestReturn(so, [{ product: widget, quantity: 6 }]);
    expect(over.status).toBe(400);
    expect(over.body.error.details[0].message).toBe(`Only 5 pcs of ${widget.sku} can be returned`);

    const first = await approvedReturn(so, [{ product: widget, quantity: 3 }]);
    const tooMany = await requestReturn(so, [{ product: widget, quantity: 3 }]);
    expect(tooMany.body.error.details[0].message).toBe(
      `Only 2 pcs of ${widget.sku} can be returned`,
    );

    // Only 2 of 3 come back: the third can be returned again later.
    await staff
      .post(`/customer-returns/${first.id}/receive`, {
        lines: [{ lineId: first.lines[0]!.id, receivedQuantity: 2 }],
      })
      .expect(200);
    const second = await requestReturn(so, [{ product: widget, quantity: 3 }]);
    expect(second.status).toBe(201);
    await sales
      .post(`/customer-returns/${second.body.data.id}/reject`, { reason: 'Past the return window' })
      .expect(200);
    const order = (await admin.get(`/sales-orders/${so.id}`)).body.data as SalesOrderDto;
    expect(soLine(order, widget).returnedQuantity).toBe(2);
  });

  it('refuses returns for unshipped orders and enforces permissions and states', async () => {
    const draft = await sales.post('/sales-orders', {
      customerId: customer.id,
      warehouseId: main.id,
      lines: [{ productId: widget.id, quantity: 1 }],
    });
    const none = await requestReturn(draft.body.data, [{ product: widget, quantity: 1 }]);
    expect(none.body.error.details[0].message).toBe(`No shipped ${widget.sku} left to return`);

    const so = await shippedOrder([{ product: widget, quantity: 2 }]);
    const body = {
      salesOrderId: so.id,
      reason: 'damaged',
      lines: [{ soLineId: so.lines[0]!.id, quantity: 1 }],
    };
    expect((await staff.post('/customer-returns', body)).status).toBe(403);
    const other = await sales.post('/customer-returns', { ...body, reason: 'other' });
    expect(other.body.error.details[0].path).toBe('notes');

    const ret = await approvedReturn(so, [{ product: widget, quantity: 1 }]);
    expect((await sales.post(`/customer-returns/${ret.id}/receive`, { lines: [] })).status).toBe(
      403,
    );
    await staff
      .post(`/customer-returns/${ret.id}/receive`, {
        lines: [{ lineId: ret.lines[0]!.id, receivedQuantity: 1 }],
      })
      .expect(200);
    const late = await sales.post(`/customer-returns/${ret.id}/cancel`, { reason: 'x' });
    expect(late.body.error.message).toBe('Returns can’t be cancelled once goods are received');
  });

  it('restocks returned units at their shipped cost', async () => {
    const so = await shippedOrder([{ product: widget, quantity: 10 }]);
    // Average rises to 700 after a receipt at a higher cost.
    await Product.updateOne({ _id: widget.id }, { avgCost: 700 });
    const ret = await approvedReturn(so, [{ product: widget, quantity: 10 }]);
    await staff
      .post(`/customer-returns/${ret.id}/receive`, {
        lines: [{ lineId: ret.lines[0]!.id, receivedQuantity: 10 }],
      })
      .expect(200);
    await staff
      .post(`/customer-returns/${ret.id}/inspect`, {
        lines: [{ lineId: ret.lines[0]!.id, restockQuantity: 10, quarantineQuantity: 0 }],
      })
      .expect(200);
    // 10 on hand at 700 and 10 back at 500 → 600.
    expect((await Product.findById(widget.id).lean())!.avgCost).toBe(600);
  });
});

describe('supplier returns', () => {
  async function newSupplierReturn(
    lines: { product: ProductDto; quantity: number; source?: 'usable' | 'quarantine' }[],
    client: Api = inventory,
  ) {
    const res = await client.post('/supplier-returns', {
      supplierId: supplier.id,
      warehouseId: main.id,
      reason: 'defective',
      lines: lines.map((l) => ({
        productId: l.product.id,
        quantity: l.quantity,
        source: l.source,
      })),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data as SupplierReturnDto;
  }

  it('returns quarantined and usable stock to the supplier after approval', async () => {
    await inventory
      .post('/stock/quarantine', {
        warehouseId: main.id,
        action: 'quarantine',
        reason: 'damage',
        lines: [{ productId: widget.id, quantity: 3 }],
      })
      .expect(201);
    const ret = await newSupplierReturn([
      { product: widget, quantity: 3 },
      { product: gadget, quantity: 1, source: 'usable' },
    ]);
    expect(ret).toMatchObject({
      status: 'requested',
      number: expect.stringMatching(/^SRN-\d{4}-\d{5}$/),
      totalQuantity: 4,
    });
    expect(ret.lines[0]).toMatchObject({ source: 'quarantine', unitCost: 500 });

    expect((await staff.post(`/supplier-returns/${ret.id}/dispatch`, {})).status).toBe(409);
    expect((await inventory.post(`/supplier-returns/${ret.id}/approve`, {})).status).toBe(403);
    await procurement.post(`/supplier-returns/${ret.id}/approve`, {}).expect(200);
    const sent = await staff.post(`/supplier-returns/${ret.id}/dispatch`, {
      carrier: 'Acme collection',
      reference: 'RA-5521',
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.data).toMatchObject({ status: 'dispatched', reference: 'RA-5521' });
    expect(await quarantine(widget.id, main.id)).toBe(0);
    expect(await onHand(widget.id, main.id)).toBe(17);
    expect(await onHand(gadget.id, main.id)).toBe(4);
  });

  it('refuses to send more than the source holds', async () => {
    const ret = await newSupplierReturn([{ product: widget, quantity: 2 }]);
    await procurement.post(`/supplier-returns/${ret.id}/approve`, {}).expect(200);
    const res = await staff.post(`/supplier-returns/${ret.id}/dispatch`, {});
    expect(res.status).toBe(409);
    expect(res.body.error.details[0].message).toBe(
      `Only 0 pcs of ${widget.sku} in quarantine at MAIN`,
    );
    expect(await onHand(widget.id, main.id)).toBe(20);
  });

  it('prices lines from a linked purchase order and validates its supplier', async () => {
    const po = await procurement.post('/purchase-orders', {
      supplierId: supplier.id,
      warehouseId: main.id,
      lines: [{ productId: gadget.id, quantity: 2, unitCost: 1800 }],
    });
    const ret = await procurement.post('/supplier-returns', {
      supplierId: supplier.id,
      warehouseId: main.id,
      purchaseOrderId: po.body.data.id,
      reason: 'wrong_item',
      lines: [{ productId: gadget.id, quantity: 1, source: 'usable' }],
    });
    expect(ret.body.data.lines[0].unitCost).toBe(1800);

    const other = (await admin.post('/suppliers', { name: 'Other Co' })).body.data;
    const mismatch = await procurement.post('/supplier-returns', {
      supplierId: other.id,
      warehouseId: main.id,
      purchaseOrderId: po.body.data.id,
      reason: 'wrong_item',
      lines: [{ productId: gadget.id, quantity: 1 }],
    });
    expect(mismatch.body.error.details[0].path).toBe('purchaseOrderId');
    expect((await sales.post('/supplier-returns', {})).status).toBe(403);
  });

  it('sends a return only once under concurrent dispatches', async () => {
    const ret = await newSupplierReturn([{ product: gadget, quantity: 2, source: 'usable' }]);
    await procurement.post(`/supplier-returns/${ret.id}/approve`, {}).expect(200);
    const results = await Promise.all(
      Array.from({ length: 3 }, () => staff.post(`/supplier-returns/${ret.id}/dispatch`, {})),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(await onHand(gadget.id, main.id)).toBe(3);
  });
});
