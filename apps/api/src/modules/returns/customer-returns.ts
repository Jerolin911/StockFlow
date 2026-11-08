import { Router } from 'express';
import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import {
  CUSTOMER_RETURN_STATUS_LABELS,
  RETURN_REASON_LABELS,
  customerReturnSchema,
  inspectCustomerReturnSchema,
  listCustomerReturnsQuerySchema,
  reasonBodySchema,
  receiveCustomerReturnSchema,
  type CustomerReturnDto,
  type CustomerReturnStatus,
  type ListCustomerReturnsQuery,
  type ReturnReason,
} from '@stockflow/shared';
import type { z } from 'zod';
import { nextDocumentNumber } from '../../lib/counters.js';
import { AppError, invalidState, notFound } from '../../lib/errors.js';
import { escapeRegex, parseId, parseSort } from '../../lib/http.js';
import { inTransaction } from '../../lib/transaction.js';
import { notify } from '../notifications/notifications.js';
import { authenticate, authorize, requireAuth } from '../../middleware/auth.js';
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
import { Product } from '../products/product.model.js';
import { SalesOrder, Shipment } from '../sales/models.js';
import { moveBetweenBuckets } from '../stock/quarantine.service.js';
import { applyMovement, updateAverageCost } from '../stock/stock.service.js';
import { CustomerReturn, type CustomerReturnRecord } from './models.js';

type CreateInput = z.output<typeof customerReturnSchema>;
type ReceiveInput = z.output<typeof receiveCustomerReturnSchema>;
type InspectInput = z.output<typeof inspectCustomerReturnSchema>;
type Issue = { path: string; message: string };

const units = (n: number) => `${n} unit${n === 1 ? '' : 's'}`;
const ACTIVE: CustomerReturnStatus[] = ['requested', 'approved'];

export function toCustomerReturnDto(
  r: CustomerReturnRecord,
  warehouses: WarehouseLookup,
): CustomerReturnDto {
  const lines = r.lines.map((l) => ({
    id: l._id.toString(),
    soLineId: l.soLineId.toString(),
    productId: l.productId.toString(),
    sku: l.sku,
    name: l.name,
    unit: l.unit,
    quantity: l.quantity,
    receivedQuantity: l.receivedQuantity,
    restockedQuantity: l.restockedQuantity,
    quarantinedQuantity: l.quarantinedQuantity,
    note: l.note,
    unitCost: l.unitCost,
  }));
  const sum = (pick: (l: (typeof lines)[number]) => number) =>
    lines.reduce((s, l) => s + pick(l), 0);
  return {
    id: r._id.toString(),
    number: r.number,
    status: r.status as CustomerReturnStatus,
    salesOrder: { id: r.salesOrder._id!.toString(), number: r.salesOrder.number ?? '' },
    customer: {
      id: r.customer._id.toString(),
      code: r.customer.code ?? '',
      name: r.customer.name ?? '',
    },
    warehouse: warehouseRef(warehouses, r.warehouseId),
    reason: r.reason as ReturnReason,
    notes: r.notes,
    lines,
    totals: {
      requested: sum((l) => l.quantity),
      received: sum((l) => l.receivedQuantity),
      restocked: sum((l) => l.restockedQuantity),
      quarantined: sum((l) => l.quarantinedQuantity),
    },
    requestedBy: userRef(r.requestedBy)!,
    approvedBy: userRef(r.approvedBy),
    receivedAt: r.receivedAt ? r.receivedAt.toISOString() : null,
    receivedBy: userRef(r.receivedBy),
    inspectedAt: r.inspectedAt ? r.inspectedAt.toISOString() : null,
    inspectedBy: userRef(r.inspectedBy),
    rejectionReason: r.rejectionReason,
    cancelReason: r.cancelReason,
    history: historyDto(r.history),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function getCustomerReturn(id: string): Promise<CustomerReturnDto> {
  const r = await CustomerReturn.findById(id).lean<CustomerReturnRecord>();
  if (!r) throw notFound('Customer return');
  return toCustomerReturnDto(r, await warehouseLookup([r.warehouseId]));
}

/** Average cost the line's units shipped at, from its dispatched shipments. */
async function shippedCosts(salesOrderId: Types.ObjectId, session: ClientSession) {
  const shipments = await Shipment.find({
    'salesOrder._id': salesOrderId,
    status: { $in: ['dispatched', 'in_transit', 'delivered'] },
  })
    .session(session)
    .lean();
  const totals = new Map<string, { units: number; cost: number }>();
  for (const s of shipments) {
    for (const l of s.lines) {
      const units = l.pickedQuantity ?? 0;
      const t = totals.get(l.soLineId.toString()) ?? { units: 0, cost: 0 };
      t.units += units;
      t.cost += units * (l.unitCost ?? 0);
      totals.set(l.soLineId.toString(), t);
    }
  }
  return (soLineId: string) => {
    const t = totals.get(soLineId);
    return t && t.units > 0 ? Math.round(t.cost / t.units) : null;
  };
}

/**
 * Raises a return against shipped quantities. Each order line's returnedQuantity counts
 * units on active returns, so the same units can't be returned twice; the order document
 * is written in the same transaction, which makes concurrent requests conflict.
 */
export async function createCustomerReturn(input: CreateInput, actor: Actor): Promise<string> {
  return inTransaction(async (session) => {
    const order = await SalesOrder.findById(input.salesOrderId).session(session);
    if (!order) throw validation('salesOrderId', 'Sales order not found');
    const warehouse = await requireActiveWarehouse(
      input.warehouseId ?? order.warehouseId.toString(),
      session,
    );
    const costFor = await shippedCosts(order._id, session);
    const products = await Product.find(
      { _id: { $in: order.lines.map((l) => l.productId) } },
      { avgCost: 1 },
    )
      .session(session)
      .lean();
    const avgFor = new Map(products.map((p) => [p._id.toString(), p.avgCost]));

    const issues: Issue[] = [];
    const lines = [];
    for (const [index, entry] of input.lines.entries()) {
      const soLine = order.lines.id(entry.soLineId);
      if (!soLine) {
        issues.push({ path: `lines.${index}.soLineId`, message: 'Not on this order' });
        continue;
      }
      if (entry.quantity === 0) continue;
      const returnable = soLine.shippedQuantity - (soLine.returnedQuantity ?? 0);
      if (entry.quantity > returnable) {
        issues.push({
          path: `lines.${index}.quantity`,
          message:
            returnable === 0
              ? `No shipped ${soLine.sku} left to return`
              : `Only ${returnable} ${soLine.unit} of ${soLine.sku} can be returned`,
        });
        continue;
      }
      soLine.returnedQuantity = (soLine.returnedQuantity ?? 0) + entry.quantity;
      lines.push({
        soLineId: soLine._id,
        productId: soLine.productId,
        sku: soLine.sku,
        name: soLine.name,
        unit: soLine.unit,
        quantity: entry.quantity,
        unitCost: costFor(soLine._id.toString()) ?? avgFor.get(soLine.productId.toString()) ?? 0,
      });
    }
    if (issues.length > 0) throw new AppError(400, 'VALIDATION_ERROR', issues[0]!.message, issues);

    const id = new Types.ObjectId();
    const number = await nextDocumentNumber('RMA', session);
    const total = lines.reduce((s, l) => s + l.quantity, 0);
    order.history.push(
      historyEntry(
        actor,
        'return_requested',
        `${number}: ${units(total)}, ${RETURN_REASON_LABELS[input.reason].toLowerCase()}`,
      ),
    );
    await order.save({ session });
    await CustomerReturn.create(
      [
        {
          _id: id,
          number,
          status: 'requested',
          salesOrder: { _id: order._id, number: order.number },
          customer: order.customer,
          warehouseId: warehouse._id,
          reason: input.reason,
          notes: input.notes,
          lines,
          requestedBy: snapshot(actor),
          history: [historyEntry(actor, 'requested', `${units(total)} from ${order.number}`)],
        },
      ],
      { session },
    );
    await notify(
      { permissions: ['customerReturns:write'], exclude: actor.id },
      {
        type: 'return',
        title: `${number} needs approval`,
        body: `${order.customer.name}: ${units(total)} from ${order.number}`,
        link: `/customer-returns/${id.toString()}`,
      },
      session,
    );
    return id.toString();
  });
}

/** Gives a return's units back to its order line counters (reject, cancel, short receipt). */
async function releaseOrderLines(
  ret: {
    salesOrder: { _id?: Types.ObjectId | null };
    lines: { soLineId: Types.ObjectId; quantity: number; receivedQuantity: number }[];
  },
  amount: (l: { quantity: number; receivedQuantity: number }) => number,
  note: ReturnType<typeof historyEntry> | null,
  session: ClientSession,
) {
  const order = await SalesOrder.findById(ret.salesOrder._id).session(session);
  if (!order) return;
  for (const l of ret.lines) {
    const soLine = order.lines.id(l.soLineId);
    if (soLine) soLine.returnedQuantity = (soLine.returnedQuantity ?? 0) - amount(l);
  }
  if (note) order.history.push(note);
  await order.save({ session });
}

async function closeWithoutGoods(
  id: string,
  status: 'rejected' | 'cancelled',
  reason: string,
  actor: Actor,
) {
  await inTransaction(async (session) => {
    const ret = await CustomerReturn.findOne({
      _id: id,
      status: { $in: status === 'rejected' ? ['requested'] : ACTIVE },
    }).session(session);
    if (!ret) {
      if (!(await CustomerReturn.exists({ _id: id }))) throw notFound('Customer return');
      throw invalidState(
        status === 'rejected'
          ? 'Only returns awaiting approval can be rejected'
          : 'Returns can’t be cancelled once goods are received',
      );
    }
    ret.status = status;
    if (status === 'rejected') ret.rejectionReason = reason;
    else ret.cancelReason = reason;
    ret.history.push(historyEntry(actor, status, reason));
    await releaseOrderLines(
      ret,
      (l) => l.quantity,
      historyEntry(actor, `return_${status}`, `${ret.number}: ${reason}`),
      session,
    );
    await ret.save({ session });
    await notify(
      { userIds: [ret.requestedBy._id], exclude: actor.id },
      {
        type: 'return',
        title: `${ret.number} ${status}`,
        body: reason,
        link: `/customer-returns/${id}`,
      },
      session,
    );
  });
}

/**
 * Records what came back. Received units enter the warehouse's quarantine as
 * CUSTOMER_RETURN movements and stay isolated until inspected.
 */
export async function receiveCustomerReturn(id: string, input: ReceiveInput, actor: Actor) {
  await inTransaction(async (session) => {
    const ret = await CustomerReturn.findById(id).session(session);
    if (!ret) throw notFound('Customer return');
    if (ret.status !== 'approved') {
      throw invalidState(
        `Only approved returns can be received. ${ret.number} is ${CUSTOMER_RETURN_STATUS_LABELS[ret.status as CustomerReturnStatus].toLowerCase()}.`,
      );
    }
    const warehouse = await requireActiveWarehouse(ret.warehouseId.toString(), session);
    const byId = new Map(input.lines.map((l, index) => [l.lineId, { ...l, index }]));
    const issues: Issue[] = [];
    input.lines.forEach((l, index) => {
      const line = ret.lines.id(l.lineId);
      if (!line) issues.push({ path: `lines.${index}.lineId`, message: 'Not on this return' });
      else if (l.receivedQuantity > line.quantity) {
        issues.push({
          path: `lines.${index}.receivedQuantity`,
          message: `Only ${line.quantity} ${line.unit} were approved for return`,
        });
      }
    });
    if (issues.length > 0) throw new AppError(400, 'VALIDATION_ERROR', issues[0]!.message, issues);

    const createdBy = new Types.ObjectId(actor.id);
    let received = 0;
    for (const line of ret.lines) {
      const quantity = byId.get(line._id.toString())?.receivedQuantity ?? 0;
      line.receivedQuantity = quantity;
      if (quantity === 0) continue;
      await applyMovement(
        {
          productId: line.productId,
          warehouseId: ret.warehouseId,
          type: 'CUSTOMER_RETURN',
          quantity,
          bucket: 'quarantine',
          unitCost: line.unitCost,
          reference: { type: 'customerReturn', id: ret._id, number: ret.number },
          createdBy,
        },
        session,
      );
      received += quantity;
    }
    const short = ret.lines.reduce((s, l) => s + l.quantity - l.receivedQuantity, 0);
    ret.status = 'received';
    ret.receivedAt = new Date();
    ret.receivedBy = snapshot(actor);
    const note = `${units(received)} into ${warehouse.code} quarantine${short > 0 ? `; ${short} not sent back` : ''}${input.note ? `. ${input.note}` : ''}`;
    ret.history.push(historyEntry(actor, 'received', note));
    await notify(
      { userIds: [ret.requestedBy._id], exclude: actor.id },
      {
        type: 'return',
        title: `${ret.number} received`,
        body: note,
        link: `/customer-returns/${id}`,
      },
      session,
    );
    await releaseOrderLines(
      ret,
      (l) => l.quantity - l.receivedQuantity,
      historyEntry(actor, 'return_received', `${ret.number}: ${note}`),
      session,
    );
    await ret.save({ session });
  });
}

/**
 * Decides each received unit: restocked units move from quarantine to usable stock (RELEASE
 * movements, entering the average cost at their shipped cost); the rest stay quarantined.
 */
async function inspectReturn(id: string, input: InspectInput, actor: Actor) {
  await inTransaction(async (session) => {
    const ret = await CustomerReturn.findById(id).session(session);
    if (!ret) throw notFound('Customer return');
    if (ret.status !== 'received') throw invalidState('Only received returns can be inspected');
    const warehouse = await requireActiveWarehouse(ret.warehouseId.toString(), session);
    const byId = new Map(input.lines.map((l) => [l.lineId, l]));
    const issues: Issue[] = [];
    ret.lines.forEach((line, index) => {
      if (line.receivedQuantity === 0) return;
      const entry = byId.get(line._id.toString());
      if (!entry) {
        issues.push({ path: `lines.${index}`, message: `Inspect ${line.sku}` });
      } else if (entry.restockQuantity + entry.quarantineQuantity !== line.receivedQuantity) {
        issues.push({
          path: `lines.${index}.restockQuantity`,
          message: `Split all ${line.receivedQuantity} received ${line.unit} of ${line.sku}`,
        });
      }
    });
    if (issues.length > 0) throw new AppError(400, 'VALIDATION_ERROR', issues[0]!.message, issues);

    const createdBy = new Types.ObjectId(actor.id);
    let restocked = 0;
    let isolated = 0;
    for (const line of ret.lines) {
      const entry = byId.get(line._id.toString());
      if (!entry || line.receivedQuantity === 0) continue;
      if (entry.restockQuantity > 0) {
        await updateAverageCost(line.productId, entry.restockQuantity, line.unitCost, session);
        await moveBetweenBuckets(
          {
            warehouseId: ret.warehouseId,
            productId: line.productId,
            quantity: entry.restockQuantity,
            action: 'release',
            unitCost: line.unitCost,
            reference: { type: 'customerReturn', id: ret._id, number: ret.number },
            createdBy,
          },
          session,
        );
      }
      line.restockedQuantity = entry.restockQuantity;
      line.quarantinedQuantity = entry.quarantineQuantity;
      line.note = entry.note;
      restocked += entry.restockQuantity;
      isolated += entry.quarantineQuantity;
    }
    ret.status = 'completed';
    ret.inspectedAt = new Date();
    ret.inspectedBy = snapshot(actor);
    const note = `${units(restocked)} restocked in ${warehouse.code}${isolated > 0 ? `, ${isolated} kept in quarantine` : ''}`;
    ret.history.push(historyEntry(actor, 'inspected', note));
    await notify(
      { userIds: [ret.requestedBy._id], exclude: actor.id },
      {
        type: 'return',
        title: `${ret.number} inspected`,
        body: note,
        link: `/customer-returns/${id}`,
      },
      session,
    );
    const order = await SalesOrder.findById(ret.salesOrder._id).session(session);
    if (order) {
      order.history.push(historyEntry(actor, 'return_inspected', `${ret.number}: ${note}`));
      await order.save({ session });
    }
    await ret.save({ session });
  });
}

async function listCustomerReturns(query: ListCustomerReturnsQuery) {
  const filter: FilterQuery<CustomerReturnRecord> = {};
  if (query.status) filter.status = query.status;
  if (query.salesOrderId) filter['salesOrder._id'] = new Types.ObjectId(query.salesOrderId);
  if (query.customerId) filter['customer._id'] = new Types.ObjectId(query.customerId);
  if (query.warehouseId) filter.warehouseId = new Types.ObjectId(query.warehouseId);
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [
      { number: pattern },
      { 'salesOrder.number': pattern },
      { 'customer.name': pattern },
      { 'lines.sku': pattern },
    ];
  }
  const [rows, total] = await Promise.all([
    CustomerReturn.find(filter)
      .sort({ ...parseSort(query.sort), _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<CustomerReturnRecord[]>(),
    CustomerReturn.countDocuments(filter),
  ]);
  const warehouses = await warehouseLookup(rows.map((r) => r.warehouseId));
  return {
    data: rows.map((r) => toCustomerReturnDto(r, warehouses)),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

export function createCustomerReturnsRouter(): Router {
  const router = Router();
  router.use(authenticate());

  router.get('/', async (req, res) => {
    res.json(await listCustomerReturns(listCustomerReturnsQuerySchema.parse(req.query)));
  });

  router.get('/:id', async (req, res) => {
    res.json({ data: await getCustomerReturn(parseId(req.params.id, 'Customer return')) });
  });

  router.post('/', authorize('customerReturns:write'), async (req, res) => {
    const id = await createCustomerReturn(
      customerReturnSchema.parse(req.body),
      requireAuth(req).user,
    );
    res.status(201).json({ data: await getCustomerReturn(id) });
  });

  router.post('/:id/approve', authorize('customerReturns:write'), async (req, res) => {
    const id = parseId(req.params.id, 'Customer return');
    const actor = requireAuth(req).user;
    const updated = await CustomerReturn.findOneAndUpdate(
      { _id: id, status: 'requested' },
      {
        $set: { status: 'approved', approvedBy: snapshot(actor), approvedAt: new Date() },
        $push: { history: historyEntry(actor, 'approved') },
      },
    );
    if (!updated) {
      if (!(await CustomerReturn.exists({ _id: id }))) throw notFound('Customer return');
      throw invalidState('Only returns awaiting approval can be approved');
    }
    await notify(
      { permissions: ['returns:process'], exclude: actor.id },
      {
        type: 'return',
        title: `${updated.number} approved: expect goods back`,
        body: `${updated.customer.name}; receive into quarantine when it arrives`,
        link: `/customer-returns/${id}`,
      },
    );
    res.json({ data: await getCustomerReturn(id) });
  });

  router.post('/:id/reject', authorize('customerReturns:write'), async (req, res) => {
    const id = parseId(req.params.id, 'Customer return');
    const { reason } = reasonBodySchema.parse(req.body);
    await closeWithoutGoods(id, 'rejected', reason, requireAuth(req).user);
    res.json({ data: await getCustomerReturn(id) });
  });

  router.post('/:id/cancel', authorize('customerReturns:write'), async (req, res) => {
    const id = parseId(req.params.id, 'Customer return');
    const { reason } = reasonBodySchema.parse(req.body);
    await closeWithoutGoods(id, 'cancelled', reason, requireAuth(req).user);
    res.json({ data: await getCustomerReturn(id) });
  });

  router.post('/:id/receive', authorize('returns:process'), async (req, res) => {
    const id = parseId(req.params.id, 'Customer return');
    await receiveCustomerReturn(
      id,
      receiveCustomerReturnSchema.parse(req.body),
      requireAuth(req).user,
    );
    res.json({ data: await getCustomerReturn(id) });
  });

  router.post('/:id/inspect', authorize('returns:process'), async (req, res) => {
    const id = parseId(req.params.id, 'Customer return');
    await inspectReturn(id, inspectCustomerReturnSchema.parse(req.body), requireAuth(req).user);
    res.json({ data: await getCustomerReturn(id) });
  });

  return router;
}
