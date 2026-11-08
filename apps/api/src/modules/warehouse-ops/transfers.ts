import { Router } from 'express';
import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import {
  IN_TRANSIT_TRANSFER_STATUSES,
  TRANSFER_STATUS_LABELS,
  dispatchTransferSchema,
  hasPermission,
  listTransfersQuerySchema,
  reasonBodySchema,
  receiveTransferSchema,
  transferSchema,
  type ListTransfersQuery,
  type TransferDto,
  type TransferStatus,
} from '@stockflow/shared';
import type { z } from 'zod';
import { nextDocumentNumber } from '../../lib/counters.js';
import { AppError, forbidden, invalidState, notFound } from '../../lib/errors.js';
import { escapeRegex, parseId, parseSort } from '../../lib/http.js';
import { inTransaction } from '../../lib/transaction.js';
import { notify } from '../notifications/notifications.js';
import { authenticate, authorize, requireAuth } from '../../middleware/auth.js';
import {
  dateFromIso,
  historyDto,
  historyEntry,
  isoDate,
  loadActiveProducts,
  requireActiveWarehouse,
  snapshot,
  userRef,
  warehouseLookup,
  warehouseRef,
  type Actor,
  type WarehouseLookup,
} from '../common/documents.js';
import { Product } from '../products/product.model.js';
import { StockAdjustment } from '../stock/stock-adjustment.model.js';
import { InsufficientStockError, applyMovement } from '../stock/stock.service.js';
import { StockTransfer, type TransferRecord } from './models.js';

type TransferInput = z.output<typeof transferSchema>;
type DispatchInput = z.output<typeof dispatchTransferSchema>;
type ReceiveInput = z.output<typeof receiveTransferSchema>;
type Issue = { path: string; message: string };

interface LineCounts {
  dispatchedQuantity: number;
  receivedQuantity: number;
  damagedQuantity: number;
  lostQuantity: number;
}

export const inTransitFor = (l: LineCounts) =>
  l.dispatchedQuantity - l.receivedQuantity - l.damagedQuantity - l.lostQuantity;

const units = (n: number) => `${n} unit${n === 1 ? '' : 's'}`;

export function toTransferDto(t: TransferRecord, warehouses: WarehouseLookup): TransferDto {
  const lines = t.lines.map((l) => ({
    id: l._id.toString(),
    productId: l.productId.toString(),
    sku: l.sku,
    name: l.name,
    unit: l.unit,
    quantity: l.quantity,
    dispatchedQuantity: l.dispatchedQuantity,
    receivedQuantity: l.receivedQuantity,
    damagedQuantity: l.damagedQuantity,
    lostQuantity: l.lostQuantity,
    inTransitQuantity: inTransitFor(l),
    unitCost: l.unitCost ?? null,
  }));
  const sum = (pick: (l: (typeof lines)[number]) => number) =>
    lines.reduce((s, l) => s + pick(l), 0);
  return {
    id: t._id.toString(),
    number: t.number,
    status: t.status as TransferStatus,
    fromWarehouse: warehouseRef(warehouses, t.fromWarehouseId),
    toWarehouse: warehouseRef(warehouses, t.toWarehouseId),
    neededBy: isoDate(t.neededBy),
    notes: t.notes,
    lines,
    totals: {
      requested: sum((l) => l.quantity),
      dispatched: sum((l) => l.dispatchedQuantity),
      received: sum((l) => l.receivedQuantity + l.damagedQuantity),
      inTransit: sum((l) => l.inTransitQuantity),
    },
    carrier: t.carrier,
    reference: t.reference,
    requestedBy: userRef(t.requestedBy)!,
    approvedBy: userRef(t.approvedBy),
    dispatchedAt: t.dispatchedAt ? t.dispatchedAt.toISOString() : null,
    dispatchedBy: userRef(t.dispatchedBy),
    receipts: t.receipts.map((r) => ({
      at: r.at.toISOString(),
      by: userRef(r.by)!,
      note: r.note,
      lines: r.lines.map((l) => ({
        lineId: l.lineId.toString(),
        receivedQuantity: l.receivedQuantity,
        damagedQuantity: l.damagedQuantity,
      })),
    })),
    rejectionReason: t.rejectionReason,
    cancelReason: t.cancelReason,
    closeReason: t.closeReason,
    lossAdjustment: t.lossAdjustment
      ? { id: t.lossAdjustment._id.toString(), number: t.lossAdjustment.number }
      : null,
    history: historyDto(t.history),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export async function getTransfer(id: string): Promise<TransferDto> {
  const t = await StockTransfer.findById(id).lean<TransferRecord>();
  if (!t) throw notFound('Transfer');
  return toTransferDto(t, await warehouseLookup([t.fromWarehouseId, t.toWarehouseId]));
}

/** Like requireActiveWarehouse, reporting the error on the given field. */
async function activeWarehouseAt(id: string, path: string) {
  try {
    return await requireActiveWarehouse(id);
  } catch (error) {
    if (error instanceof AppError) {
      throw new AppError(400, 'VALIDATION_ERROR', error.message, [
        { path, message: error.message },
      ]);
    }
    throw error;
  }
}

async function transferFields(input: TransferInput) {
  await activeWarehouseAt(input.fromWarehouseId, 'fromWarehouseId');
  const to = await activeWarehouseAt(input.toWarehouseId, 'toWarehouseId');
  const productFor = await loadActiveProducts(input.lines.map((l) => l.productId));
  return {
    fromWarehouseId: new Types.ObjectId(input.fromWarehouseId),
    toWarehouseId: to._id,
    neededBy: input.neededBy ? dateFromIso(input.neededBy) : null,
    notes: input.notes,
    lines: input.lines.map((l) => {
      const p = productFor(l.productId);
      return {
        _id: new Types.ObjectId(),
        productId: p._id,
        sku: p.sku,
        name: p.name,
        unit: p.unit,
        quantity: l.quantity,
      };
    }),
  };
}

export async function createTransfer(input: TransferInput, actor: Actor): Promise<string> {
  const fields = await transferFields(input);
  const [doc] = await StockTransfer.create([
    {
      number: await nextDocumentNumber('TRF'),
      status: 'requested',
      ...fields,
      requestedBy: snapshot(actor),
      history: [historyEntry(actor, 'requested')],
    },
  ]);
  const total = fields.lines.reduce((s, l) => s + l.quantity, 0);
  await notify(
    { permissions: ['transfers:approve'], exclude: actor.id },
    {
      type: 'transfer',
      title: `${doc!.number} needs approval`,
      body: `${total} units requested by ${actor.name}`,
      link: `/stock/transfers/${doc!._id.toString()}`,
    },
  );
  return doc!._id.toString();
}

async function throwStateError(id: string, message: string): Promise<never> {
  if (!(await StockTransfer.exists({ _id: id }))) throw notFound('Transfer');
  throw invalidState(message);
}

/** The requester, or anyone who can approve transfers, may edit or cancel a request. */
async function requireOwnerOrApprover(id: string, actor: Actor) {
  const t = await StockTransfer.findById(id, { 'requestedBy._id': 1 }).lean();
  if (!t) throw notFound('Transfer');
  if (
    t.requestedBy._id.toString() !== actor.id &&
    !hasPermission(actor.role, 'transfers:approve')
  ) {
    throw forbidden('Only the requester or an approver can change this transfer');
  }
}

async function transition(
  id: string,
  from: TransferStatus[],
  set: Record<string, unknown>,
  entry: ReturnType<typeof historyEntry>,
  message: string,
) {
  const updated = await StockTransfer.findOneAndUpdate(
    { _id: id, status: { $in: from } },
    { $set: set, $push: { history: entry } },
  ).lean<TransferRecord>();
  if (!updated) await throwStateError(id, message);
  return updated!;
}

/** Tells the requester and approver how their transfer is progressing. */
const transferUpdate = (
  t: {
    _id: { toString(): string };
    number: string;
    requestedBy: { _id: unknown };
    approvedBy?: { _id: unknown } | null;
  },
  actor: Actor,
  title: string,
  body: string,
  session?: ClientSession,
) =>
  notify(
    {
      userIds: [String(t.requestedBy._id), t.approvedBy ? String(t.approvedBy._id) : null],
      exclude: actor.id,
    },
    {
      type: 'transfer',
      title: `${t.number} ${title}`,
      body,
      link: `/stock/transfers/${t._id.toString()}`,
    },
    session,
  );

/**
 * Takes the dispatched quantities out of the source as TRANSFER_OUT movements. They are in
 * neither warehouse until received; the transfer's lines track them meanwhile.
 */
export async function dispatchTransfer(id: string, input: DispatchInput, actor: Actor) {
  await inTransaction(async (session) => {
    const t = await StockTransfer.findById(id).session(session);
    if (!t) throw notFound('Transfer');
    if (t.status !== 'approved') {
      throw invalidState(
        `Only approved transfers can be dispatched. ${t.number} is ${TRANSFER_STATUS_LABELS[t.status as TransferStatus].toLowerCase()}.`,
      );
    }
    const source = await requireActiveWarehouse(t.fromWarehouseId.toString(), session);
    await requireActiveWarehouse(t.toWarehouseId.toString(), session);

    const requested = new Map(input.lines.map((l, index) => [l.lineId, { ...l, index }]));
    const issues: Issue[] = [];
    input.lines.forEach((l, index) => {
      const line = t.lines.id(l.lineId);
      if (!line) issues.push({ path: `lines.${index}.lineId`, message: 'Not on this transfer' });
      else if (l.quantity > line.quantity) {
        issues.push({
          path: `lines.${index}.quantity`,
          message: `Only ${line.quantity} ${line.unit} were requested`,
        });
      }
    });
    if (issues.length > 0) throw new AppError(400, 'VALIDATION_ERROR', issues[0]!.message, issues);

    const products = await Product.find(
      { _id: { $in: t.lines.map((l) => l.productId) } },
      { avgCost: 1 },
    )
      .session(session)
      .lean();
    const costFor = new Map(products.map((p) => [p._id.toString(), p.avgCost]));
    const createdBy = new Types.ObjectId(actor.id);
    let total = 0;

    for (const [index, line] of t.lines.entries()) {
      const entry = requested.get(line._id.toString());
      const quantity = entry ? entry.quantity : line.quantity;
      line.unitCost = costFor.get(line.productId.toString()) ?? 0;
      if (quantity === 0) continue;
      try {
        await applyMovement(
          {
            productId: line.productId,
            warehouseId: t.fromWarehouseId,
            type: 'TRANSFER_OUT',
            quantity: -quantity,
            unitCost: line.unitCost,
            reference: { type: 'transfer', id: t._id, number: t.number },
            createdBy,
          },
          session,
        );
      } catch (error) {
        if (!(error instanceof InsufficientStockError)) throw error;
        issues.push({
          path: `lines.${entry?.index ?? index}.quantity`,
          message: `Only ${Math.max(error.available, 0)} ${line.unit} of ${line.sku} available in ${source.code}`,
        });
        continue;
      }
      line.dispatchedQuantity = quantity;
      total += quantity;
    }
    if (issues.length > 0) {
      throw new AppError(409, 'INSUFFICIENT_STOCK', issues[0]!.message, issues);
    }
    if (total === 0) throw new AppError(400, 'VALIDATION_ERROR', 'Dispatch at least one unit');

    t.status = 'in_transit';
    t.carrier = input.carrier;
    t.reference = input.reference;
    t.dispatchedAt = new Date();
    t.dispatchedBy = snapshot(actor);
    t.history.push(
      historyEntry(
        actor,
        'dispatched',
        `${units(total)} left ${source.code}${input.carrier ? ` via ${input.carrier}` : ''}`,
      ),
    );
    await t.save({ session });
    await transferUpdate(
      t,
      actor,
      'dispatched',
      `${units(total)} left ${source.code} and are in transit`,
      session,
    );
  });
}

/**
 * Receives part or all of what's in transit. Good units become usable stock at the
 * destination; damaged units go to its quarantine. Both are TRANSFER_IN movements.
 */
export async function receiveTransfer(id: string, input: ReceiveInput, actor: Actor) {
  await inTransaction(async (session) => {
    const t = await StockTransfer.findById(id).session(session);
    if (!t) throw notFound('Transfer');
    if (!(IN_TRANSIT_TRANSFER_STATUSES as readonly string[]).includes(t.status)) {
      throw invalidState(`${t.number} has nothing in transit to receive`);
    }
    const destination = await requireActiveWarehouse(t.toWarehouseId.toString(), session);

    const issues: Issue[] = [];
    const matched = input.lines.map((l, index) => {
      const line = t.lines.id(l.lineId);
      if (!line) {
        issues.push({ path: `lines.${index}.lineId`, message: 'Not on this transfer' });
        return null;
      }
      const open = inTransitFor(line);
      if (l.receivedQuantity + l.damagedQuantity > open) {
        issues.push({
          path: `lines.${index}.receivedQuantity`,
          message: `Only ${open} ${line.unit} of ${line.sku} in transit`,
        });
      }
      return { input: l, line };
    });
    if (issues.length > 0) throw new AppError(400, 'VALIDATION_ERROR', issues[0]!.message, issues);

    const createdBy = new Types.ObjectId(actor.id);
    const reference = { type: 'transfer' as const, id: t._id, number: t.number };
    let good = 0;
    let damaged = 0;
    for (const entry of matched) {
      const { input: l, line } = entry!;
      const base = {
        productId: line.productId,
        warehouseId: t.toWarehouseId,
        type: 'TRANSFER_IN' as const,
        unitCost: line.unitCost ?? 0,
        reference,
        createdBy,
      };
      if (l.receivedQuantity > 0) {
        await applyMovement({ ...base, quantity: l.receivedQuantity }, session);
      }
      if (l.damagedQuantity > 0) {
        await applyMovement(
          { ...base, quantity: l.damagedQuantity, bucket: 'quarantine' },
          session,
        );
      }
      line.receivedQuantity += l.receivedQuantity;
      line.damagedQuantity += l.damagedQuantity;
      good += l.receivedQuantity;
      damaged += l.damagedQuantity;
    }

    t.receipts.push({
      at: new Date(),
      by: snapshot(actor),
      note: input.note,
      lines: matched.map((m) => ({
        lineId: m!.line._id,
        receivedQuantity: m!.input.receivedQuantity,
        damagedQuantity: m!.input.damagedQuantity,
      })),
    });
    const remaining = t.lines.reduce((s, l) => s + inTransitFor(l), 0);
    t.status = remaining === 0 ? 'received' : 'partially_received';
    t.history.push(
      historyEntry(
        actor,
        'received',
        `${units(good)} into ${destination.code}${damaged > 0 ? `, ${damaged} damaged to quarantine` : ''}${remaining > 0 ? `; ${remaining} still in transit` : ''}${input.note ? `. ${input.note}` : ''}`,
      ),
    );
    await t.save({ session });
    await transferUpdate(
      t,
      actor,
      remaining === 0 ? 'received' : 'partly received',
      `${units(good)} into ${destination.code}${damaged > 0 ? `, ${damaged} damaged` : ''}${remaining > 0 ? `; ${remaining} still in transit` : ''}`,
      session,
    );
  });
}

/**
 * Ends a transfer whose remaining units won't arrive. The destination receives them and an
 * adjustment (reason: loss) writes them off, so both movements show what happened.
 */
async function closeTransfer(id: string, reason: string, actor: Actor) {
  await inTransaction(async (session) => {
    const t = await StockTransfer.findById(id).session(session);
    if (!t) throw notFound('Transfer');
    if (!(IN_TRANSIT_TRANSFER_STATUSES as readonly string[]).includes(t.status)) {
      throw invalidState(`${t.number} has nothing in transit to close`);
    }
    const destination = await requireActiveWarehouse(t.toWarehouseId.toString(), session);
    const createdBy = new Types.ObjectId(actor.id);
    const adjustmentId = new Types.ObjectId();
    const adjustmentNumber = await nextDocumentNumber('ADJ', session);
    const adjustmentLines = [];

    for (const line of t.lines) {
      const lost = inTransitFor(line);
      if (lost === 0) continue;
      const cost = line.unitCost ?? 0;
      await applyMovement(
        {
          productId: line.productId,
          warehouseId: t.toWarehouseId,
          type: 'TRANSFER_IN',
          quantity: lost,
          unitCost: cost,
          reference: { type: 'transfer', id: t._id, number: t.number },
          createdBy,
        },
        session,
      );
      const { previousOnHand, balanceAfter } = await applyMovement(
        {
          productId: line.productId,
          warehouseId: t.toWarehouseId,
          type: 'ADJUSTMENT',
          quantity: -lost,
          unitCost: cost,
          reference: { type: 'adjustment', id: adjustmentId, number: adjustmentNumber },
          createdBy,
        },
        session,
      );
      line.lostQuantity += lost;
      adjustmentLines.push({
        productId: line.productId,
        sku: line.sku,
        name: line.name,
        unit: line.unit,
        quantityChange: -lost,
        previousOnHand,
        balanceAfter,
        unitCost: cost,
        reason: 'loss',
      });
    }

    await StockAdjustment.create(
      [
        {
          _id: adjustmentId,
          number: adjustmentNumber,
          type: 'adjustment',
          warehouseId: destination._id,
          reason: 'loss',
          notes: `Lost in transit on ${t.number}: ${reason}`,
          lines: adjustmentLines,
          source: { type: 'transfer', _id: t._id, number: t.number },
          createdBy,
        },
      ],
      { session },
    );
    const lostTotal = adjustmentLines.reduce((s, l) => s - l.quantityChange, 0);
    t.status = 'closed';
    t.closeReason = reason;
    t.lossAdjustment = { _id: adjustmentId, number: adjustmentNumber };
    t.history.push(
      historyEntry(
        actor,
        'closed',
        `${units(lostTotal)} written off in ${adjustmentNumber}: ${reason}`,
      ),
    );
    await t.save({ session });
    await transferUpdate(
      t,
      actor,
      'closed short',
      `${units(lostTotal)} written off: ${reason}`,
      session,
    );
  });
}

async function listTransfers(query: ListTransfersQuery) {
  const filter: FilterQuery<TransferRecord> = {};
  if (query.status) filter.status = query.status;
  if (query.inTransit) filter.status = { $in: [...IN_TRANSIT_TRANSFER_STATUSES] };
  if (query.warehouseId) {
    const id = new Types.ObjectId(query.warehouseId);
    filter.$or = [{ fromWarehouseId: id }, { toWarehouseId: id }];
  }
  if (query.productId) filter['lines.productId'] = new Types.ObjectId(query.productId);
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$and = [
      { $or: [{ number: pattern }, { 'lines.sku': pattern }, { 'lines.name': pattern }] },
    ];
  }
  const [rows, total] = await Promise.all([
    StockTransfer.find(filter)
      .sort({ ...parseSort(query.sort), _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<TransferRecord[]>(),
    StockTransfer.countDocuments(filter),
  ]);
  const warehouses = await warehouseLookup(
    rows.flatMap((r) => [r.fromWarehouseId, r.toWarehouseId]),
  );
  return {
    data: rows.map((t) => toTransferDto(t, warehouses)),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

export function createTransfersRouter(): Router {
  const router = Router();
  router.use(authenticate());

  router.get('/', async (req, res) => {
    res.json(await listTransfers(listTransfersQuerySchema.parse(req.query)));
  });

  router.get('/:id', async (req, res) => {
    res.json({ data: await getTransfer(parseId(req.params.id, 'Transfer')) });
  });

  router.post('/', authorize('stock:transfer'), async (req, res) => {
    const id = await createTransfer(transferSchema.parse(req.body), requireAuth(req).user);
    res.status(201).json({ data: await getTransfer(id) });
  });

  router.patch('/:id', authorize('stock:transfer'), async (req, res) => {
    const id = parseId(req.params.id, 'Transfer');
    const actor = requireAuth(req).user;
    await requireOwnerOrApprover(id, actor);
    const fields = await transferFields(transferSchema.parse(req.body));
    await transition(
      id,
      ['requested'],
      fields,
      historyEntry(actor, 'updated'),
      'Only requests awaiting approval can be edited',
    );
    res.json({ data: await getTransfer(id) });
  });

  router.post('/:id/approve', authorize('transfers:approve'), async (req, res) => {
    const id = parseId(req.params.id, 'Transfer');
    const actor = requireAuth(req).user;
    if (actor.role !== 'admin') {
      const t = await StockTransfer.findById(id, { 'requestedBy._id': 1 }).lean();
      if (!t) throw notFound('Transfer');
      if (t.requestedBy._id.toString() === actor.id) {
        throw invalidState('Someone other than the requester must approve this transfer');
      }
    }
    const approved = await transition(
      id,
      ['requested'],
      { status: 'approved', approvedBy: snapshot(actor), approvedAt: new Date() },
      historyEntry(actor, 'approved'),
      'Only transfers awaiting approval can be approved',
    );
    await transferUpdate(
      approved,
      actor,
      'approved',
      `Approved by ${actor.name}; ready to dispatch`,
    );
    res.json({ data: await getTransfer(id) });
  });

  router.post('/:id/reject', authorize('transfers:approve'), async (req, res) => {
    const id = parseId(req.params.id, 'Transfer');
    const { reason } = reasonBodySchema.parse(req.body);
    const actor = requireAuth(req).user;
    const rejected = await transition(
      id,
      ['requested'],
      { status: 'rejected', rejectionReason: reason },
      historyEntry(actor, 'rejected', reason),
      'Only transfers awaiting approval can be rejected',
    );
    await transferUpdate(rejected, actor, 'rejected', reason);
    res.json({ data: await getTransfer(id) });
  });

  router.post('/:id/cancel', authorize('stock:transfer'), async (req, res) => {
    const id = parseId(req.params.id, 'Transfer');
    const actor = requireAuth(req).user;
    const { reason } = reasonBodySchema.parse(req.body);
    await requireOwnerOrApprover(id, actor);
    await transition(
      id,
      ['requested', 'approved'],
      { status: 'cancelled', cancelReason: reason },
      historyEntry(actor, 'cancelled', reason),
      'Transfers can’t be cancelled after dispatch. Receive what arrives, then close the rest.',
    );
    res.json({ data: await getTransfer(id) });
  });

  router.post('/:id/dispatch', authorize('stock:transfer'), async (req, res) => {
    const id = parseId(req.params.id, 'Transfer');
    await dispatchTransfer(id, dispatchTransferSchema.parse(req.body), requireAuth(req).user);
    res.json({ data: await getTransfer(id) });
  });

  router.post('/:id/receive', authorize('stock:transfer'), async (req, res) => {
    const id = parseId(req.params.id, 'Transfer');
    await receiveTransfer(id, receiveTransferSchema.parse(req.body), requireAuth(req).user);
    res.json({ data: await getTransfer(id) });
  });

  router.post('/:id/close', authorize('transfers:approve'), async (req, res) => {
    const id = parseId(req.params.id, 'Transfer');
    const { reason } = reasonBodySchema.parse(req.body);
    await closeTransfer(id, reason, requireAuth(req).user);
    res.json({ data: await getTransfer(id) });
  });

  return router;
}
