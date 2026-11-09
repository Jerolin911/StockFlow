import {
  confirmPickSchema,
  createShipmentSchema,
  dispatchShipmentSchema,
  goodsReceiptSchema,
  packShipmentSchema,
  purchaseOrderSchema,
  salesOrderSchema,
  trackingEventSchema,
} from '@stockflow/shared';
import type { Actor } from '../src/modules/common/documents.js';
import { historyEntry, snapshot } from '../src/modules/common/documents.js';
import { postGoodsReceipt } from '../src/modules/purchasing/goods-receipts.js';
import { PurchaseOrder } from '../src/modules/purchasing/models.js';
import { createPurchaseOrder } from '../src/modules/purchasing/purchase-orders.js';
import { SalesOrder, Shipment } from '../src/modules/sales/models.js';
import { confirmSalesOrder, createSalesOrder } from '../src/modules/sales/sales-orders.js';
import {
  addTrackingEvent,
  confirmPick,
  createShipment,
  dispatch,
  pack,
} from '../src/modules/sales/shipments.js';
import type { Timeline } from './seed-timeline.js';

export interface HistoryContext {
  timeline: Timeline;
  start: Date;
  end: Date;
  actors: { procurement: Actor; admin: Actor; sales: Actor; staff: Actor };
  productIds: string[];
  supplierIds: string[];
  customerIds: string[];
  warehouseId: string;
}

/** Products sold in the history, with the range of units per order line. */
const DEMAND: [productIndex: number, min: number, max: number][] = [
  [0, 5, 30],
  [1, 1, 3],
  [3, 2, 6],
  [4, 1, 2],
  [6, 1, 4],
  [8, 1, 2],
  [9, 5, 20],
  [10, 1, 2],
  [13, 20, 60],
  [15, 1, 2],
  [16, 2, 6],
  [18, 2, 6],
];

/** Which supplier (by index) stocks each product, matching the supplier price lists. */
const supplierFor = (productIndex: number) =>
  productIndex <= 4 ? 0 : productIndex <= 9 ? 1 : productIndex <= 12 ? 2 : 3;

const CARRIERS = ['Own van', 'Northline Freight', 'Parcelwise'];

/** Deterministic pseudo-random numbers so every seed produces the same demo. */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const at = (day: Date, hours: number, minutes = 0) => {
  const d = new Date(day);
  d.setUTCHours(hours, minutes, 0, 0);
  return d;
};
const addDays = (day: Date, days: number) => {
  const d = new Date(day);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};

/**
 * Weeks of completed trading before today: each Monday the week's demand arrives on purchase
 * orders (raised the Wednesday before, sometimes late), then customer orders are confirmed,
 * picked, packed, dispatched and delivered through the week. Every week receives exactly what
 * it ships, so today's stock is unchanged and the open work seeded afterwards stays the same.
 */
export async function seedHistory(ctx: HistoryContext): Promise<void> {
  const rand = random(20261109);
  const pick = <T>(items: T[]) => items[Math.floor(rand() * items.length)]!;
  const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const { procurement, admin, sales, staff } = ctx.actors;
  const step = ctx.timeline.at;

  // First Monday on or after the start.
  let monday = new Date(ctx.start);
  monday.setUTCHours(0, 0, 0, 0);
  while (monday.getUTCDay() !== 1) monday = addDays(monday, 1);

  let week = 0;
  for (; addDays(monday, 5) <= ctx.end; monday = addDays(monday, 7), week++) {
    // Plan the week's orders: more of them as the business grows.
    const orders = Array.from({ length: between(3, 5) + Math.floor(week / 3) }, () => {
      const day = addDays(monday, between(0, 4));
      const lineCount = between(1, 3);
      const products = new Set<number>();
      while (products.size < lineCount) products.add(pick(DEMAND)[0]);
      return {
        day,
        customerId: pick(ctx.customerIds),
        lines: [...products].map((i) => {
          const [, min, max] = DEMAND.find(([p]) => p === i)!;
          return { index: i, quantity: between(min, max), discountRate: rand() < 0.2 ? 500 : 0 };
        }),
      };
    });
    orders.sort((a, b) => a.day.getTime() - b.day.getTime());

    // Replenish exactly the week's demand from each supplier: ordered the Wednesday before,
    // received first thing Monday (a quarter of them were expected the Friday before).
    const demand = new Map<number, number>();
    for (const order of orders) {
      for (const line of order.lines) {
        demand.set(line.index, (demand.get(line.index) ?? 0) + line.quantity);
      }
    }
    const purchaseOrders: string[] = [];
    for (let s = 0; s < ctx.supplierIds.length; s++) {
      const lines = [...demand].filter(([i]) => supplierFor(i) === s);
      if (lines.length === 0) continue;
      const expected = addDays(monday, rand() < 0.25 ? -3 : 0);
      const poId = await step(at(addDays(monday, -5), 10, 10 * s), async () => {
        const id = await createPurchaseOrder(
          purchaseOrderSchema.parse({
            supplierId: ctx.supplierIds[s],
            warehouseId: ctx.warehouseId,
            lines: lines.map(([i, quantity]) => ({ productId: ctx.productIds[i], quantity })),
          }),
          procurement,
        );
        await PurchaseOrder.updateOne({ _id: id }, { $set: { expectedDate: expected } });
        return id;
      });
      await step(at(addDays(monday, -5), 15, 10 * s), () =>
        PurchaseOrder.updateOne(
          { _id: poId },
          {
            $set: { status: 'approved', approvedBy: snapshot(admin), approvedAt: new Date() },
            $push: {
              history: {
                $each: [historyEntry(procurement, 'submitted'), historyEntry(admin, 'approved')],
              },
            },
          },
        ),
      );
      purchaseOrders.push(poId);
    }
    for (const [n, poId] of purchaseOrders.entries()) {
      await step(at(monday, 8, 15 * n), async () => {
        const po = await PurchaseOrder.findById(poId).lean();
        await postGoodsReceipt(
          goodsReceiptSchema.parse({
            purchaseOrderId: poId,
            deliveryNote: `DN-${String(week + 1).padStart(2, '0')}${n}${between(100, 999)}`,
            lines: po!.lines.map((l) => ({
              poLineId: l._id.toString(),
              acceptedQuantity: l.quantity,
            })),
          }),
          staff,
        );
      });
    }

    // Each order through the day, in order, so the ledger reads chronologically.
    const deliveries: { shipmentId: string; when: Date }[] = [];
    let previousDay = -1;
    let k = 0;
    for (const order of orders) {
      k = order.day.getTime() === previousDay ? k + 1 : 0;
      previousDay = order.day.getTime();
      const soId = await step(at(order.day, 9, 20 * k), async () => {
        const id = await createSalesOrder(
          salesOrderSchema.parse({
            customerId: order.customerId,
            warehouseId: ctx.warehouseId,
            lines: order.lines.map((l) => ({
              productId: ctx.productIds[l.index],
              quantity: l.quantity,
              ...(l.discountRate ? { discountRate: l.discountRate } : {}),
            })),
          }),
          sales,
        );
        await SalesOrder.updateOne({ _id: id }, { $set: { requiredDate: addDays(order.day, 3) } });
        return id;
      });
      await step(at(order.day, 10, 20 * k), () => confirmSalesOrder(soId, sales));
      const shipmentId = await step(at(order.day, 13, 15 * k), async () => {
        const so = await SalesOrder.findById(soId).lean();
        const id = await createShipment(
          createShipmentSchema.parse({
            salesOrderId: soId,
            lines: so!.lines.map((l) => ({ soLineId: l._id.toString(), quantity: l.quantity })),
          }),
          staff,
        );
        const shipment = await Shipment.findById(id).lean();
        await confirmPick(
          id,
          confirmPickSchema.parse({
            lines: shipment!.lines.map((l) => ({
              lineId: l._id.toString(),
              pickedQuantity: l.quantity,
            })),
          }),
          staff,
        );
        return id;
      });
      await step(at(order.day, 15, 10 * k), () =>
        pack(
          shipmentId,
          packShipmentSchema.parse({
            packageCount: between(1, 4),
            weightGrams: between(2, 30) * 1000,
          }),
          staff,
        ),
      );
      const carrier = pick(CARRIERS);
      const trackingNumber = carrier === 'Own van' ? '' : `TRK-${between(10000000, 99999999)}`;
      await step(at(order.day, 16, 10 * k), () =>
        dispatch(shipmentId, dispatchShipmentSchema.parse({ carrier, trackingNumber }), staff),
      );
      // Usually the next working day; occasionally slower.
      let delivered = addDays(order.day, rand() < 0.15 ? 4 : 1);
      while ([0, 6].includes(delivered.getUTCDay())) delivered = addDays(delivered, 1);
      deliveries.push({ shipmentId, when: at(delivered, between(9, 16), between(0, 59)) });
    }
    for (const { shipmentId, when } of deliveries) {
      await step(when, () =>
        addTrackingEvent(
          shipmentId,
          trackingEventSchema.parse({ type: 'delivered', receivedBy: 'Goods-in desk' }),
          staff,
        ),
      );
    }
  }
}
