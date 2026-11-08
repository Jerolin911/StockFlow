import { Router } from 'express';
import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import {
  OPEN_SALES_ORDER_STATUSES,
  PRE_DISPATCH_SHIPMENT_STATUSES,
  listSalesOrdersQuerySchema,
  reasonBodySchema,
  salesDocumentTotals,
  salesLineAmounts,
  salesOrderSchema,
  type FulfilmentSummaryDto,
  type ListSalesOrdersQuery,
  type SalesOrderDto,
  type SalesOrderStatus,
} from '@stockflow/shared';
import type { z } from 'zod';
import { nextDocumentNumber } from '../../lib/counters.js';
import { AppError, invalidState, notFound } from '../../lib/errors.js';
import { escapeRegex, parseId, parseSort } from '../../lib/http.js';
import { inTransaction } from '../../lib/transaction.js';
import { notify } from '../notifications/notifications.js';
import { authenticate, authorize, requireAuth } from '../../middleware/auth.js';
import {
  InsufficientStockError,
  releaseReservation,
  reserveStock,
} from '../stock/stock.service.js';
import {
  dateFromIso,
  historyDto,
  historyEntry,
  isoDate,
  loadActiveProducts,
  requireActiveCustomer,
  requireActiveWarehouse,
  snapshot,
  todayIso,
  userRef,
  warehouseLookup,
  warehouseRef,
  type Actor,
  type WarehouseLookup,
} from '../common/documents.js';
import { SalesOrder, Shipment, type SalesOrderRecord } from './models.js';

type OrderInput = z.output<typeof salesOrderSchema>;

interface LineQuantities {
  quantity: number;
  allocatedQuantity: number;
  shippedQuantity: number;
  deliveredQuantity: number;
  cancelledQuantity: number;
}

export const isOpenOrder = (status: string) =>
  (OPEN_SALES_ORDER_STATUSES as readonly string[]).includes(status);

/** Units still held against stock for a line of an open order. */
export const reservedFor = (l: LineQuantities) =>
  l.quantity - l.shippedQuantity - l.cancelledQuantity;

/** Units not yet on any shipment. */
export const unallocatedFor = (l: LineQuantities) =>
  l.quantity - l.allocatedQuantity - l.shippedQuantity - l.cancelledQuantity;

/** Status of a confirmed order, from what has shipped, been delivered or been cancelled. */
export function fulfilmentStatus(lines: LineQuantities[]): SalesOrderStatus {
  const sum = (pick: (l: LineQuantities) => number) => lines.reduce((s, l) => s + pick(l), 0);
  const toShip = sum((l) => l.quantity - l.cancelledQuantity);
  const shipped = sum((l) => l.shippedQuantity);
  if (toShip === 0) return 'cancelled';
  if (shipped === 0) return 'confirmed';
  if (shipped < toShip) return 'partially_shipped';
  return sum((l) => l.deliveredQuantity) >= toShip ? 'delivered' : 'shipped';
}

export function toSalesOrderDto(so: SalesOrderRecord, warehouses: WarehouseLookup): SalesOrderDto {
  const status = so.status as SalesOrderStatus;
  const open = isOpenOrder(status);
  const required = isoDate(so.requiredDate);
  return {
    id: so._id.toString(),
    number: so.number,
    status,
    customer: {
      id: so.customer._id.toString(),
      code: so.customer.code ?? '',
      name: so.customer.name ?? '',
    },
    warehouse: warehouseRef(warehouses, so.warehouseId),
    orderDate: so.orderDate.toISOString(),
    requiredDate: required,
    shippingAddress: so.shippingAddress,
    customerReference: so.customerReference,
    notes: so.notes,
    lines: so.lines.map((l) => ({
      id: l._id.toString(),
      productId: l.productId.toString(),
      sku: l.sku,
      name: l.name,
      unit: l.unit,
      quantity: l.quantity,
      allocatedQuantity: l.allocatedQuantity,
      shippedQuantity: l.shippedQuantity,
      deliveredQuantity: l.deliveredQuantity,
      cancelledQuantity: l.cancelledQuantity,
      returnedQuantity: l.returnedQuantity ?? 0,
      reservedQuantity: open ? reservedFor(l) : 0,
      unallocatedQuantity: open ? unallocatedFor(l) : 0,
      unitPrice: l.unitPrice,
      discountRate: l.discountRate,
      taxRate: l.taxRate,
      lineGross: l.lineGross,
      lineDiscount: l.lineDiscount,
      lineSubtotal: l.lineSubtotal,
      lineTax: l.lineTax,
      lineTotal: l.lineTotal,
    })),
    grossTotal: so.grossTotal,
    discountTotal: so.discountTotal,
    subtotal: so.subtotal,
    taxTotal: so.taxTotal,
    total: so.total,
    createdBy: userRef(so.createdBy)!,
    confirmedBy: userRef(so.confirmedBy),
    confirmedAt: so.confirmedAt ? so.confirmedAt.toISOString() : null,
    cancelReason: so.cancelReason,
    shipmentCount: so.shipmentCount,
    isOverdue: open && required !== null && required < todayIso(),
    history: historyDto(so.history),
    createdAt: so.createdAt.toISOString(),
    updatedAt: so.updatedAt.toISOString(),
  };
}

export async function getSalesOrder(id: string): Promise<SalesOrderDto> {
  const so = await SalesOrder.findById(id).lean<SalesOrderRecord>();
  if (!so) throw notFound('Sales order');
  return toSalesOrderDto(so, await warehouseLookup([so.warehouseId]));
}

/** Prices lines from the product's selling price unless a price is given. */
async function buildSalesLines(lines: OrderInput['lines'], session?: ClientSession) {
  const productFor = await loadActiveProducts(
    lines.map((l) => l.productId),
    session,
  );
  const built = lines.map((line) => {
    const product = productFor(line.productId);
    const unitPrice = line.unitPrice ?? product.sellingPrice;
    return {
      _id: new Types.ObjectId(),
      productId: product._id,
      sku: product.sku,
      name: product.name,
      unit: product.unit,
      quantity: line.quantity,
      allocatedQuantity: 0,
      shippedQuantity: 0,
      deliveredQuantity: 0,
      cancelledQuantity: 0,
      returnedQuantity: 0,
      unitPrice,
      discountRate: line.discountRate,
      taxRate: product.taxRate,
      ...salesLineAmounts(line.quantity, unitPrice, line.discountRate, product.taxRate),
    };
  });
  return { lines: built, ...salesDocumentTotals(built) };
}

async function orderFields(input: OrderInput, session?: ClientSession) {
  const customer = await requireActiveCustomer(input.customerId, session);
  await requireActiveWarehouse(input.warehouseId, session);
  const priced = await buildSalesLines(input.lines, session);
  return {
    customer: { _id: customer._id, code: customer.code, name: customer.name },
    warehouseId: new Types.ObjectId(input.warehouseId),
    requiredDate: input.requiredDate ? dateFromIso(input.requiredDate) : null,
    shippingAddress: input.shippingAddress ?? (customer.shippingAddress || customer.address || ''),
    customerReference: input.customerReference,
    notes: input.notes,
    ...priced,
  };
}

export async function createSalesOrder(
  input: OrderInput,
  actor: Actor,
  session?: ClientSession,
): Promise<string> {
  const fields = await orderFields(input, session);
  const [so] = await SalesOrder.create(
    [
      {
        number: await nextDocumentNumber('SO', session),
        status: 'draft',
        orderDate: new Date(),
        ...fields,
        createdBy: snapshot(actor),
        history: [historyEntry(actor, 'created')],
      },
    ],
    session ? { session } : {},
  );
  return so!._id.toString();
}

async function throwStateError(id: string, message: string): Promise<never> {
  if (!(await SalesOrder.exists({ _id: id }))) throw notFound('Sales order');
  throw invalidState(message);
}

async function updateDraft(id: string, input: OrderInput, actor: Actor) {
  const fields = await orderFields(input);
  const updated = await SalesOrder.findOneAndUpdate(
    { _id: id, status: 'draft' },
    { $set: fields, $push: { history: historyEntry(actor, 'updated') } },
  );
  if (!updated) await throwStateError(id, 'Only draft sales orders can be edited');
}

const units = (n: number) => `${n} unit${n === 1 ? '' : 's'}`;

/**
 * Confirms a draft and reserves every line in the order's warehouse, all or nothing.
 * Each reservation is a conditional update on the stock level, so two orders confirmed at
 * the same moment can't both take the last units: one sees the other's reservation (or
 * conflicts and is retried by the transaction) and fails with INSUFFICIENT_STOCK.
 */
export async function confirmSalesOrder(id: string, actor: Actor): Promise<void> {
  await inTransaction(async (session) => {
    const so = await SalesOrder.findOne({ _id: id, status: 'draft' }).session(session);
    if (!so) await throwStateError(id, 'Only draft sales orders can be confirmed');
    const order = so!;

    await requireActiveCustomer(order.customer._id.toString(), session);
    const warehouse = await requireActiveWarehouse(order.warehouseId.toString(), session);
    await loadActiveProducts(
      order.lines.map((l) => l.productId.toString()),
      session,
    );

    const shortages: { path: string; message: string }[] = [];
    for (const [index, line] of order.lines.entries()) {
      try {
        await reserveStock(line.productId, order.warehouseId, line.quantity, session);
      } catch (error) {
        if (!(error instanceof InsufficientStockError)) throw error;
        shortages.push({
          path: `lines.${index}.quantity`,
          message: `Only ${Math.max(error.available, 0)} ${line.unit} of ${line.sku} available in ${warehouse.code}`,
        });
      }
    }
    if (shortages.length > 0) {
      throw new AppError(
        409,
        'INSUFFICIENT_STOCK',
        shortages.length === 1
          ? shortages[0]!.message
          : `${shortages.length} lines don’t have enough available stock`,
        shortages,
      );
    }

    const reserved = order.lines.reduce((s, l) => s + l.quantity, 0);
    order.status = 'confirmed';
    order.confirmedBy = snapshot(actor);
    order.confirmedAt = new Date();
    order.history.push(
      historyEntry(actor, 'confirmed', `Reserved ${units(reserved)} in ${warehouse.code}`),
    );
    await order.save({ session });
    await notify(
      { permissions: ['shipments:create'], exclude: actor.id },
      {
        type: 'sales_order',
        title: `${order.number} ready to pick`,
        body: `${order.customer.name}: ${units(reserved)} reserved in ${warehouse.code}`,
        link: `/sales-orders/${order._id.toString()}`,
      },
      session,
    );
  });
}

/**
 * Cancels whatever hasn't shipped. Open pick lists are cancelled and every unshipped unit's
 * reservation is released. With nothing shipped the order becomes cancelled; otherwise it
 * keeps its shipments and its status follows what was shipped.
 */
export async function cancelSalesOrder(id: string, reason: string, actor: Actor): Promise<void> {
  await inTransaction(async (session) => {
    const so = await SalesOrder.findOne({
      _id: id,
      status: { $in: ['draft', ...OPEN_SALES_ORDER_STATUSES] },
    }).session(session);
    if (!so) await throwStateError(id, 'This sales order can no longer be cancelled');
    const order = so!;

    if (order.status === 'draft') {
      for (const line of order.lines) line.cancelledQuantity = line.quantity;
      order.status = 'cancelled';
      order.cancelReason = reason;
      order.history.push(historyEntry(actor, 'cancelled', reason));
      await order.save({ session });
      return;
    }

    const openShipments = await Shipment.find({
      'salesOrder._id': order._id,
      status: { $in: [...PRE_DISPATCH_SHIPMENT_STATUSES] },
    }).session(session);
    for (const shipment of openShipments) {
      shipment.status = 'cancelled';
      shipment.cancelReason = `Order cancelled: ${reason}`;
      shipment.history.push(historyEntry(actor, 'cancelled', shipment.cancelReason));
      await shipment.save({ session });
    }

    let released = 0;
    for (const line of order.lines) {
      const remaining = reservedFor(line);
      await releaseReservation(line.productId, order.warehouseId, remaining, session);
      line.cancelledQuantity += remaining;
      line.allocatedQuantity = 0;
      released += remaining;
    }

    const nothingShipped = order.lines.every((l) => l.shippedQuantity === 0);
    order.status = fulfilmentStatus(order.lines);
    order.cancelReason = reason;
    const shipmentNote =
      openShipments.length > 0
        ? `; cancelled ${openShipments.map((s) => s.number).join(', ')}`
        : '';
    order.history.push(
      historyEntry(
        actor,
        nothingShipped ? 'cancelled' : 'remainder_cancelled',
        `${reason} (released ${units(released)}${shipmentNote})`,
      ),
    );
    await order.save({ session });
    if (openShipments.length > 0) {
      await notify(
        { permissions: ['shipments:create'], exclude: actor.id },
        {
          type: 'shipment',
          title: `Stop picking ${openShipments.map((s) => s.number).join(', ')}`,
          body: `${order.number} was cancelled: ${reason}`,
          link: `/sales-orders/${order._id.toString()}`,
        },
        session,
      );
    }
  });
}

const OPEN = { $in: [...OPEN_SALES_ORDER_STATUSES] };

/** Matches open orders with at least one unit not yet on a shipment. */
export const hasUnallocated = {
  $anyElementTrue: [
    {
      $map: {
        input: '$lines',
        as: 'l',
        in: {
          $gt: [
            {
              $subtract: [
                '$$l.quantity',
                {
                  $add: ['$$l.allocatedQuantity', '$$l.shippedQuantity', '$$l.cancelledQuantity'],
                },
              ],
            },
            0,
          ],
        },
      },
    },
  ],
};

export async function listSalesOrders(query: ListSalesOrdersQuery) {
  const filter: FilterQuery<SalesOrderRecord> = {};
  if (query.status) filter.status = query.status;
  if (query.open || query.toFulfil) filter.status = OPEN;
  if (query.toFulfil) filter.$expr = hasUnallocated;
  if (query.returnable) {
    filter.$expr = {
      $anyElementTrue: [
        {
          $map: {
            input: '$lines',
            as: 'l',
            in: { $gt: ['$$l.shippedQuantity', { $ifNull: ['$$l.returnedQuantity', 0] }] },
          },
        },
      ],
    };
  }
  if (query.customerId) filter['customer._id'] = new Types.ObjectId(query.customerId);
  if (query.warehouseId) filter.warehouseId = new Types.ObjectId(query.warehouseId);
  if (query.productId) filter['lines.productId'] = new Types.ObjectId(query.productId);
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [
      { number: pattern },
      { 'customer.name': pattern },
      { 'customer.code': pattern },
      { customerReference: pattern },
    ];
  }

  const [rows, total] = await Promise.all([
    SalesOrder.find(filter)
      .sort({ ...parseSort(query.sort), _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<SalesOrderRecord[]>(),
    SalesOrder.countDocuments(filter),
  ]);
  const warehouses = await warehouseLookup(rows.map((r) => r.warehouseId));
  return {
    data: rows.map((so) => toSalesOrderDto(so, warehouses)),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

async function fulfilmentSummary(): Promise<FulfilmentSummaryDto> {
  const [ordersToConfirm, ordersToFulfil, byStatus] = await Promise.all([
    SalesOrder.countDocuments({ status: 'draft' }),
    SalesOrder.countDocuments({ status: OPEN, $expr: hasUnallocated }),
    Shipment.aggregate<{ _id: string; count: number }>([
      { $match: { status: { $in: ['picking', 'picked', 'packed', 'dispatched', 'in_transit'] } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);
  const count = (status: string) => byStatus.find((s) => s._id === status)?.count ?? 0;
  return {
    ordersToConfirm,
    ordersToFulfil,
    shipmentsToPick: count('picking'),
    shipmentsToPack: count('picked'),
    shipmentsToDispatch: count('packed'),
    shipmentsInTransit: count('dispatched') + count('in_transit'),
  };
}

export function createSalesOrdersRouter(): Router {
  const router = Router();
  router.use(authenticate());

  router.get('/', async (req, res) => {
    res.json(await listSalesOrders(listSalesOrdersQuerySchema.parse(req.query)));
  });

  router.get('/fulfilment-summary', async (_req, res) => {
    res.json({ data: await fulfilmentSummary() });
  });

  router.get('/:id', async (req, res) => {
    res.json({ data: await getSalesOrder(parseId(req.params.id, 'Sales order')) });
  });

  router.post('/', authorize('salesOrders:write'), async (req, res) => {
    const id = await createSalesOrder(salesOrderSchema.parse(req.body), requireAuth(req).user);
    res.status(201).json({ data: await getSalesOrder(id) });
  });

  router.patch('/:id', authorize('salesOrders:write'), async (req, res) => {
    const id = parseId(req.params.id, 'Sales order');
    await updateDraft(id, salesOrderSchema.parse(req.body), requireAuth(req).user);
    res.json({ data: await getSalesOrder(id) });
  });

  router.delete('/:id', authorize('salesOrders:write'), async (req, res) => {
    const id = parseId(req.params.id, 'Sales order');
    const deleted = await SalesOrder.findOneAndDelete({ _id: id, status: 'draft' });
    if (!deleted) await throwStateError(id, 'Only draft sales orders can be deleted');
    res.status(204).end();
  });

  router.post('/:id/confirm', authorize('salesOrders:write'), async (req, res) => {
    const id = parseId(req.params.id, 'Sales order');
    await confirmSalesOrder(id, requireAuth(req).user);
    res.json({ data: await getSalesOrder(id) });
  });

  router.post('/:id/cancel', authorize('salesOrders:write'), async (req, res) => {
    const id = parseId(req.params.id, 'Sales order');
    const { reason } = reasonBodySchema.parse(req.body);
    await cancelSalesOrder(id, reason, requireAuth(req).user);
    res.json({ data: await getSalesOrder(id) });
  });

  return router;
}
