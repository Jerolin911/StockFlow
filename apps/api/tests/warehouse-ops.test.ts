import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  CategoryDto,
  ProductDto,
  StockAdjustmentDto,
  StockCountDto,
  TransferDto,
  WarehouseDto,
} from '@stockflow/shared';
import { createApp } from '../src/app.js';
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
let inventory: Api; // inventory manager: approves, posts
let staff: Api;
let sales: Api;
let category: CategoryDto;
let main: WarehouseDto;
let north: WarehouseDto;
let widget: ProductDto;
let gadget: ProductDto;

beforeEach(async () => {
  admin = api(app, await tokenFor(app, 'admin'));
  inventory = api(app, await tokenFor(app, 'inventory_manager'));
  staff = api(app, await tokenFor(app, 'staff'));
  sales = api(app, await tokenFor(app, 'sales_manager'));
  category = await createCategory(admin, { code: 'OPS' });
  main = await createWarehouse(admin, { code: 'MAIN' });
  north = await createWarehouse(admin, { code: 'NORTH' });
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

async function requestTransfer(lines: { productId: string; quantity: number }[], client = staff) {
  const res = await client.post('/stock-transfers', {
    fromWarehouseId: main.id,
    toWarehouseId: north.id,
    lines,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as TransferDto;
}

async function approvedTransfer(lines: { productId: string; quantity: number }[]) {
  const t = await requestTransfer(lines);
  const res = await inventory.post(`/stock-transfers/${t.id}/approve`, {});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as TransferDto;
}

const line = (t: TransferDto, p: ProductDto) => t.lines.find((l) => l.productId === p.id)!;

describe('transfers', () => {
  it('requests, approves, dispatches and receives in full', async () => {
    const t = await requestTransfer([
      { productId: widget.id, quantity: 8 },
      { productId: gadget.id, quantity: 2 },
    ]);
    expect(t).toMatchObject({
      status: 'requested',
      number: expect.stringMatching(/^TRF-\d{4}-\d{5}$/),
      fromWarehouse: { code: 'MAIN' },
      toWarehouse: { code: 'NORTH' },
    });
    // Approval doesn't move stock.
    await inventory.post(`/stock-transfers/${t.id}/approve`, {}).expect(200);
    expect(await onHand(widget.id, main.id)).toBe(20);

    const dispatched = await staff.post(`/stock-transfers/${t.id}/dispatch`, {
      carrier: 'Own van',
    });
    expect(dispatched.status, JSON.stringify(dispatched.body)).toBe(200);
    expect(dispatched.body.data).toMatchObject({
      status: 'in_transit',
      totals: { requested: 10, dispatched: 10, inTransit: 10 },
    });
    // In transit: gone from MAIN, not yet in NORTH.
    expect(await onHand(widget.id, main.id)).toBe(12);
    expect(await onHand(widget.id, north.id)).toBe(0);
    const out = await StockMovement.findOne({ type: 'TRANSFER_OUT', productId: widget.id }).lean();
    expect(out).toMatchObject({ quantity: -8, unitCost: 500, reference: { type: 'transfer' } });

    const received = await staff.post(`/stock-transfers/${t.id}/receive`, {
      lines: (dispatched.body.data as TransferDto).lines.map((l) => ({
        lineId: l.id,
        receivedQuantity: l.dispatchedQuantity,
      })),
    });
    expect(received.status, JSON.stringify(received.body)).toBe(200);
    expect(received.body.data).toMatchObject({ status: 'received', totals: { inTransit: 0 } });
    expect(await onHand(widget.id, north.id)).toBe(8);
    expect(await onHand(gadget.id, north.id)).toBe(2);
  });

  it('receives in parts, with damaged units going to quarantine', async () => {
    const t = await approvedTransfer([{ productId: widget.id, quantity: 10 }]);
    await staff.post(`/stock-transfers/${t.id}/dispatch`, {}).expect(200);
    const lineId = t.lines[0]!.id;

    const first = await staff.post(`/stock-transfers/${t.id}/receive`, {
      lines: [{ lineId, receivedQuantity: 4, damagedQuantity: 1 }],
    });
    expect(first.body.data).toMatchObject({
      status: 'partially_received',
      totals: { inTransit: 5 },
    });
    expect(await onHand(widget.id, north.id)).toBe(4);
    expect(await quarantine(widget.id, north.id)).toBe(1);

    const over = await staff.post(`/stock-transfers/${t.id}/receive`, {
      lines: [{ lineId, receivedQuantity: 6 }],
    });
    expect(over.status).toBe(400);
    expect(over.body.error.details[0].message).toBe(`Only 5 pcs of ${widget.sku} in transit`);

    const last = await staff.post(`/stock-transfers/${t.id}/receive`, {
      lines: [{ lineId, receivedQuantity: 5 }],
    });
    expect(last.body.data.status).toBe('received');
    expect(last.body.data.receipts).toHaveLength(2);
    expect(await onHand(widget.id, north.id)).toBe(9);
  });

  it('closes a short transfer by writing off what never arrived', async () => {
    const t = await approvedTransfer([{ productId: widget.id, quantity: 6 }]);
    await staff.post(`/stock-transfers/${t.id}/dispatch`, {}).expect(200);
    await staff
      .post(`/stock-transfers/${t.id}/receive`, {
        lines: [{ lineId: t.lines[0]!.id, receivedQuantity: 4 }],
      })
      .expect(200);

    expect((await staff.post(`/stock-transfers/${t.id}/close`, { reason: 'x' })).status).toBe(403);
    const closed = await inventory.post(`/stock-transfers/${t.id}/close`, {
      reason: 'Two units missing from the pallet',
    });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    const done = closed.body.data as TransferDto;
    expect(done).toMatchObject({ status: 'closed', totals: { inTransit: 0 } });
    expect(line(done, widget)).toMatchObject({ receivedQuantity: 4, lostQuantity: 2 });
    expect(await onHand(widget.id, north.id)).toBe(4);
    expect(await onHand(widget.id, main.id)).toBe(14);

    const adjustment = (await admin.get(`/stock/adjustments/${done.lossAdjustment!.id}`)).body
      .data as StockAdjustmentDto;
    expect(adjustment).toMatchObject({
      reason: 'loss',
      warehouse: { code: 'NORTH' },
      totalOut: 2,
      source: { type: 'transfer', number: t.number },
    });
  });

  it('dispatches less than requested and refuses more than is available', async () => {
    const t = await approvedTransfer([
      { productId: widget.id, quantity: 8 },
      { productId: gadget.id, quantity: 6 },
    ]);
    const short = await staff.post(`/stock-transfers/${t.id}/dispatch`, {});
    expect(short.status).toBe(409);
    expect(short.body.error.details).toEqual([
      { path: 'lines.1.quantity', message: `Only 5 pcs of ${gadget.sku} available in MAIN` },
    ]);
    expect(await onHand(widget.id, main.id)).toBe(20);

    const partial = await staff.post(`/stock-transfers/${t.id}/dispatch`, {
      lines: [
        { lineId: line(t, widget).id, quantity: 5 },
        { lineId: line(t, gadget).id, quantity: 5 },
      ],
    });
    expect(partial.status, JSON.stringify(partial.body)).toBe(200);
    expect(partial.body.data.totals).toMatchObject({ requested: 14, dispatched: 10 });
  });

  it('enforces approval rules, cancellation before dispatch and the same-warehouse check', async () => {
    const same = await staff.post('/stock-transfers', {
      fromWarehouseId: main.id,
      toWarehouseId: main.id,
      lines: [{ productId: widget.id, quantity: 1 }],
    });
    expect(same.body.error.details[0].path).toBe('toWarehouseId');

    const own = await requestTransfer([{ productId: widget.id, quantity: 1 }], inventory);
    const self = await inventory.post(`/stock-transfers/${own.id}/approve`, {});
    expect(self.body.error.message).toBe(
      'Someone other than the requester must approve this transfer',
    );
    expect((await staff.post(`/stock-transfers/${own.id}/approve`, {})).status).toBe(403);
    await admin.post(`/stock-transfers/${own.id}/approve`, {}).expect(200);
    expect((await staff.post(`/stock-transfers/${own.id}/dispatch`, {})).status).toBe(200);
    const late = await inventory.post(`/stock-transfers/${own.id}/cancel`, { reason: 'Too late' });
    expect(late.status).toBe(409);

    const t = await requestTransfer([{ productId: widget.id, quantity: 2 }]);
    expect((await staff.post(`/stock-transfers/${t.id}/dispatch`, {})).status).toBe(409);
    await inventory
      .post(`/stock-transfers/${t.id}/reject`, { reason: 'Use the north stock' })
      .expect(200);
    expect((await sales.post('/stock-transfers', {})).status).toBe(403);
  });

  it('never dispatches the same units twice under concurrent transfers', async () => {
    const transfers = await Promise.all(
      Array.from({ length: 4 }, () => approvedTransfer([{ productId: widget.id, quantity: 6 }])),
    );
    const results = await Promise.all(
      transfers.map((t) => staff.post(`/stock-transfers/${t.id}/dispatch`, {})),
    );
    // 20 on hand: three transfers of 6 fit.
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(await onHand(widget.id, main.id)).toBe(2);
  });

  it('lists transfers in transit for a product', async () => {
    const t = await approvedTransfer([{ productId: widget.id, quantity: 3 }]);
    await staff.post(`/stock-transfers/${t.id}/dispatch`, {}).expect(200);
    await requestTransfer([{ productId: gadget.id, quantity: 1 }]);
    const res = await admin.get(`/stock-transfers?inTransit=true&productId=${widget.id}`);
    expect(res.body.data.map((x: TransferDto) => x.id)).toEqual([t.id]);
    const summary = (await admin.get('/warehouse-ops/summary')).body.data;
    expect(summary).toMatchObject({ transfersToApprove: 1, transfersInTransit: 1 });
  });
});

describe('physical counts', () => {
  async function startCount(client = staff) {
    const res = await client.post('/stock-counts', { warehouseId: main.id });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data as StockCountDto;
  }
  const countLine = (c: StockCountDto, p: ProductDto) => c.lines.find((l) => l.productId === p.id)!;

  it('compares counted with system quantities and posts variances with reasons', async () => {
    const count = await startCount();
    expect(count).toMatchObject({
      status: 'counting',
      number: expect.stringMatching(/^CNT-\d{4}-\d{5}$/),
      progress: { counted: 0, total: 2 },
    });
    expect(countLine(count, widget)).toMatchObject({ snapshotQuantity: 20, systemQuantity: 20 });

    const recorded = await staff.put(`/stock-counts/${count.id}/counts`, {
      lines: [
        { lineId: countLine(count, widget).id, countedQuantity: 17 },
        { lineId: countLine(count, gadget).id, countedQuantity: 6 },
      ],
    });
    const after = recorded.body.data as StockCountDto;
    expect(countLine(after, widget).variance).toBe(-3);
    expect(countLine(after, gadget).variance).toBe(1);

    await staff.post(`/stock-counts/${count.id}/submit`, {}).expect(200);
    // Staff count; only stock:adjust can post.
    expect((await staff.post(`/stock-counts/${count.id}/post`, {})).status).toBe(403);
    const missing = await inventory.post(`/stock-counts/${count.id}/post`, {});
    expect(missing.status).toBe(400);
    expect(missing.body.error.details.map((d: { path: string }) => d.path)).toEqual([
      'lines.0.reason',
      'lines.1.reason',
    ]);
    const wrongWay = await inventory.post(`/stock-counts/${count.id}/post`, {
      lines: [
        { lineId: countLine(count, widget).id, reason: 'found' },
        { lineId: countLine(count, gadget).id, reason: 'damage' },
      ],
    });
    expect(wrongWay.body.error.details.map((d: { message: string }) => d.message)).toEqual([
      'A shortfall can’t be found stock',
      'A surplus can’t be damaged or lost',
    ]);

    const posted = await inventory.post(`/stock-counts/${count.id}/post`, {
      lines: [
        { lineId: countLine(count, widget).id, reason: 'damage', note: 'Crushed' },
        { lineId: countLine(count, gadget).id, reason: 'found' },
      ],
    });
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    const done = posted.body.data as StockCountDto;
    expect(done.status).toBe('posted');
    expect(await onHand(widget.id, main.id)).toBe(17);
    expect(await onHand(gadget.id, main.id)).toBe(6);

    const adjustment = (await admin.get(`/stock/adjustments/${done.adjustment!.id}`)).body
      .data as StockAdjustmentDto;
    expect(adjustment).toMatchObject({
      reason: 'count',
      source: { type: 'stockCount', number: count.number },
      totalIn: 1,
      totalOut: 3,
    });
    expect(adjustment.lines.map((l) => l.reason).sort()).toEqual(['damage', 'found']);
  });

  it('measures variance against stock at posting time, not when counting began', async () => {
    const count = await startCount();
    await staff.put(`/stock-counts/${count.id}/counts`, {
      lines: count.lines.map((l) => ({ lineId: l.id, countedQuantity: l.snapshotQuantity })),
    });
    // Stock moves while the sheet is out.
    await inventory
      .post('/stock/adjustments', {
        warehouseId: main.id,
        reason: 'damage',
        lines: [{ productId: widget.id, quantityChange: -2 }],
      })
      .expect(201);
    await staff.post(`/stock-counts/${count.id}/submit`, {}).expect(200);
    const posted = await inventory.post(`/stock-counts/${count.id}/post`, {
      lines: [{ lineId: countLine(count, widget).id, reason: 'correction' }],
    });
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    expect(countLine(posted.body.data, widget)).toMatchObject({ systemQuantity: 18, variance: 2 });
    expect(await onHand(widget.id, main.id)).toBe(20);
  });

  it('keeps one open count per warehouse and requires every product counted', async () => {
    const count = await startCount();
    const second = await staff.post('/stock-counts', { warehouseId: main.id });
    expect(second.status).toBe(409);
    expect(second.body.error.message).toBe(
      'MAIN already has a count in progress. Finish or cancel it first.',
    );
    const early = await staff.post(`/stock-counts/${count.id}/submit`, {});
    expect(early.body.error.message).toBe('2 products haven’t been counted yet');
    await staff.post(`/stock-counts/${count.id}/cancel`, { reason: 'Wrong day' }).expect(200);
    await startCount();
  });

  it('records counts from two counters without losing either', async () => {
    const count = await startCount();
    await Promise.all([
      staff.put(`/stock-counts/${count.id}/counts`, {
        lines: [{ lineId: countLine(count, widget).id, countedQuantity: 19 }],
      }),
      inventory.put(`/stock-counts/${count.id}/counts`, {
        lines: [{ lineId: countLine(count, gadget).id, countedQuantity: 5 }],
      }),
    ]);
    const res = await admin.get(`/stock-counts/${count.id}`);
    expect(res.body.data.progress.counted).toBe(2);
  });

  it('refuses a count below what’s reserved for orders', async () => {
    const customer = await createCustomer(admin);
    const so = await admin.post('/sales-orders', {
      customerId: customer.id,
      warehouseId: main.id,
      lines: [{ productId: gadget.id, quantity: 4 }],
    });
    await admin.post(`/sales-orders/${so.body.data.id}/confirm`, {}).expect(200);

    const count = await startCount();
    await staff.put(`/stock-counts/${count.id}/counts`, {
      lines: [
        { lineId: countLine(count, widget).id, countedQuantity: 20 },
        { lineId: countLine(count, gadget).id, countedQuantity: 3 },
      ],
    });
    await staff.post(`/stock-counts/${count.id}/submit`, {}).expect(200);
    const res = await inventory.post(`/stock-counts/${count.id}/post`, {
      lines: [{ lineId: countLine(count, gadget).id, reason: 'loss' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({
      path: 'lines.1.countedQuantity',
      message: `${gadget.sku}: counted 3, but 4 are reserved for orders`,
    });
    expect(await onHand(gadget.id, main.id)).toBe(5);
  });
});

describe('quarantine', () => {
  it('isolates damaged stock, then releases or writes it off', async () => {
    const moved = await inventory.post('/stock/quarantine', {
      warehouseId: main.id,
      action: 'quarantine',
      reason: 'damage',
      notes: 'Water leak',
      lines: [{ productId: widget.id, quantity: 5 }],
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(201);
    expect(moved.body.data).toMatchObject({
      type: 'quarantine',
      number: expect.stringMatching(/^QTN-/),
      lines: [{ quantityChange: -5, previousOnHand: 20, balanceAfter: 15, quarantineAfter: 5 }],
    });
    expect(await onHand(widget.id, main.id)).toBe(15);
    expect(await quarantine(widget.id, main.id)).toBe(5);

    const levels = await admin.get(`/stock/levels?productId=${widget.id}`);
    expect(levels.body.data[0]).toMatchObject({ onHand: 15, available: 15, quarantine: 5 });
    const listed = await admin.get('/stock/quarantine');
    expect(listed.body.data).toEqual([
      expect.objectContaining({
        quarantine: 5,
        product: expect.objectContaining({ sku: widget.sku }),
      }),
    ]);

    await inventory
      .post('/stock/quarantine', {
        warehouseId: main.id,
        action: 'release',
        reason: 'correction',
        lines: [{ productId: widget.id, quantity: 2 }],
      })
      .expect(201);
    const writeOff = await inventory.post('/stock/quarantine', {
      warehouseId: main.id,
      action: 'write_off',
      reason: 'damage',
      lines: [{ productId: widget.id, quantity: 4 }],
    });
    expect(writeOff.status).toBe(409);
    expect(writeOff.body.error.details[0].message).toBe(
      `Only 3 pcs of ${widget.sku} in quarantine at MAIN`,
    );
    await inventory
      .post('/stock/quarantine', {
        warehouseId: main.id,
        action: 'write_off',
        reason: 'damage',
        lines: [{ productId: widget.id, quantity: 3 }],
      })
      .expect(201);
    expect(await onHand(widget.id, main.id)).toBe(17);
    expect(await quarantine(widget.id, main.id)).toBe(0);
    expect((await staff.post('/stock/quarantine', {})).status).toBe(403);

    const movements = await admin.get(`/stock/movements?productId=${widget.id}&bucket=quarantine`);
    expect(movements.body.data.map((m: { type: string }) => m.type)).toEqual([
      'WRITE_OFF',
      'RELEASE',
      'QUARANTINE',
    ]);
  });
});

describe('adjustment reversals', () => {
  it('reverses an adjustment with a linked opposite document, once', async () => {
    const adj = await inventory.post('/stock/adjustments', {
      warehouseId: main.id,
      reason: 'loss',
      lines: [
        { productId: widget.id, quantityChange: -4 },
        { productId: gadget.id, quantityChange: 2 },
      ],
    });
    const original = adj.body.data as StockAdjustmentDto;
    expect(
      (await staff.post(`/stock/adjustments/${original.id}/reverse`, { reason: 'x' })).status,
    ).toBe(403);
    expect((await inventory.post(`/stock/adjustments/${original.id}/reverse`, {})).status).toBe(
      400,
    );

    const res = await inventory.post(`/stock/adjustments/${original.id}/reverse`, {
      reason: 'The missing units were in the wrong bay',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const reversal = res.body.data as StockAdjustmentDto;
    expect(reversal).toMatchObject({
      reason: 'correction',
      reversalOf: { id: original.id, number: original.number },
      notes: `Reverses ${original.number}: The missing units were in the wrong bay`,
    });
    expect(reversal.lines.map((l) => l.quantityChange)).toEqual([4, -2]);
    expect(await onHand(widget.id, main.id)).toBe(20);
    expect(await onHand(gadget.id, main.id)).toBe(5);

    const again = (await admin.get(`/stock/adjustments/${original.id}`)).body.data;
    expect(again.reversedBy).toEqual({ id: reversal.id, number: reversal.number });
    // Both documents' movements are kept.
    expect(await StockMovement.countDocuments({ type: 'ADJUSTMENT' })).toBe(4);
    expect(
      (await inventory.post(`/stock/adjustments/${original.id}/reverse`, { reason: 'x' })).status,
    ).toBe(409);
    expect(
      (await inventory.post(`/stock/adjustments/${reversal.id}/reverse`, { reason: 'x' })).status,
    ).toBe(409);
  });

  it('reverses only once under concurrent requests', async () => {
    const adj = await inventory.post('/stock/adjustments', {
      warehouseId: main.id,
      reason: 'found',
      lines: [{ productId: widget.id, quantityChange: 3 }],
    });
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        inventory.post(`/stock/adjustments/${adj.body.data.id}/reverse`, {
          reason: 'Duplicate entry',
        }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await onHand(widget.id, main.id)).toBe(20);
  });

  it('refuses to reverse opening stock', async () => {
    const list = await admin.get('/stock/adjustments?type=opening');
    const res = await inventory.post(`/stock/adjustments/${list.body.data[0].id}/reverse`, {
      reason: 'Wrong',
    });
    expect(res.status).toBe(409);
  });
});
