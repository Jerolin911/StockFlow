import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  CategoryDto,
  CustomerDto,
  FulfilmentSummaryDto,
  ProductAvailabilityDto,
  ProductDto,
  SalesOrderDto,
  ShipmentDto,
  WarehouseDto,
} from '@stockflow/shared';
import { createApp } from '../src/app.js';
import { SalesOrder } from '../src/modules/sales/models.js';
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
  reserved,
  tokenFor,
  type Api,
} from './fixtures.js';

const app = createApp();
let admin: Api;
let sales: Api; // sales manager
let warehouseStaff: Api; // staff
let inventory: Api; // inventory manager
let category: CategoryDto;
let warehouse: WarehouseDto;
let customer: CustomerDto;
let widget: ProductDto;
let gadget: ProductDto;

beforeEach(async () => {
  admin = api(app, await tokenFor(app, 'admin'));
  sales = api(app, await tokenFor(app, 'sales_manager'));
  warehouseStaff = api(app, await tokenFor(app, 'staff'));
  inventory = api(app, await tokenFor(app, 'inventory_manager'));
  category = await createCategory(admin, { code: 'SAL' });
  warehouse = await createWarehouse(admin, { code: 'MAIN' });
  customer = await createCustomer(admin, {
    name: 'Harbor Cafe',
    address: '1 Billing St',
    shippingAddress: '9 Dock Rd',
  });
  widget = await createProduct(admin, category.id, {
    name: 'Widget',
    costPrice: 600,
    sellingPrice: 1000,
    taxRate: 1000,
  });
  gadget = await createProduct(admin, category.id, {
    name: 'Gadget',
    costPrice: 2000,
    sellingPrice: 3500,
  });
  await openingStock(admin, warehouse.id, [
    { productId: widget.id, quantity: 10, unitCost: 600 },
    { productId: gadget.id, quantity: 4, unitCost: 2000 },
  ]);
});

afterEach(async () => {
  await expectLedgerConsistent();
});

type Line = { productId: string; quantity: number; unitPrice?: number; discountRate?: number };

async function draftOrder(lines: Line[], extra: Record<string, unknown> = {}) {
  const res = await sales.post('/sales-orders', {
    customerId: customer.id,
    warehouseId: warehouse.id,
    lines,
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as SalesOrderDto;
}

async function confirmedOrder(lines: Line[]) {
  const so = await draftOrder(lines);
  const res = await sales.post(`/sales-orders/${so.id}/confirm`, {});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as SalesOrderDto;
}

const getOrder = async (id: string) =>
  (await admin.get(`/sales-orders/${id}`)).body.data as SalesOrderDto;
const orderLine = (so: SalesOrderDto, product: ProductDto) =>
  so.lines.find((l) => l.productId === product.id)!;

function createShipment(
  so: SalesOrderDto,
  lines: { product: ProductDto; quantity: number }[],
  client: Api = warehouseStaff,
) {
  return client.post('/shipments', {
    salesOrderId: so.id,
    lines: lines.map((l) => ({ soLineId: orderLine(so, l.product).id, quantity: l.quantity })),
  });
}

async function newShipment(so: SalesOrderDto, lines: { product: ProductDto; quantity: number }[]) {
  const res = await createShipment(so, lines);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as ShipmentDto;
}

function pick(
  shipment: ShipmentDto,
  picked: Record<string, number> = {},
  shortPickReason = '',
  client: Api = warehouseStaff,
) {
  return client.post(`/shipments/${shipment.id}/pick`, {
    shortPickReason,
    lines: shipment.lines.map((l) => ({
      lineId: l.id,
      pickedQuantity: picked[l.productId] ?? l.quantity,
    })),
  });
}

const pack = (shipment: ShipmentDto, client: Api = warehouseStaff) =>
  client.post(`/shipments/${shipment.id}/pack`, { packageCount: 2, weightGrams: 4500 });

const dispatch = (shipment: ShipmentDto, client: Api = warehouseStaff) =>
  client.post(`/shipments/${shipment.id}/dispatch`, {
    carrier: 'Northline Freight',
    trackingNumber: 'NL123',
  });

/** Picks everything requested, packs and dispatches. */
async function shipAll(shipment: ShipmentDto) {
  await pick(shipment).expect(200);
  await pack(shipment).expect(200);
  const res = await dispatch(shipment);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as ShipmentDto;
}

const deliver = (shipment: ShipmentDto, extra: Record<string, unknown> = {}) =>
  warehouseStaff.post(`/shipments/${shipment.id}/tracking`, {
    type: 'delivered',
    receivedBy: 'J. Rivera',
    ...extra,
  });

describe('sales order pricing and drafts', () => {
  it('prices lines from the selling price with per-line discount and tax', async () => {
    const so = await draftOrder([
      { productId: widget.id, quantity: 3, discountRate: 1000 },
      { productId: gadget.id, quantity: 1, unitPrice: 3000 },
    ]);
    expect(so).toMatchObject({
      status: 'draft',
      number: expect.stringMatching(/^SO-\d{4}-\d{5}$/),
      customer: { id: customer.id, name: 'Harbor Cafe' },
      shippingAddress: '9 Dock Rd',
    });
    // Widget: 3 × 10.00 = 30.00, −10% = 27.00, +10% tax = 2.70.
    expect(orderLine(so, widget)).toMatchObject({
      unitPrice: 1000,
      lineGross: 3000,
      lineDiscount: 300,
      lineSubtotal: 2700,
      lineTax: 270,
      lineTotal: 2970,
    });
    expect(orderLine(so, gadget)).toMatchObject({ unitPrice: 3000, lineTotal: 3000 });
    expect(so).toMatchObject({
      grossTotal: 6000,
      discountTotal: 300,
      subtotal: 5700,
      taxTotal: 270,
      total: 5970,
    });
  });

  it('doesn’t reserve stock for drafts, and edits and deletes only drafts', async () => {
    const so = await draftOrder([{ productId: widget.id, quantity: 4 }]);
    expect(await reserved(widget.id, warehouse.id)).toBe(0);

    const edited = await sales.patch(`/sales-orders/${so.id}`, {
      customerId: customer.id,
      warehouseId: warehouse.id,
      shippingAddress: 'Back door',
      lines: [{ productId: widget.id, quantity: 6 }],
    });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ shippingAddress: 'Back door', grossTotal: 6000 });

    await sales.post(`/sales-orders/${so.id}/confirm`, {}).expect(200);
    const late = await sales.patch(`/sales-orders/${so.id}`, {
      customerId: customer.id,
      warehouseId: warehouse.id,
      lines: [{ productId: widget.id, quantity: 1 }],
    });
    expect(late.status).toBe(409);
    expect((await sales.delete(`/sales-orders/${so.id}`)).status).toBe(409);

    const other = await draftOrder([{ productId: gadget.id, quantity: 1 }]);
    await sales.delete(`/sales-orders/${other.id}`).expect(204);
    await sales.get(`/sales-orders/${other.id}`).expect(404);
  });

  it('rejects inactive customers, inactive products and duplicate lines', async () => {
    const dormant = await createCustomer(admin);
    await admin.patch(`/customers/${dormant.id}`, { isActive: false }).expect(200);
    const res = await sales.post('/sales-orders', {
      customerId: dormant.id,
      warehouseId: warehouse.id,
      lines: [{ productId: widget.id, quantity: 1 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { path: 'customerId', message: 'This customer is inactive' },
    ]);

    await admin.patch(`/products/${gadget.id}`, { isActive: false }).expect(200);
    const inactive = await sales.post('/sales-orders', {
      customerId: customer.id,
      warehouseId: warehouse.id,
      lines: [{ productId: gadget.id, quantity: 1 }],
    });
    expect(inactive.body.error.details[0].path).toBe('lines.0.productId');

    const dup = await sales.post('/sales-orders', {
      customerId: customer.id,
      warehouseId: warehouse.id,
      lines: [
        { productId: widget.id, quantity: 1 },
        { productId: widget.id, quantity: 2 },
      ],
    });
    expect(dup.status).toBe(400);
  });

  it('restricts writing sales orders to sales managers and admins', async () => {
    const body = {
      customerId: customer.id,
      warehouseId: warehouse.id,
      lines: [{ productId: widget.id, quantity: 1 }],
    };
    expect((await warehouseStaff.post('/sales-orders', body)).status).toBe(403);
    expect((await inventory.post('/sales-orders', body)).status).toBe(403);
    const so = await draftOrder([{ productId: widget.id, quantity: 1 }]);
    expect((await warehouseStaff.post(`/sales-orders/${so.id}/confirm`, {})).status).toBe(403);
    expect((await warehouseStaff.get(`/sales-orders/${so.id}`)).status).toBe(200);
  });
});

describe('availability and reservations', () => {
  it('reports on-hand, reserved and available per warehouse', async () => {
    const north = await createWarehouse(admin, { code: 'NORTH' });
    await openingStock(admin, north.id, [{ productId: widget.id, quantity: 7 }]);
    await confirmedOrder([{ productId: widget.id, quantity: 3 }]);

    const res = await sales.get(`/stock/availability?productIds=${widget.id},${gadget.id}`);
    expect(res.status).toBe(200);
    const [w, g] = res.body.data as ProductAvailabilityDto[];
    expect(w!.warehouses).toEqual([
      expect.objectContaining({
        warehouse: expect.objectContaining({ code: 'MAIN' }),
        onHand: 10,
        reserved: 3,
        available: 7,
      }),
      expect.objectContaining({
        warehouse: expect.objectContaining({ code: 'NORTH' }),
        onHand: 7,
        reserved: 0,
        available: 7,
      }),
    ]);
    expect(g!.warehouses.map((x) => x.available)).toEqual([4, 0]);
  });

  it('reserves every line on confirmation without touching on-hand', async () => {
    const so = await confirmedOrder([
      { productId: widget.id, quantity: 6 },
      { productId: gadget.id, quantity: 4 },
    ]);
    expect(so).toMatchObject({ status: 'confirmed', confirmedBy: expect.any(Object) });
    expect(orderLine(so, widget)).toMatchObject({ reservedQuantity: 6, unallocatedQuantity: 6 });
    expect(await reserved(widget.id, warehouse.id)).toBe(6);
    expect(await reserved(gadget.id, warehouse.id)).toBe(4);
    expect(await onHand(widget.id, warehouse.id)).toBe(10);
    expect(so.history.at(-1)).toMatchObject({
      action: 'confirmed',
      note: 'Reserved 10 units in MAIN',
    });
    expect((await sales.post(`/sales-orders/${so.id}/confirm`, {})).status).toBe(409);
  });

  it('refuses confirmation when stock is short and reserves nothing', async () => {
    await confirmedOrder([{ productId: widget.id, quantity: 7 }]);
    const so = await draftOrder([
      { productId: gadget.id, quantity: 2 },
      { productId: widget.id, quantity: 5 },
    ]);
    const res = await sales.post(`/sales-orders/${so.id}/confirm`, {});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      message: `Only 3 pcs of ${widget.sku} available in MAIN`,
      details: [
        { path: 'lines.1.quantity', message: `Only 3 pcs of ${widget.sku} available in MAIN` },
      ],
    });
    // All or nothing: the gadget line that fitted isn't left reserved.
    expect(await reserved(gadget.id, warehouse.id)).toBe(0);
    expect(await reserved(widget.id, warehouse.id)).toBe(7);
    expect((await getOrder(so.id)).status).toBe('draft');
  });

  it('reports every short line at once', async () => {
    const so = await draftOrder([
      { productId: widget.id, quantity: 11 },
      { productId: gadget.id, quantity: 5 },
    ]);
    const res = await sales.post(`/sales-orders/${so.id}/confirm`, {});
    expect(res.body.error.message).toBe('2 lines don’t have enough available stock');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual([
      'lines.0.quantity',
      'lines.1.quantity',
    ]);
  });

  it('keeps reserved stock out of adjustments', async () => {
    await confirmedOrder([{ productId: widget.id, quantity: 8 }]);
    const res = await inventory.post('/stock/adjustments', {
      warehouseId: warehouse.id,
      reason: 'damage',
      lines: [{ productId: widget.id, quantityChange: -3 }],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    await inventory
      .post('/stock/adjustments', {
        warehouseId: warehouse.id,
        reason: 'damage',
        lines: [{ productId: widget.id, quantityChange: -2 }],
      })
      .expect(201);
    expect(await onHand(widget.id, warehouse.id)).toBe(8);
  });

  it('lets exactly as many concurrent orders reserve as stock allows', async () => {
    const drafts = await Promise.all(
      Array.from({ length: 6 }, () => draftOrder([{ productId: widget.id, quantity: 3 }])),
    );
    const results = await Promise.all(
      drafts.map((so) => sales.post(`/sales-orders/${so.id}/confirm`, {})),
    );
    const statuses = results.map((r) => r.status);
    // 10 available: three orders of 3 fit, the fourth would need 3 of the last 1.
    expect(statuses.filter((s) => s === 200)).toHaveLength(3);
    expect(statuses.filter((s) => s === 409)).toHaveLength(3);
    for (const r of results.filter((x) => x.status === 409)) {
      expect(r.body.error.code).toBe('INSUFFICIENT_STOCK');
    }
    expect(await reserved(widget.id, warehouse.id)).toBe(9);
    expect(await SalesOrder.countDocuments({ status: 'confirmed' })).toBe(3);
  });

  it('never splits the last units between concurrent multi-line orders', async () => {
    // Each order wants all 4 gadgets; widgets fit both. Only one can confirm.
    const a = await draftOrder([
      { productId: widget.id, quantity: 2 },
      { productId: gadget.id, quantity: 4 },
    ]);
    const b = await draftOrder([
      { productId: gadget.id, quantity: 4 },
      { productId: widget.id, quantity: 2 },
    ]);
    const results = await Promise.all([
      sales.post(`/sales-orders/${a.id}/confirm`, {}),
      sales.post(`/sales-orders/${b.id}/confirm`, {}),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await reserved(gadget.id, warehouse.id)).toBe(4);
    expect(await reserved(widget.id, warehouse.id)).toBe(2);
  });
});

describe('picking, packing and dispatch', () => {
  it('ships a complete order and only reduces on-hand at dispatch', async () => {
    const so = await confirmedOrder([
      { productId: widget.id, quantity: 4 },
      { productId: gadget.id, quantity: 1 },
    ]);
    const shipment = await newShipment(so, [
      { product: widget, quantity: 4 },
      { product: gadget, quantity: 1 },
    ]);
    expect(shipment).toMatchObject({
      status: 'picking',
      number: expect.stringMatching(/^SHP-\d{4}-\d{5}$/),
      shippingAddress: '9 Dock Rd',
      totals: { requested: 5, picked: null },
    });
    expect(orderLine(await getOrder(so.id), widget)).toMatchObject({
      allocatedQuantity: 4,
      unallocatedQuantity: 0,
      reservedQuantity: 4,
    });

    await pick(shipment).expect(200);
    const packed = await pack(shipment);
    expect(packed.body.data).toMatchObject({
      status: 'packed',
      packageCount: 2,
      weightGrams: 4500,
    });
    // Still in the building: nothing physical has changed.
    expect(await onHand(widget.id, warehouse.id)).toBe(10);
    expect(await reserved(widget.id, warehouse.id)).toBe(4);

    const res = await dispatch(shipment);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'dispatched',
      carrier: 'Northline Freight',
      trackingNumber: 'NL123',
      tracking: [expect.objectContaining({ type: 'dispatched' })],
    });
    expect(await onHand(widget.id, warehouse.id)).toBe(6);
    expect(await reserved(widget.id, warehouse.id)).toBe(0);
    expect(await onHand(gadget.id, warehouse.id)).toBe(3);

    const movement = await StockMovement.findOne({ productId: widget.id, type: 'SHIPMENT' }).lean();
    expect(movement).toMatchObject({
      quantity: -4,
      balanceAfter: 6,
      unitCost: 600,
      reference: { type: 'shipment', number: shipment.number },
    });

    let order = await getOrder(so.id);
    expect(order.status).toBe('shipped');
    expect(orderLine(order, widget)).toMatchObject({ shippedQuantity: 4, reservedQuantity: 0 });

    await warehouseStaff
      .post(`/shipments/${shipment.id}/tracking`, {
        type: 'in_transit',
        location: 'Riverside hub',
      })
      .expect(200);
    const delivered = await deliver(shipment);
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(200);
    expect(delivered.body.data).toMatchObject({ status: 'delivered', receivedBy: 'J. Rivera' });
    expect(delivered.body.data.tracking.map((t: { type: string }) => t.type)).toEqual([
      'dispatched',
      'in_transit',
      'delivered',
    ]);

    order = await getOrder(so.id);
    expect(order.status).toBe('delivered');
    expect(order.history.map((h) => h.action)).toEqual([
      'created',
      'confirmed',
      'shipment_created',
      'shipment_picked',
      'shipment_packed',
      'shipment_dispatched',
      'shipment_delivered',
    ]);
    // Delivered is final.
    expect((await deliver(shipment)).status).toBe(409);
  });

  it('enforces the pick → pack → dispatch order', async () => {
    const so = await confirmedOrder([{ productId: widget.id, quantity: 2 }]);
    const shipment = await newShipment(so, [{ product: widget, quantity: 2 }]);
    expect((await dispatch(shipment)).status).toBe(409);
    expect((await pack(shipment)).status).toBe(409);
    await pick(shipment).expect(200);
    expect((await pick(shipment)).status).toBe(409);
    expect((await dispatch(shipment)).status).toBe(409);
    await pack(shipment).expect(200);
    expect(
      (await warehouseStaff.post(`/shipments/${shipment.id}/tracking`, { type: 'in_transit' }))
        .status,
    ).toBe(409);
    await dispatch(shipment).expect(200);
    expect((await dispatch(shipment)).status).toBe(409);
    expect(
      (await warehouseStaff.post(`/shipments/${shipment.id}/cancel`, { reason: 'Too late' }))
        .status,
    ).toBe(409);
  });

  it('dispatches a shipment only once under concurrent requests', async () => {
    const so = await confirmedOrder([{ productId: widget.id, quantity: 5 }]);
    const shipment = await newShipment(so, [{ product: widget, quantity: 5 }]);
    await pick(shipment).expect(200);
    await pack(shipment).expect(200);
    const results = await Promise.all(Array.from({ length: 4 }, () => dispatch(shipment)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409]);
    expect(await onHand(widget.id, warehouse.id)).toBe(5);
    expect(await StockMovement.countDocuments({ type: 'SHIPMENT' })).toBe(1);
  });

  it('validates tracking updates', async () => {
    const so = await confirmedOrder([{ productId: widget.id, quantity: 1 }]);
    const shipment = await newShipment(so, [{ product: widget, quantity: 1 }]);
    await shipAll(shipment);

    const attempted = await warehouseStaff.post(`/shipments/${shipment.id}/tracking`, {
      type: 'delivery_attempted',
    });
    expect(attempted.body.error.details[0].path).toBe('note');
    const noRecipient = await deliver(shipment, { receivedBy: '' });
    expect(noRecipient.body.error.details[0].path).toBe('receivedBy');
    const future = await deliver(shipment, { at: '2099-01-01T10:00:00Z' });
    expect(future.body.error.details[0].path).toBe('at');
    const early = await deliver(shipment, { at: '2020-01-01T10:00:00Z' });
    expect(early.body.error.details[0].message).toBe(
      'The time can’t be before the shipment was dispatched',
    );

    await warehouseStaff
      .post(`/shipments/${shipment.id}/tracking`, {
        type: 'delivery_attempted',
        note: 'Nobody at the loading bay',
      })
      .expect(200);
    expect((await getOrder(so.id)).status).toBe('shipped');

    // Times entered to the minute count from the minute of dispatch.
    const thisMinute = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
    await deliver(shipment, { at: thisMinute }).expect(200);
  });

  it('lets warehouse roles fulfil but not sales managers', async () => {
    const so = await confirmedOrder([{ productId: widget.id, quantity: 1 }]);
    expect((await createShipment(so, [{ product: widget, quantity: 1 }], sales)).status).toBe(403);
    const res = await createShipment(so, [{ product: widget, quantity: 1 }], inventory);
    expect(res.status).toBe(201);
    const shipment = res.body.data as ShipmentDto;
    expect((await pick(shipment, {}, '', sales)).status).toBe(403);
    await pick(shipment, {}, '', inventory).expect(200);
    await pack(shipment, inventory).expect(200);
    expect((await dispatch(shipment, sales)).status).toBe(403);
    await dispatch(shipment, inventory).expect(200);
  });

  it('refuses shipments for drafts and for more than is left', async () => {
    const draft = await draftOrder([{ productId: widget.id, quantity: 2 }]);
    const res = await createShipment(draft, [{ product: widget, quantity: 1 }]);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe(
      `Only confirmed orders can be shipped. ${draft.number} is draft.`,
    );

    const so = await confirmedOrder([{ productId: widget.id, quantity: 3 }]);
    const over = await createShipment(so, [{ product: widget, quantity: 4 }]);
    expect(over.status).toBe(400);
    expect(over.body.error.details).toEqual([
      { path: 'lines.0.quantity', message: `Only 3 pcs of ${widget.sku} left to ship` },
    ]);
    await newShipment(so, [{ product: widget, quantity: 2 }]);
    const rest = await createShipment(so, [{ product: widget, quantity: 2 }]);
    expect(rest.body.error.details[0].message).toBe(`Only 1 pcs of ${widget.sku} left to ship`);
  });

  it('never allocates more than ordered under concurrent pick lists', async () => {
    const so = await confirmedOrder([{ productId: widget.id, quantity: 5 }]);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => createShipment(so, [{ product: widget, quantity: 2 }])),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    const after = await getOrder(so.id);
    expect(orderLine(after, widget)).toMatchObject({
      allocatedQuantity: 4,
      unallocatedQuantity: 1,
    });
    expect(after.shipmentCount).toBe(2);
  });
});

describe('partial fulfilment', () => {
  it('ships an order in parts and is delivered only when every part arrives', async () => {
    const so = await confirmedOrder([
      { productId: widget.id, quantity: 6 },
      { productId: gadget.id, quantity: 2 },
    ]);
    const first = await newShipment(so, [{ product: widget, quantity: 4 }]);
    await shipAll(first);

    let order = await getOrder(so.id);
    expect(order.status).toBe('partially_shipped');
    expect(orderLine(order, widget)).toMatchObject({
      shippedQuantity: 4,
      reservedQuantity: 2,
      unallocatedQuantity: 2,
    });
    expect(await onHand(widget.id, warehouse.id)).toBe(6);
    expect(await reserved(widget.id, warehouse.id)).toBe(2);
    expect(await reserved(gadget.id, warehouse.id)).toBe(2);

    await deliver(first).expect(200);
    expect((await getOrder(so.id)).status).toBe('partially_shipped');

    const second = await newShipment(so, [
      { product: widget, quantity: 2 },
      { product: gadget, quantity: 2 },
    ]);
    await shipAll(second);
    order = await getOrder(so.id);
    expect(order.status).toBe('shipped');
    expect(await reserved(widget.id, warehouse.id)).toBe(0);
    expect(await reserved(gadget.id, warehouse.id)).toBe(0);
    expect(await onHand(widget.id, warehouse.id)).toBe(4);

    await deliver(second).expect(200);
    expect((await getOrder(so.id)).status).toBe('delivered');

    const list = await admin.get(`/shipments?salesOrderId=${so.id}`);
    expect(list.body.meta.total).toBe(2);
  });

  it('returns short-picked units to the order, still reserved', async () => {
    const so = await confirmedOrder([{ productId: widget.id, quantity: 5 }]);
    const shipment = await newShipment(so, [{ product: widget, quantity: 5 }]);

    const noReason = await pick(shipment, { [widget.id]: 3 });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.details[0].path).toBe('shortPickReason');
    expect((await pick(shipment, { [widget.id]: 6 })).status).toBe(400);
    const nothing = await pick(shipment, { [widget.id]: 0 }, 'Bin empty');
    expect(nothing.body.error.message).toBe('Nothing was picked. Cancel the shipment instead.');

    const res = await pick(shipment, { [widget.id]: 3 }, 'Two units damaged on the shelf');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'picked',
      shortPickReason: 'Two units damaged on the shelf',
      totals: { requested: 5, picked: 3 },
    });
    let order = await getOrder(so.id);
    expect(orderLine(order, widget)).toMatchObject({
      allocatedQuantity: 3,
      unallocatedQuantity: 2,
      reservedQuantity: 5,
    });
    expect(order.history.at(-1)!.note).toBe(
      `${shipment.number}: 3 units picked, 2 short: Two units damaged on the shelf`,
    );

    await pack(shipment).expect(200);
    await dispatch(shipment).expect(200);
    expect(await onHand(widget.id, warehouse.id)).toBe(7);
    expect(await reserved(widget.id, warehouse.id)).toBe(2);
    order = await getOrder(so.id);
    expect(order.status).toBe('partially_shipped');

    const rest = await newShipment(order, [{ product: widget, quantity: 2 }]);
    await shipAll(rest);
    expect((await getOrder(so.id)).status).toBe('shipped');
  });

  it('cancelling a shipment puts its units back on the order', async () => {
    const so = await confirmedOrder([{ productId: widget.id, quantity: 4 }]);
    const shipment = await newShipment(so, [{ product: widget, quantity: 4 }]);
    await pick(shipment, { [widget.id]: 3 }, 'Short').expect(200);
    const noReason = await warehouseStaff.post(`/shipments/${shipment.id}/cancel`, {});
    expect(noReason.status).toBe(400);
    await warehouseStaff
      .post(`/shipments/${shipment.id}/cancel`, { reason: 'Customer asked to wait' })
      .expect(200);
    const order = await getOrder(so.id);
    expect(order.status).toBe('confirmed');
    expect(orderLine(order, widget)).toMatchObject({
      allocatedQuantity: 0,
      unallocatedQuantity: 4,
      reservedQuantity: 4,
    });
    expect(await reserved(widget.id, warehouse.id)).toBe(4);
  });
});

describe('cancellation', () => {
  it('cancels a confirmed order, its open pick lists and releases the reservation', async () => {
    const so = await confirmedOrder([
      { productId: widget.id, quantity: 6 },
      { productId: gadget.id, quantity: 3 },
    ]);
    const shipment = await newShipment(so, [{ product: widget, quantity: 2 }]);
    await pick(shipment).expect(200);

    expect((await sales.post(`/sales-orders/${so.id}/cancel`, {})).status).toBe(400);
    const res = await sales.post(`/sales-orders/${so.id}/cancel`, { reason: 'Customer withdrew' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const order = res.body.data as SalesOrderDto;
    expect(order).toMatchObject({ status: 'cancelled', cancelReason: 'Customer withdrew' });
    expect(orderLine(order, widget)).toMatchObject({ cancelledQuantity: 6, reservedQuantity: 0 });
    expect(order.history.at(-1)).toMatchObject({
      action: 'cancelled',
      note: `Customer withdrew (released 9 units; cancelled ${shipment.number})`,
    });
    expect(await reserved(widget.id, warehouse.id)).toBe(0);
    expect(await reserved(gadget.id, warehouse.id)).toBe(0);
    expect(await onHand(widget.id, warehouse.id)).toBe(10);

    const cancelledShipment = (await admin.get(`/shipments/${shipment.id}`)).body.data;
    expect(cancelledShipment).toMatchObject({ status: 'cancelled' });
    expect((await sales.post(`/sales-orders/${so.id}/cancel`, { reason: 'Again' })).status).toBe(
      409,
    );
    expect((await createShipment(order, [{ product: widget, quantity: 1 }])).status).toBe(409);

    // The released units can be sold again.
    await confirmedOrder([{ productId: widget.id, quantity: 10 }]);
  });

  it('cancels only the unshipped remainder of a partly shipped order', async () => {
    const so = await confirmedOrder([{ productId: widget.id, quantity: 8 }]);
    const shipment = await newShipment(so, [{ product: widget, quantity: 3 }]);
    await shipAll(shipment);

    const res = await sales.post(`/sales-orders/${so.id}/cancel`, { reason: 'Rest out of season' });
    expect(res.status).toBe(200);
    const order = res.body.data as SalesOrderDto;
    expect(order.status).toBe('shipped');
    expect(orderLine(order, widget)).toMatchObject({
      shippedQuantity: 3,
      cancelledQuantity: 5,
      reservedQuantity: 0,
    });
    expect(order.history.at(-1)).toMatchObject({ action: 'remainder_cancelled' });
    expect(await reserved(widget.id, warehouse.id)).toBe(0);
    expect(await onHand(widget.id, warehouse.id)).toBe(7);

    await deliver(shipment).expect(200);
    expect((await getOrder(so.id)).status).toBe('delivered');
  });

  it('cancels drafts without touching stock', async () => {
    const so = await draftOrder([{ productId: widget.id, quantity: 2 }]);
    const res = await sales.post(`/sales-orders/${so.id}/cancel`, { reason: 'Duplicate' });
    expect(res.body.data.status).toBe('cancelled');
    expect(await reserved(widget.id, warehouse.id)).toBe(0);
  });

  it('stays consistent when cancellation races a dispatch', async () => {
    const so = await confirmedOrder([{ productId: widget.id, quantity: 6 }]);
    const shipment = await newShipment(so, [{ product: widget, quantity: 4 }]);
    await pick(shipment).expect(200);
    await pack(shipment).expect(200);

    const [dispatched, cancelled] = await Promise.all([
      dispatch(shipment),
      sales.post(`/sales-orders/${so.id}/cancel`, { reason: 'Changed mind' }),
    ]);
    expect(cancelled.status).toBe(200);
    const order = await getOrder(so.id);
    if (dispatched.status === 200) {
      // Dispatch won: 4 left, the other 2 were released.
      expect(order.status).toBe('shipped');
      expect(await onHand(widget.id, warehouse.id)).toBe(6);
    } else {
      // Cancel won: the shipment was cancelled before it left.
      expect(dispatched.status).toBe(409);
      expect(order.status).toBe('cancelled');
      expect(await onHand(widget.id, warehouse.id)).toBe(10);
    }
    expect(await reserved(widget.id, warehouse.id)).toBe(0);
  });
});

describe('lists and summary', () => {
  it('filters orders to fulfil and summarises the fulfilment queue', async () => {
    await draftOrder([{ productId: widget.id, quantity: 1 }]);
    const waiting = await confirmedOrder([{ productId: widget.id, quantity: 2 }]);
    const allocated = await confirmedOrder([{ productId: gadget.id, quantity: 1 }]);
    const picking = await newShipment(allocated, [{ product: gadget, quantity: 1 }]);
    const moving = await confirmedOrder([{ productId: widget.id, quantity: 1 }]);
    await shipAll(await newShipment(moving, [{ product: widget, quantity: 1 }]));

    const toFulfil = await admin.get('/sales-orders?toFulfil=true');
    expect(toFulfil.body.data.map((o: SalesOrderDto) => o.id)).toEqual([waiting.id]);
    const open = await admin.get('/sales-orders?open=true');
    expect(open.body.meta.total).toBe(2);
    const byProduct = await admin.get(`/sales-orders?productId=${gadget.id}`);
    expect(byProduct.body.meta.total).toBe(1);

    const summary = (await admin.get('/sales-orders/fulfilment-summary')).body
      .data as FulfilmentSummaryDto;
    expect(summary).toEqual({
      ordersToConfirm: 1,
      ordersToFulfil: 1,
      shipmentsToPick: 1,
      shipmentsToPack: 0,
      shipmentsToDispatch: 0,
      shipmentsInTransit: 1,
    });

    const pending = await admin.get('/shipments?pending=true');
    expect(pending.body.data.map((s: ShipmentDto) => s.id)).toEqual([picking.id]);
    const search = await admin.get('/shipments?search=NL123');
    expect(search.body.meta.total).toBe(1);
  });

  it('marks open orders past their required date as overdue', async () => {
    const so = await confirmedOrder([{ productId: widget.id, quantity: 1 }]);
    await SalesOrder.updateOne({ _id: so.id }, { requiredDate: new Date('2020-01-01T00:00:00Z') });
    expect((await getOrder(so.id)).isOverdue).toBe(true);
  });
});
