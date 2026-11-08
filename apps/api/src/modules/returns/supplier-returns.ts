import { Router } from 'express';
import { Types, type FilterQuery } from 'mongoose';
import {
  SUPPLIER_RETURN_STATUS_LABELS,
  dispatchSupplierReturnSchema,
  listSupplierReturnsQuerySchema,
  reasonBodySchema,
  supplierReturnSchema,
  type ListSupplierReturnsQuery,
  type ReturnReason,
  type StockBucket,
  type SupplierReturnDto,
  type SupplierReturnStatus,
} from '@stockflow/shared';
import type { z } from 'zod';
import { nextDocumentNumber } from '../../lib/counters.js';
import { AppError, invalidState, notFound } from '../../lib/errors.js';
import { escapeRegex, parseId, parseSort } from '../../lib/http.js';
import { inTransaction } from '../../lib/transaction.js';
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
import { suppliers } from '../partners/partners.js';
import { Product } from '../products/product.model.js';
import { PurchaseOrder } from '../purchasing/models.js';
import { InsufficientStockError, applyMovement } from '../stock/stock.service.js';
import { SupplierReturn, type SupplierReturnRecord } from './models.js';

type CreateInput = z.output<typeof supplierReturnSchema>;
type DispatchInput = z.output<typeof dispatchSupplierReturnSchema>;

const units = (n: number) => `${n} unit${n === 1 ? '' : 's'}`;

export function toSupplierReturnDto(
  r: SupplierReturnRecord,
  warehouses: WarehouseLookup,
): SupplierReturnDto {
  const lines = r.lines.map((l) => ({
    id: l._id.toString(),
    productId: l.productId.toString(),
    sku: l.sku,
    name: l.name,
    unit: l.unit,
    quantity: l.quantity,
    source: l.source as StockBucket,
    unitCost: l.unitCost,
  }));
  return {
    id: r._id.toString(),
    number: r.number,
    status: r.status as SupplierReturnStatus,
    supplier: {
      id: r.supplier._id.toString(),
      code: r.supplier.code ?? '',
      name: r.supplier.name ?? '',
    },
    warehouse: warehouseRef(warehouses, r.warehouseId),
    purchaseOrder: r.purchaseOrder?._id
      ? { id: r.purchaseOrder._id.toString(), number: r.purchaseOrder.number ?? '' }
      : null,
    reason: r.reason as ReturnReason,
    notes: r.notes,
    lines,
    totalQuantity: lines.reduce((s, l) => s + l.quantity, 0),
    carrier: r.carrier,
    reference: r.reference,
    requestedBy: userRef(r.requestedBy)!,
    approvedBy: userRef(r.approvedBy),
    dispatchedAt: r.dispatchedAt ? r.dispatchedAt.toISOString() : null,
    dispatchedBy: userRef(r.dispatchedBy),
    rejectionReason: r.rejectionReason,
    cancelReason: r.cancelReason,
    history: historyDto(r.history),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function getSupplierReturn(id: string): Promise<SupplierReturnDto> {
  const r = await SupplierReturn.findById(id).lean<SupplierReturnRecord>();
  if (!r) throw notFound('Supplier return');
  return toSupplierReturnDto(r, await warehouseLookup([r.warehouseId]));
}

/**
 * Raises a return to a supplier. Lines are priced from the linked purchase order where the
 * product is on it, else the product's average cost. Stock moves only at dispatch.
 */
export async function createSupplierReturn(input: CreateInput, actor: Actor): Promise<string> {
  const supplier = await suppliers.Model.findById(input.supplierId).lean<{
    _id: Types.ObjectId;
    code: string;
    name: string;
  }>();
  if (!supplier) throw validation('supplierId', 'Supplier not found');
  const warehouse = await requireActiveWarehouse(input.warehouseId);

  let po = null;
  if (input.purchaseOrderId) {
    po = await PurchaseOrder.findById(input.purchaseOrderId).lean();
    if (!po) throw validation('purchaseOrderId', 'Purchase order not found');
    if (po.supplier._id.toString() !== supplier._id.toString()) {
      throw validation('purchaseOrderId', `${po.number} is from a different supplier`);
    }
  }
  const products = await Product.find({ _id: { $in: input.lines.map((l) => l.productId) } }).lean();
  const productFor = new Map(products.map((p) => [p._id.toString(), p]));
  const poCost = new Map((po?.lines ?? []).map((l) => [l.productId.toString(), l.unitCost]));

  const issues = input.lines.flatMap((l, index) =>
    productFor.has(l.productId)
      ? []
      : [{ path: `lines.${index}.productId`, message: 'Product not found' }],
  );
  if (issues.length > 0) throw new AppError(400, 'VALIDATION_ERROR', issues[0]!.message, issues);

  const lines = input.lines.map((l) => {
    const p = productFor.get(l.productId)!;
    return {
      productId: p._id,
      sku: p.sku,
      name: p.name,
      unit: p.unit,
      quantity: l.quantity,
      source: l.source,
      unitCost: poCost.get(l.productId) ?? p.avgCost,
    };
  });
  const total = lines.reduce((s, l) => s + l.quantity, 0);
  const [doc] = await SupplierReturn.create([
    {
      number: await nextDocumentNumber('SRN'),
      status: 'requested',
      supplier: { _id: supplier._id, code: supplier.code, name: supplier.name },
      warehouseId: warehouse._id,
      purchaseOrder: po ? { _id: po._id, number: po.number } : null,
      reason: input.reason,
      notes: input.notes,
      lines,
      requestedBy: snapshot(actor),
      history: [historyEntry(actor, 'requested', `${units(total)} from ${warehouse.code}`)],
    },
  ]);
  return doc!._id.toString();
}

/** Sends the goods back: SUPPLIER_RETURN movements out of each line's source bucket. */
async function dispatchReturn(id: string, input: DispatchInput, actor: Actor) {
  await inTransaction(async (session) => {
    const ret = await SupplierReturn.findById(id).session(session);
    if (!ret) throw notFound('Supplier return');
    if (ret.status !== 'approved') {
      throw invalidState(
        `Only approved returns can be sent. ${ret.number} is ${SUPPLIER_RETURN_STATUS_LABELS[ret.status as SupplierReturnStatus].toLowerCase()}.`,
      );
    }
    const warehouse = await requireActiveWarehouse(ret.warehouseId.toString(), session);
    const createdBy = new Types.ObjectId(actor.id);
    const issues: { path: string; message: string }[] = [];
    for (const [index, line] of ret.lines.entries()) {
      try {
        await applyMovement(
          {
            productId: line.productId,
            warehouseId: ret.warehouseId,
            type: 'SUPPLIER_RETURN',
            quantity: -line.quantity,
            bucket: line.source as StockBucket,
            unitCost: line.unitCost,
            reference: { type: 'supplierReturn', id: ret._id, number: ret.number },
            createdBy,
          },
          session,
        );
      } catch (error) {
        if (!(error instanceof InsufficientStockError)) throw error;
        issues.push({
          path: `lines.${index}.quantity`,
          message:
            line.source === 'quarantine'
              ? `Only ${error.available} ${line.unit} of ${line.sku} in quarantine at ${warehouse.code}`
              : `Only ${Math.max(error.available, 0)} ${line.unit} of ${line.sku} available at ${warehouse.code}`,
        });
      }
    }
    if (issues.length > 0)
      throw new AppError(409, 'INSUFFICIENT_STOCK', issues[0]!.message, issues);

    ret.status = 'dispatched';
    ret.carrier = input.carrier;
    ret.reference = input.reference;
    ret.dispatchedAt = new Date();
    ret.dispatchedBy = snapshot(actor);
    const total = ret.lines.reduce((s, l) => s + l.quantity, 0);
    ret.history.push(
      historyEntry(
        actor,
        'dispatched',
        `${units(total)} sent back to ${ret.supplier.name}${input.carrier ? ` via ${input.carrier}` : ''}`,
      ),
    );
    await ret.save({ session });
  });
}

async function transition(
  id: string,
  from: SupplierReturnStatus[],
  set: Record<string, unknown>,
  entry: ReturnType<typeof historyEntry>,
  message: string,
) {
  const updated = await SupplierReturn.findOneAndUpdate(
    { _id: id, status: { $in: from } },
    { $set: set, $push: { history: entry } },
  );
  if (!updated) {
    if (!(await SupplierReturn.exists({ _id: id }))) throw notFound('Supplier return');
    throw invalidState(message);
  }
}

async function listSupplierReturns(query: ListSupplierReturnsQuery) {
  const filter: FilterQuery<SupplierReturnRecord> = {};
  if (query.status) filter.status = query.status;
  if (query.supplierId) filter['supplier._id'] = new Types.ObjectId(query.supplierId);
  if (query.warehouseId) filter.warehouseId = new Types.ObjectId(query.warehouseId);
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [
      { number: pattern },
      { 'supplier.name': pattern },
      { 'purchaseOrder.number': pattern },
      { 'lines.sku': pattern },
    ];
  }
  const [rows, total] = await Promise.all([
    SupplierReturn.find(filter)
      .sort({ ...parseSort(query.sort), _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<SupplierReturnRecord[]>(),
    SupplierReturn.countDocuments(filter),
  ]);
  const warehouses = await warehouseLookup(rows.map((r) => r.warehouseId));
  return {
    data: rows.map((r) => toSupplierReturnDto(r, warehouses)),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

export function createSupplierReturnsRouter(): Router {
  const router = Router();
  router.use(authenticate());

  router.get('/', async (req, res) => {
    res.json(await listSupplierReturns(listSupplierReturnsQuerySchema.parse(req.query)));
  });

  router.get('/:id', async (req, res) => {
    res.json({ data: await getSupplierReturn(parseId(req.params.id, 'Supplier return')) });
  });

  router.post('/', authorize('supplierReturns:write'), async (req, res) => {
    const id = await createSupplierReturn(
      supplierReturnSchema.parse(req.body),
      requireAuth(req).user,
    );
    res.status(201).json({ data: await getSupplierReturn(id) });
  });

  router.post('/:id/approve', authorize('supplierReturns:approve'), async (req, res) => {
    const id = parseId(req.params.id, 'Supplier return');
    const actor = requireAuth(req).user;
    await transition(
      id,
      ['requested'],
      { status: 'approved', approvedBy: snapshot(actor), approvedAt: new Date() },
      historyEntry(actor, 'approved'),
      'Only returns awaiting approval can be approved',
    );
    res.json({ data: await getSupplierReturn(id) });
  });

  router.post('/:id/reject', authorize('supplierReturns:approve'), async (req, res) => {
    const id = parseId(req.params.id, 'Supplier return');
    const { reason } = reasonBodySchema.parse(req.body);
    await transition(
      id,
      ['requested'],
      { status: 'rejected', rejectionReason: reason },
      historyEntry(requireAuth(req).user, 'rejected', reason),
      'Only returns awaiting approval can be rejected',
    );
    res.json({ data: await getSupplierReturn(id) });
  });

  router.post('/:id/cancel', authorize('supplierReturns:write'), async (req, res) => {
    const id = parseId(req.params.id, 'Supplier return');
    const { reason } = reasonBodySchema.parse(req.body);
    await transition(
      id,
      ['requested', 'approved'],
      { status: 'cancelled', cancelReason: reason },
      historyEntry(requireAuth(req).user, 'cancelled', reason),
      'Returns can’t be cancelled once sent',
    );
    res.json({ data: await getSupplierReturn(id) });
  });

  router.post('/:id/dispatch', authorize('returns:process'), async (req, res) => {
    const id = parseId(req.params.id, 'Supplier return');
    await dispatchReturn(id, dispatchSupplierReturnSchema.parse(req.body), requireAuth(req).user);
    res.json({ data: await getSupplierReturn(id) });
  });

  return router;
}
