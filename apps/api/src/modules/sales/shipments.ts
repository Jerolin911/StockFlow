import { Router } from 'express';
import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import {
  PRE_DISPATCH_SHIPMENT_STATUSES,
  SALES_ORDER_STATUS_LABELS,
  SHIPMENT_STATUS_LABELS,
  TRACKING_EVENT_LABELS,
  confirmPickSchema,
  createShipmentSchema,
  dispatchShipmentSchema,
  listShipmentsQuerySchema,
  packShipmentSchema,
  reasonBodySchema,
  trackingEventSchema,
  type ListShipmentsQuery,
  type SalesOrderStatus,
  type ShipmentDto,
  type ShipmentStatus,
} from '@stockflow/shared';
import type { z } from 'zod';
import { nextDocumentNumber } from '../../lib/counters.js';
import { AppError, invalidState, notFound } from '../../lib/errors.js';
import { escapeRegex, parseId, parseSort } from '../../lib/http.js';
import { inTransaction } from '../../lib/transaction.js';
import { notify } from '../notifications/notifications.js';
import { authenticate, authorize, requireAuth } from '../../middleware/auth.js';
import { Product } from '../products/product.model.js';
import { applyMovement } from '../stock/stock.service.js';
import {
  historyDto,
  historyEntry,
  requireActiveWarehouse,
  snapshot,
  userRef,
  validation,
  warehouseLookup,
  warehouseRef,
  type Actor,
  type WarehouseLookup,
} from '../common/documents.js';
import { openDocumentAddress } from '../privacy/customer-data.js';
import { loadCustomerKeys, type CustomerKeys } from '../privacy/customer-keys.js';
import { SalesOrder, Shipment, type ShipmentRecord } from './models.js';
import { fulfilmentStatus, isOpenOrder, unallocatedFor } from './sales-orders.js';

type CreateInput = z.output<typeof createShipmentSchema>;
type PickInput = z.output<typeof confirmPickSchema>;
type PackInput = z.output<typeof packShipmentSchema>;
type DispatchInput = z.output<typeof dispatchShipmentSchema>;
type TrackingInput = z.output<typeof trackingEventSchema>;

const units = (n: number) => `${n} unit${n === 1 ? '' : 's'}`;

export function toShipmentDto(
  s: ShipmentRecord,
  warehouses: WarehouseLookup,
  customerKeys: CustomerKeys,
): ShipmentDto {
  const picked = s.lines.every((l) => l.pickedQuantity !== null && l.pickedQuantity !== undefined)
    ? s.lines.reduce((sum, l) => sum + (l.pickedQuantity ?? 0), 0)
    : null;
  return {
    id: s._id.toString(),
    number: s.number,
    status: s.status as ShipmentStatus,
    salesOrder: { id: s.salesOrder._id!.toString(), number: s.salesOrder.number ?? '' },
    customer: {
      id: s.customer._id.toString(),
      code: s.customer.code ?? '',
      name: s.customer.name ?? '',
    },
    warehouse: warehouseRef(warehouses, s.warehouseId),
    ...openDocumentAddress(customerKeys, s.customer._id, s.shippingAddress),
    lines: s.lines.map((l) => ({
      id: l._id.toString(),
      soLineId: l.soLineId.toString(),
      productId: l.productId.toString(),
      sku: l.sku,
      name: l.name,
      unit: l.unit,
      quantity: l.quantity,
      pickedQuantity: l.pickedQuantity ?? null,
      unitCost: l.unitCost ?? null,
    })),
    totals: { requested: s.lines.reduce((sum, l) => sum + l.quantity, 0), picked },
    notes: s.notes,
    shortPickReason: s.shortPickReason,
    packageCount: s.packageCount ?? null,
    weightGrams: s.weightGrams ?? null,
    carrier: s.carrier,
    trackingNumber: s.trackingNumber,
    receivedBy: s.receivedBy,
    cancelReason: s.cancelReason,
    pickedAt: s.pickedAt ? s.pickedAt.toISOString() : null,
    pickedBy: userRef(s.pickedBy),
    packedAt: s.packedAt ? s.packedAt.toISOString() : null,
    packedBy: userRef(s.packedBy),
    dispatchedAt: s.dispatchedAt ? s.dispatchedAt.toISOString() : null,
    dispatchedBy: userRef(s.dispatchedBy),
    deliveredAt: s.deliveredAt ? s.deliveredAt.toISOString() : null,
    tracking: [...s.tracking]
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map((t) => ({
        type: t.type as ShipmentDto['tracking'][number]['type'],
        at: t.at.toISOString(),
        location: t.location,
        note: t.note,
        by: userRef(t.by)!,
      })),
    history: historyDto(s.history),
    createdBy: userRef(s.createdBy)!,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export async function getShipment(id: string): Promise<ShipmentDto> {
  const shipment = await Shipment.findById(id).lean<ShipmentRecord>();
  if (!shipment) throw notFound('Shipment');
  const [warehouses, keys] = await Promise.all([
    warehouseLookup([shipment.warehouseId]),
    loadCustomerKeys([shipment.customer._id]),
  ]);
  return toShipmentDto(shipment, warehouses, keys);
}

async function loadShipment(
  id: string,
  allowed: readonly ShipmentStatus[],
  action: string,
  session: ClientSession,
) {
  const shipment = await Shipment.findById(id).session(session);
  if (!shipment) throw notFound('Shipment');
  const status = shipment.status as ShipmentStatus;
  if (!allowed.includes(status)) {
    throw invalidState(
      `${shipment.number} is ${SHIPMENT_STATUS_LABELS[status].toLowerCase()} and can’t be ${action}`,
    );
  }
  return shipment;
}

async function loadOrder(id: Types.ObjectId, session: ClientSession) {
  const order = await SalesOrder.findById(id).session(session);
  if (!order) throw new Error(`Sales order ${id.toString()} is missing`);
  return order;
}

/**
 * Creates a pick list for part or all of an order's unallocated quantity. Allocated units
 * stay reserved; nothing physical changes until dispatch.
 */
export async function createShipment(input: CreateInput, actor: Actor): Promise<string> {
  return inTransaction(async (session) => {
    const order = await SalesOrder.findById(input.salesOrderId).session(session);
    if (!order) throw validation('salesOrderId', 'Sales order not found');
    const status = order.status as SalesOrderStatus;
    if (!isOpenOrder(status)) {
      throw invalidState(
        `Only confirmed orders can be shipped. ${order.number} is ${SALES_ORDER_STATUS_LABELS[status].toLowerCase()}.`,
      );
    }
    await requireActiveWarehouse(order.warehouseId.toString(), session);

    const issues: { path: string; message: string }[] = [];
    const lines = [];
    for (const [index, line] of input.lines.entries()) {
      const soLine = order.lines.id(line.soLineId);
      if (!soLine) {
        issues.push({ path: `lines.${index}.soLineId`, message: 'This line isn’t on the order' });
        continue;
      }
      if (line.quantity === 0) continue;
      const open = unallocatedFor(soLine);
      if (line.quantity > open) {
        issues.push({
          path: `lines.${index}.quantity`,
          message:
            open === 0
              ? `${soLine.sku} has nothing left to ship`
              : `Only ${open} ${soLine.unit} of ${soLine.sku} left to ship`,
        });
        continue;
      }
      soLine.allocatedQuantity += line.quantity;
      lines.push({
        soLineId: soLine._id,
        productId: soLine.productId,
        sku: soLine.sku,
        name: soLine.name,
        unit: soLine.unit,
        quantity: line.quantity,
      });
    }
    if (issues.length > 0) throw new AppError(400, 'VALIDATION_ERROR', issues[0]!.message, issues);

    const shipmentId = new Types.ObjectId();
    const number = await nextDocumentNumber('SHP', session);
    const total = lines.reduce((s, l) => s + l.quantity, 0);
    order.shipmentCount += 1;
    order.history.push(
      historyEntry(actor, 'shipment_created', `${number}: ${units(total)} to pick`),
    );
    await order.save({ session });

    await Shipment.create(
      [
        {
          _id: shipmentId,
          number,
          status: 'picking',
          salesOrder: { _id: order._id, number: order.number },
          customer: order.customer,
          warehouseId: order.warehouseId,
          // Still encrypted with the customer's key; copied as-is.
          shippingAddress: order.shippingAddress,
          lines,
          notes: input.notes,
          createdBy: snapshot(actor),
          history: [historyEntry(actor, 'created', `Pick list for ${units(total)}`)],
        },
      ],
      { session },
    );
    return shipmentId.toString();
  });
}

/**
 * Records what was actually picked. Units that couldn't be picked go back to the order as
 * unallocated (still reserved), so they can go on a later shipment or be cancelled.
 */
export async function confirmPick(id: string, input: PickInput, actor: Actor) {
  await inTransaction(async (session) => {
    const shipment = await loadShipment(id, ['picking'], 'picked', session);
    const byId = new Map(input.lines.map((l, index) => [l.lineId, { ...l, index }]));
    const issues: { path: string; message: string }[] = [];
    input.lines.forEach((l, index) => {
      if (!shipment.lines.id(l.lineId)) {
        issues.push({ path: `lines.${index}.lineId`, message: 'This line isn’t on the shipment' });
      }
    });
    for (const line of shipment.lines) {
      const entry = byId.get(line._id.toString());
      if (!entry) {
        issues.push({ path: 'lines', message: `Enter the picked quantity for ${line.sku}` });
      } else if (entry.pickedQuantity > line.quantity) {
        issues.push({
          path: `lines.${entry.index}.pickedQuantity`,
          message: `Only ${line.quantity} ${line.unit} are on the pick list`,
        });
      }
    }
    if (issues.length > 0) throw new AppError(400, 'VALIDATION_ERROR', issues[0]!.message, issues);

    const picked = shipment.lines.reduce(
      (s, l) => s + byId.get(l._id.toString())!.pickedQuantity,
      0,
    );
    const requested = shipment.lines.reduce((s, l) => s + l.quantity, 0);
    if (picked === 0) {
      throw validation('lines', 'Nothing was picked. Cancel the shipment instead.');
    }
    const short = requested - picked;
    if (short > 0 && input.shortPickReason === '') {
      throw validation('shortPickReason', 'Say why the full quantity couldn’t be picked');
    }

    const order = await loadOrder(shipment.salesOrder._id!, session);
    for (const line of shipment.lines) {
      line.pickedQuantity = byId.get(line._id.toString())!.pickedQuantity;
      const missing = line.quantity - line.pickedQuantity;
      if (missing > 0) order.lines.id(line.soLineId)!.allocatedQuantity -= missing;
    }
    shipment.status = 'picked';
    shipment.pickedAt = new Date();
    shipment.pickedBy = snapshot(actor);
    shipment.shortPickReason = short > 0 ? input.shortPickReason : '';
    const note =
      short > 0
        ? `${units(picked)} picked, ${short} short: ${input.shortPickReason}`
        : `${units(picked)} picked`;
    shipment.history.push(historyEntry(actor, 'picked', note));
    order.history.push(historyEntry(actor, 'shipment_picked', `${shipment.number}: ${note}`));
    await shipment.save({ session });
    await order.save({ session });
    if (short > 0) {
      await notify(
        { userIds: [order.createdBy._id], exclude: actor.id },
        {
          type: 'shipment',
          title: `${shipment.number} short-picked`,
          body: `${order.number}: ${note}`,
          link: `/shipments/${shipment._id.toString()}`,
        },
        session,
      );
    }
  });
}

export async function pack(id: string, input: PackInput, actor: Actor) {
  await inTransaction(async (session) => {
    const shipment = await loadShipment(id, ['picked'], 'packed', session);
    const order = await loadOrder(shipment.salesOrder._id!, session);
    shipment.status = 'packed';
    shipment.packageCount = input.packageCount;
    shipment.weightGrams = input.weightGrams;
    shipment.packedAt = new Date();
    shipment.packedBy = snapshot(actor);
    const note = `${input.packageCount} package${input.packageCount === 1 ? '' : 's'}${
      input.notes ? `. ${input.notes}` : ''
    }`;
    shipment.history.push(historyEntry(actor, 'packed', note));
    order.history.push(historyEntry(actor, 'shipment_packed', `${shipment.number}: ${note}`));
    await shipment.save({ session });
    await order.save({ session });
  });
}

/**
 * Goods leave the warehouse: each picked line is issued from the order's reservation as a
 * SHIPMENT movement at the current average cost, lowering on-hand and reserved together.
 */
export async function dispatch(id: string, input: DispatchInput, actor: Actor) {
  await inTransaction(async (session) => {
    const shipment = await loadShipment(id, ['packed'], 'dispatched', session);
    const order = await loadOrder(shipment.salesOrder._id!, session);
    const createdBy = new Types.ObjectId(actor.id);
    const products = await Product.find(
      { _id: { $in: shipment.lines.map((l) => l.productId) } },
      { avgCost: 1 },
    )
      .session(session)
      .lean();
    const costFor = new Map(products.map((p) => [p._id.toString(), p.avgCost]));

    let shipped = 0;
    for (const line of shipment.lines) {
      const quantity = line.pickedQuantity ?? 0;
      line.unitCost = costFor.get(line.productId.toString()) ?? 0;
      if (quantity === 0) continue;
      await applyMovement(
        {
          productId: line.productId,
          warehouseId: shipment.warehouseId,
          type: 'SHIPMENT',
          quantity: -quantity,
          unitCost: line.unitCost,
          reference: { type: 'shipment', id: shipment._id, number: shipment.number },
          createdBy,
          fromReserved: true,
        },
        session,
      );
      const soLine = order.lines.id(line.soLineId)!;
      soLine.allocatedQuantity -= quantity;
      soLine.shippedQuantity += quantity;
      shipped += quantity;
    }

    const now = new Date();
    shipment.status = 'dispatched';
    shipment.carrier = input.carrier;
    shipment.trackingNumber = input.trackingNumber;
    shipment.dispatchedAt = now;
    shipment.dispatchedBy = snapshot(actor);
    shipment.tracking.push({
      type: 'dispatched',
      at: now,
      location: '',
      note: input.trackingNumber ? `${input.carrier} ${input.trackingNumber}` : input.carrier,
      by: snapshot(actor),
    });
    const note = `${shipment.number}: ${units(shipped)} via ${input.carrier}${
      input.trackingNumber ? ` (${input.trackingNumber})` : ''
    }`;
    shipment.history.push(historyEntry(actor, 'dispatched', note));
    order.status = fulfilmentStatus(order.lines);
    order.history.push(historyEntry(actor, 'shipment_dispatched', note));
    await shipment.save({ session });
    await order.save({ session });
    await notify(
      { userIds: [order.createdBy._id], exclude: actor.id },
      {
        type: 'shipment',
        title: `${order.number} dispatched`,
        body: `${order.customer.name}: ${note}`,
        link: `/shipments/${shipment._id.toString()}`,
      },
      session,
    );
  });
}

const CLOCK_SKEW_MS = 5 * 60 * 1000;

export async function addTrackingEvent(id: string, input: TrackingInput, actor: Actor) {
  await inTransaction(async (session) => {
    const shipment = await loadShipment(id, ['dispatched', 'in_transit'], 'updated', session);
    const at = input.at ? new Date(input.at) : new Date();
    if (at.getTime() > Date.now() + CLOCK_SKEW_MS) {
      throw validation('at', 'The time can’t be in the future');
    }
    // Times are entered to the minute, so compare against the minute of dispatch.
    const dispatchMinute = shipment.dispatchedAt
      ? Math.floor(shipment.dispatchedAt.getTime() / 60_000) * 60_000
      : null;
    if (dispatchMinute !== null && at.getTime() < dispatchMinute) {
      throw validation('at', 'The time can’t be before the shipment was dispatched');
    }
    if (input.type === 'delivered' && input.receivedBy === '') {
      throw validation('receivedBy', 'Enter who received the delivery');
    }

    shipment.tracking.push({
      type: input.type,
      at,
      location: input.location,
      note: input.note,
      by: snapshot(actor),
    });
    const label = TRACKING_EVENT_LABELS[input.type];
    const detail = [input.location, input.note].filter(Boolean).join(': ');

    if (input.type !== 'delivered') {
      shipment.status = 'in_transit';
      shipment.history.push(
        historyEntry(actor, 'tracking', detail ? `${label}. ${detail}` : label),
      );
      await shipment.save({ session });
      return;
    }

    const order = await loadOrder(shipment.salesOrder._id!, session);
    for (const line of shipment.lines) {
      order.lines.id(line.soLineId)!.deliveredQuantity += line.pickedQuantity ?? 0;
    }
    shipment.status = 'delivered';
    shipment.deliveredAt = at;
    shipment.receivedBy = input.receivedBy;
    const note = `Received by ${input.receivedBy}${detail ? `. ${detail}` : ''}`;
    shipment.history.push(historyEntry(actor, 'delivered', note));
    order.status = fulfilmentStatus(order.lines);
    order.history.push(historyEntry(actor, 'shipment_delivered', `${shipment.number}: ${note}`));
    await shipment.save({ session });
    await order.save({ session });
    await notify(
      { userIds: [order.createdBy._id], exclude: actor.id },
      {
        type: 'shipment',
        title: `${order.number} delivered`,
        body: `${shipment.number} to ${order.customer.name}. ${note}`,
        link: `/shipments/${shipment._id.toString()}`,
      },
      session,
    );
  });
}

/** Cancels a shipment that hasn't left. Its units return to the order, still reserved. */
export async function cancelShipment(id: string, reason: string, actor: Actor) {
  await inTransaction(async (session) => {
    const shipment = await loadShipment(id, PRE_DISPATCH_SHIPMENT_STATUSES, 'cancelled', session);
    const order = await loadOrder(shipment.salesOrder._id!, session);
    let returned = 0;
    for (const line of shipment.lines) {
      const held = line.pickedQuantity ?? line.quantity;
      order.lines.id(line.soLineId)!.allocatedQuantity -= held;
      returned += held;
    }
    shipment.status = 'cancelled';
    shipment.cancelReason = reason;
    shipment.history.push(historyEntry(actor, 'cancelled', reason));
    order.history.push(
      historyEntry(
        actor,
        'shipment_cancelled',
        `${shipment.number}: ${reason} (${units(returned)} back to the order)`,
      ),
    );
    await shipment.save({ session });
    await order.save({ session });
  });
}

async function listShipments(query: ListShipmentsQuery) {
  const filter: FilterQuery<ShipmentRecord> = {};
  if (query.status) filter.status = query.status;
  if (query.pending) filter.status = { $in: [...PRE_DISPATCH_SHIPMENT_STATUSES] };
  if (query.inTransit) filter.status = { $in: ['dispatched', 'in_transit'] };
  if (query.salesOrderId) filter['salesOrder._id'] = new Types.ObjectId(query.salesOrderId);
  if (query.customerId) filter['customer._id'] = new Types.ObjectId(query.customerId);
  if (query.warehouseId) filter.warehouseId = new Types.ObjectId(query.warehouseId);
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [
      { number: pattern },
      { 'salesOrder.number': pattern },
      { 'customer.name': pattern },
      { trackingNumber: pattern },
    ];
  }
  if (query.from || query.to) {
    filter.createdAt = {
      ...(query.from ? { $gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
      ...(query.to ? { $lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
    };
  }
  const [rows, total] = await Promise.all([
    Shipment.find(filter)
      .sort({ ...parseSort(query.sort), _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<ShipmentRecord[]>(),
    Shipment.countDocuments(filter),
  ]);
  const [warehouses, keys] = await Promise.all([
    warehouseLookup(rows.map((r) => r.warehouseId)),
    loadCustomerKeys(rows.map((r) => r.customer._id)),
  ]);
  return {
    data: rows.map((s) => toShipmentDto(s, warehouses, keys)),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

export function createShipmentsRouter(): Router {
  const router = Router();
  router.use(authenticate());

  router.get('/', async (req, res) => {
    res.json(await listShipments(listShipmentsQuerySchema.parse(req.query)));
  });

  router.get('/:id', async (req, res) => {
    res.json({ data: await getShipment(parseId(req.params.id, 'Shipment')) });
  });

  router.post('/', authorize('shipments:create'), async (req, res) => {
    const id = await createShipment(createShipmentSchema.parse(req.body), requireAuth(req).user);
    res.status(201).json({ data: await getShipment(id) });
  });

  const step = <T>(
    path: string,
    parse: (body: unknown) => T,
    run: (id: string, input: T, actor: Actor) => Promise<void>,
  ) =>
    router.post(`/:id/${path}`, authorize('shipments:create'), async (req, res) => {
      const id = parseId(req.params.id, 'Shipment');
      await run(id, parse(req.body), requireAuth(req).user);
      res.json({ data: await getShipment(id) });
    });

  step('pick', (b) => confirmPickSchema.parse(b), confirmPick);
  step('pack', (b) => packShipmentSchema.parse(b), pack);
  step('dispatch', (b) => dispatchShipmentSchema.parse(b), dispatch);
  step('tracking', (b) => trackingEventSchema.parse(b), addTrackingEvent);
  step('cancel', (b) => reasonBodySchema.parse(b).reason, cancelShipment);

  return router;
}
