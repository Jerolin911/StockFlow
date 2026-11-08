import { Router } from 'express';
import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import {
  RECEIVABLE_PO_STATUSES,
  documentTotals,
  lineAmounts,
  listPurchaseOrdersQuerySchema,
  purchaseOrderSchema,
  reasonBodySchema,
  type ListPurchaseOrdersQuery,
  type PurchaseOrderDto,
  type PurchaseOrderStatus,
} from '@stockflow/shared';
import type { z } from 'zod';
import { nextDocumentNumber } from '../../lib/counters.js';
import { invalidState, notFound } from '../../lib/errors.js';
import { escapeRegex, parseId, parseSort } from '../../lib/http.js';
import { inTransaction } from '../../lib/transaction.js';
import { authenticate, authorize, requireAuth } from '../../middleware/auth.js';
import { Warehouse } from '../warehouses/warehouse.model.js';
import {
  dateFromIso,
  historyDto,
  historyEntry,
  isoDate,
  loadActiveProducts,
  requireActiveSupplier,
  requireActiveWarehouse,
  snapshot,
  todayIso,
  userRef,
  type Actor,
} from './common.js';
import {
  PurchaseOrder,
  PurchaseRequest,
  SupplierPrice,
  type PurchaseOrderRecord,
} from './models.js';

type OrderInput = z.output<typeof purchaseOrderSchema>;

const CLOSED_STATUSES: PurchaseOrderStatus[] = ['closed', 'cancelled'];

function isReceivable(status: PurchaseOrderStatus) {
  return (RECEIVABLE_PO_STATUSES as readonly string[]).includes(status);
}

type WarehouseLookup = Map<string, { code: string; name: string }>;

async function warehouseLookup(ids: Types.ObjectId[]): Promise<WarehouseLookup> {
  const warehouses = await Warehouse.find({ _id: { $in: ids } }, { code: 1, name: 1 }).lean();
  return new Map(warehouses.map((w) => [w._id.toString(), { code: w.code, name: w.name }]));
}

export function toPurchaseOrderDto(
  po: PurchaseOrderRecord,
  warehouses: WarehouseLookup,
): PurchaseOrderDto {
  const status = po.status as PurchaseOrderStatus;
  const closed = CLOSED_STATUSES.includes(status);
  const warehouseId = po.warehouseId.toString();
  const warehouse = warehouses.get(warehouseId) ?? { code: '', name: '' };
  const expected = isoDate(po.expectedDate);
  return {
    id: po._id.toString(),
    number: po.number,
    status,
    supplier: {
      id: po.supplier._id.toString(),
      code: po.supplier.code ?? '',
      name: po.supplier.name ?? '',
    },
    warehouse: { id: warehouseId, ...warehouse },
    purchaseRequest: po.purchaseRequest
      ? { id: po.purchaseRequest._id!.toString(), number: po.purchaseRequest.number ?? '' }
      : null,
    orderDate: po.orderDate.toISOString(),
    expectedDate: expected,
    notes: po.notes,
    lines: po.lines.map((l) => ({
      id: l._id.toString(),
      productId: l.productId.toString(),
      sku: l.sku,
      name: l.name,
      unit: l.unit,
      quantity: l.quantity,
      receivedQuantity: l.receivedQuantity,
      rejectedQuantity: l.rejectedQuantity,
      damagedQuantity: l.damagedQuantity,
      pendingQuantity: closed ? 0 : Math.max(l.quantity - l.receivedQuantity, 0),
      unitCost: l.unitCost,
      taxRate: l.taxRate,
      lineSubtotal: l.lineSubtotal,
      lineTax: l.lineTax,
      lineTotal: l.lineTotal,
    })),
    subtotal: po.subtotal,
    taxTotal: po.taxTotal,
    total: po.total,
    createdBy: userRef(po.createdBy)!,
    approvedBy: userRef(po.approvedBy),
    approvedAt: po.approvedAt ? po.approvedAt.toISOString() : null,
    rejectionReason: po.rejectionReason,
    cancelReason: po.cancelReason,
    closeReason: po.closeReason,
    receiptCount: po.receiptCount,
    isOverdue: isReceivable(status) && expected !== null && expected < todayIso(),
    history: historyDto(po.history),
    createdAt: po.createdAt.toISOString(),
    updatedAt: po.updatedAt.toISOString(),
  };
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrderDto> {
  const po = await PurchaseOrder.findById(id).lean<PurchaseOrderRecord>();
  if (!po) throw notFound('Purchase order');
  return toPurchaseOrderDto(po, await warehouseLookup([po.warehouseId]));
}

/** Builds priced lines: supplier price if one exists, else the product's cost price. */
export async function buildOrderLines(
  supplierId: Types.ObjectId,
  lines: { productId: string; quantity: number; unitCost?: number | undefined }[],
  session?: ClientSession,
) {
  const productFor = await loadActiveProducts(
    lines.map((l) => l.productId),
    session,
  );
  const prices = await SupplierPrice.find({
    supplierId,
    productId: { $in: lines.map((l) => new Types.ObjectId(l.productId)) },
  })
    .session(session ?? null)
    .lean();
  const priceFor = new Map(prices.map((p) => [p.productId.toString(), p.unitCost]));

  const built = lines.map((line) => {
    const product = productFor(line.productId);
    const unitCost = line.unitCost ?? priceFor.get(line.productId) ?? product.costPrice;
    return {
      _id: new Types.ObjectId(),
      productId: product._id,
      sku: product.sku,
      name: product.name,
      unit: product.unit,
      quantity: line.quantity,
      receivedQuantity: 0,
      rejectedQuantity: 0,
      damagedQuantity: 0,
      unitCost,
      taxRate: product.taxRate,
      ...lineAmounts(line.quantity, unitCost, product.taxRate),
    };
  });
  return { lines: built, ...documentTotals(built) };
}

function defaultExpectedDate(leadTimeDays: number | null | undefined) {
  if (leadTimeDays === null || leadTimeDays === undefined) return null;
  const date = dateFromIso(todayIso());
  date.setUTCDate(date.getUTCDate() + leadTimeDays);
  return date;
}

export async function createPurchaseOrder(
  input: OrderInput,
  actor: Actor,
  options: {
    purchaseRequest?: { _id: Types.ObjectId; number: string };
    session?: ClientSession;
  } = {},
) {
  const supplier = await requireActiveSupplier(input.supplierId, options.session);
  await requireActiveWarehouse(input.warehouseId, options.session);
  const priced = await buildOrderLines(supplier._id, input.lines, options.session);

  const [po] = await PurchaseOrder.create(
    [
      {
        number: await nextDocumentNumber('PO', options.session),
        status: 'draft',
        supplier: { _id: supplier._id, code: supplier.code, name: supplier.name },
        warehouseId: new Types.ObjectId(input.warehouseId),
        purchaseRequest: options.purchaseRequest ?? null,
        orderDate: new Date(),
        expectedDate: input.expectedDate
          ? dateFromIso(input.expectedDate)
          : defaultExpectedDate(supplier.leadTimeDays),
        notes: input.notes,
        ...priced,
        createdBy: snapshot(actor),
        history: [
          historyEntry(
            actor,
            'created',
            options.purchaseRequest ? `From ${options.purchaseRequest.number}` : '',
          ),
        ],
      },
    ],
    options.session ? { session: options.session } : {},
  );
  return po!._id.toString();
}

async function updateDraft(id: string, input: OrderInput) {
  const supplier = await requireActiveSupplier(input.supplierId);
  await requireActiveWarehouse(input.warehouseId);
  const priced = await buildOrderLines(supplier._id, input.lines);
  const updated = await PurchaseOrder.findOneAndUpdate(
    { _id: id, status: 'draft' },
    {
      $set: {
        supplier: { _id: supplier._id, code: supplier.code, name: supplier.name },
        warehouseId: new Types.ObjectId(input.warehouseId),
        expectedDate: input.expectedDate ? dateFromIso(input.expectedDate) : null,
        notes: input.notes,
        ...priced,
      },
    },
  );
  if (!updated) await throwStateError(id, 'Only draft purchase orders can be edited');
}

async function throwStateError(id: string, message: string): Promise<never> {
  if (!(await PurchaseOrder.exists({ _id: id }))) throw notFound('Purchase order');
  throw invalidState(message);
}

/** Atomic status change: applies only if the order is still in one of `from`. */
async function transition(
  id: string,
  filter: FilterQuery<PurchaseOrderRecord>,
  set: Record<string, unknown>,
  entry: ReturnType<typeof historyEntry>,
  message: string,
  session?: ClientSession,
) {
  const po = await PurchaseOrder.findOneAndUpdate(
    { _id: id, ...filter },
    { $set: set, $push: { history: entry } },
    { new: true, ...(session ? { session } : {}) },
  ).lean<PurchaseOrderRecord>();
  if (!po) await throwStateError(id, message);
  return po!;
}

/** A request whose order goes away (draft deleted or order cancelled) can be ordered again. */
async function releaseRequest(po: PurchaseOrderRecord, actor: Actor, session: ClientSession) {
  if (!po.purchaseRequest?._id) return;
  await PurchaseRequest.updateOne(
    { _id: po.purchaseRequest._id, status: 'ordered' },
    {
      $set: { status: 'approved', purchaseOrder: null },
      $push: { history: historyEntry(actor, 'reopened', `${po.number} was withdrawn`) },
    },
    { session },
  );
}

export async function listPurchaseOrders(query: ListPurchaseOrdersQuery) {
  const filter: FilterQuery<PurchaseOrderRecord> = {};
  if (query.status) filter.status = query.status;
  if (query.open || query.overdue) filter.status = { $in: [...RECEIVABLE_PO_STATUSES] };
  if (query.overdue) filter.expectedDate = { $ne: null, $lt: dateFromIso(todayIso()) };
  if (query.supplierId) filter['supplier._id'] = new Types.ObjectId(query.supplierId);
  if (query.warehouseId) filter.warehouseId = new Types.ObjectId(query.warehouseId);
  if (query.productId) filter['lines.productId'] = new Types.ObjectId(query.productId);
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ number: pattern }, { 'supplier.name': pattern }, { 'supplier.code': pattern }];
  }

  const [rows, total] = await Promise.all([
    PurchaseOrder.find(filter)
      .sort({ ...parseSort(query.sort), _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<PurchaseOrderRecord[]>(),
    PurchaseOrder.countDocuments(filter),
  ]);
  const warehouses = await warehouseLookup(rows.map((r) => r.warehouseId));
  return {
    data: rows.map((po) => toPurchaseOrderDto(po, warehouses)),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

export function createPurchaseOrdersRouter(): Router {
  const router = Router();
  router.use(authenticate());

  router.get('/', async (req, res) => {
    res.json(await listPurchaseOrders(listPurchaseOrdersQuerySchema.parse(req.query)));
  });

  router.get('/:id', async (req, res) => {
    res.json({ data: await getPurchaseOrder(parseId(req.params.id, 'Purchase order')) });
  });

  router.post('/', authorize('purchaseOrders:write'), async (req, res) => {
    const id = await createPurchaseOrder(
      purchaseOrderSchema.parse(req.body),
      requireAuth(req).user,
    );
    res.status(201).json({ data: await getPurchaseOrder(id) });
  });

  router.patch('/:id', authorize('purchaseOrders:write'), async (req, res) => {
    const id = parseId(req.params.id, 'Purchase order');
    await updateDraft(id, purchaseOrderSchema.parse(req.body));
    res.json({ data: await getPurchaseOrder(id) });
  });

  router.delete('/:id', authorize('purchaseOrders:write'), async (req, res) => {
    const id = parseId(req.params.id, 'Purchase order');
    const actor = requireAuth(req).user;
    await inTransaction(async (session) => {
      const po = await PurchaseOrder.findOneAndDelete(
        { _id: id, status: 'draft' },
        { session },
      ).lean<PurchaseOrderRecord>();
      if (!po) await throwStateError(id, 'Only draft purchase orders can be deleted');
      await releaseRequest(po!, actor, session);
    });
    res.status(204).end();
  });

  router.post('/:id/submit', authorize('purchaseOrders:write'), async (req, res) => {
    const id = parseId(req.params.id, 'Purchase order');
    await transition(
      id,
      { status: 'draft' },
      { status: 'pending_approval', rejectionReason: '' },
      historyEntry(requireAuth(req).user, 'submitted'),
      'Only draft purchase orders can be submitted',
    );
    res.json({ data: await getPurchaseOrder(id) });
  });

  router.post('/:id/approve', authorize('purchaseOrders:approve'), async (req, res) => {
    const id = parseId(req.params.id, 'Purchase order');
    const auth = requireAuth(req);
    const actor = auth.user;
    // Separation of duties: the creator can't approve their own order unless they're an admin.
    if (actor.role !== 'admin') {
      const po = await PurchaseOrder.findById(id, { 'createdBy._id': 1 }).lean();
      if (!po) throw notFound('Purchase order');
      if (po.createdBy._id.toString() === actor.id) {
        throw invalidState('Someone other than the creator must approve this purchase order');
      }
    }
    await transition(
      id,
      { status: 'pending_approval' },
      { status: 'approved', approvedBy: snapshot(actor), approvedAt: new Date() },
      historyEntry(actor, 'approved'),
      'Only purchase orders awaiting approval can be approved',
    );
    res.json({ data: await getPurchaseOrder(id) });
  });

  router.post('/:id/reject', authorize('purchaseOrders:approve'), async (req, res) => {
    const id = parseId(req.params.id, 'Purchase order');
    const { reason } = reasonBodySchema.parse(req.body);
    await transition(
      id,
      { status: 'pending_approval' },
      { status: 'draft', rejectionReason: reason },
      historyEntry(requireAuth(req).user, 'rejected', reason),
      'Only purchase orders awaiting approval can be rejected',
    );
    res.json({ data: await getPurchaseOrder(id) });
  });

  router.post('/:id/cancel', authorize('purchaseOrders:write'), async (req, res) => {
    const id = parseId(req.params.id, 'Purchase order');
    const { reason } = reasonBodySchema.parse(req.body);
    const actor = requireAuth(req).user;
    await inTransaction(async (session) => {
      const po = await transition(
        id,
        { status: { $in: ['draft', 'pending_approval', 'approved'] }, receiptCount: 0 },
        { status: 'cancelled', cancelReason: reason },
        historyEntry(actor, 'cancelled', reason),
        'Purchase orders with receipts can’t be cancelled. Close the remaining quantities instead.',
        session,
      );
      await releaseRequest(po, actor, session);
    });
    res.json({ data: await getPurchaseOrder(id) });
  });

  router.post('/:id/close', authorize('purchaseOrders:write'), async (req, res) => {
    const id = parseId(req.params.id, 'Purchase order');
    const { reason } = reasonBodySchema.parse(req.body);
    await transition(
      id,
      { status: 'partially_received' },
      { status: 'closed', closeReason: reason },
      historyEntry(requireAuth(req).user, 'closed', reason),
      'Only partially received purchase orders can be closed',
    );
    res.json({ data: await getPurchaseOrder(id) });
  });

  return router;
}
