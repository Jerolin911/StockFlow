import { Router } from 'express';
import { Types, type FilterQuery } from 'mongoose';
import {
  convertPurchaseRequestSchema,
  listPurchaseRequestsQuerySchema,
  purchaseRequestSchema,
  reasonBodySchema,
  type ListPurchaseRequestsQuery,
  type PurchaseRequestDto,
  type PurchaseRequestStatus,
} from '@stockflow/shared';
import type { z } from 'zod';
import { nextDocumentNumber } from '../../lib/counters.js';
import { forbidden, invalidState, notFound } from '../../lib/errors.js';
import { escapeRegex, parseId } from '../../lib/http.js';
import { inTransaction } from '../../lib/transaction.js';
import { notify } from '../notifications/notifications.js';
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
  userRef,
  type Actor,
} from '../common/documents.js';
import { PurchaseOrder, PurchaseRequest, type PurchaseRequestRecord } from './models.js';
import { createPurchaseOrder } from './purchase-orders.js';

type RequestInput = z.output<typeof purchaseRequestSchema>;

async function toDto(pr: PurchaseRequestRecord): Promise<PurchaseRequestDto> {
  const warehouse = await Warehouse.findById(pr.warehouseId, { code: 1, name: 1 }).lean();
  return toDtoWith(pr, warehouse ? { code: warehouse.code, name: warehouse.name } : undefined);
}

function toDtoWith(
  pr: PurchaseRequestRecord,
  warehouse: { code: string; name: string } | undefined,
): PurchaseRequestDto {
  return {
    id: pr._id.toString(),
    number: pr.number,
    status: pr.status as PurchaseRequestStatus,
    warehouse: {
      id: pr.warehouseId.toString(),
      code: warehouse?.code ?? '',
      name: warehouse?.name ?? '',
    },
    supplier: pr.supplier
      ? {
          id: pr.supplier._id.toString(),
          code: pr.supplier.code ?? '',
          name: pr.supplier.name ?? '',
        }
      : null,
    neededBy: isoDate(pr.neededBy),
    notes: pr.notes,
    lines: pr.lines.map((l) => ({
      id: l._id.toString(),
      productId: l.productId.toString(),
      sku: l.sku,
      name: l.name,
      unit: l.unit,
      quantity: l.quantity,
      note: l.note,
    })),
    requestedBy: userRef(pr.requestedBy)!,
    purchaseOrder: pr.purchaseOrder
      ? { id: pr.purchaseOrder._id!.toString(), number: pr.purchaseOrder.number ?? '' }
      : null,
    rejectionReason: pr.rejectionReason,
    history: historyDto(pr.history),
    createdAt: pr.createdAt.toISOString(),
    updatedAt: pr.updatedAt.toISOString(),
  };
}

async function getRequest(id: string) {
  const pr = await PurchaseRequest.findById(id).lean<PurchaseRequestRecord>();
  if (!pr) throw notFound('Purchase request');
  return pr;
}

async function buildFields(input: RequestInput) {
  await requireActiveWarehouse(input.warehouseId);
  const supplier = input.supplierId ? await requireActiveSupplier(input.supplierId) : null;
  const productFor = await loadActiveProducts(input.lines.map((l) => l.productId));
  return {
    warehouseId: new Types.ObjectId(input.warehouseId),
    supplier: supplier ? { _id: supplier._id, code: supplier.code, name: supplier.name } : null,
    neededBy: input.neededBy ? dateFromIso(input.neededBy) : null,
    notes: input.notes,
    lines: input.lines.map((line) => {
      const product = productFor(line.productId);
      return {
        productId: product._id,
        sku: product.sku,
        name: product.name,
        unit: product.unit,
        quantity: line.quantity,
        note: line.note,
      };
    }),
  };
}

/** Requesters manage their own drafts; admins can act on any. */
function assertOwner(pr: PurchaseRequestRecord, actor: Actor) {
  if (actor.role !== 'admin' && pr.requestedBy._id.toString() !== actor.id) {
    throw forbidden('Only the requester can change this purchase request');
  }
}

async function transition(
  id: string,
  from: PurchaseRequestStatus[],
  set: Record<string, unknown>,
  entry: ReturnType<typeof historyEntry>,
  message: string,
  extraFilter: FilterQuery<PurchaseRequestRecord> = {},
) {
  const pr = await PurchaseRequest.findOneAndUpdate(
    { _id: id, status: { $in: from }, ...extraFilter },
    { $set: set, $push: { history: entry } },
    { new: true },
  ).lean<PurchaseRequestRecord>();
  if (!pr) {
    if (!(await PurchaseRequest.exists({ _id: id }))) throw notFound('Purchase request');
    throw invalidState(message);
  }
  return pr;
}

async function listRequests(query: ListPurchaseRequestsQuery, actor: Actor) {
  const filter: FilterQuery<PurchaseRequestRecord> = {};
  if (query.status) filter.status = query.status;
  if (query.warehouseId) filter.warehouseId = new Types.ObjectId(query.warehouseId);
  if (query.mine) filter['requestedBy._id'] = new Types.ObjectId(actor.id);
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ number: pattern }, { 'lines.sku': pattern }, { 'lines.name': pattern }];
  }
  const [rows, total] = await Promise.all([
    PurchaseRequest.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<PurchaseRequestRecord[]>(),
    PurchaseRequest.countDocuments(filter),
  ]);
  const warehouses = await Warehouse.find(
    { _id: { $in: rows.map((r) => r.warehouseId) } },
    { code: 1, name: 1 },
  ).lean();
  const byId = new Map(warehouses.map((w) => [w._id.toString(), { code: w.code, name: w.name }]));
  return {
    data: rows.map((pr) => toDtoWith(pr, byId.get(pr.warehouseId.toString()))),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

export function createPurchaseRequestsRouter(): Router {
  const router = Router();
  router.use(authenticate());

  router.get('/', async (req, res) => {
    const query = listPurchaseRequestsQuerySchema.parse(req.query);
    res.json(await listRequests(query, requireAuth(req).user));
  });

  router.get('/:id', async (req, res) => {
    res.json({ data: await toDto(await getRequest(parseId(req.params.id, 'Purchase request'))) });
  });

  router.post('/', authorize('purchaseRequests:create'), async (req, res) => {
    const actor = requireAuth(req).user;
    const fields = await buildFields(purchaseRequestSchema.parse(req.body));
    const pr = await PurchaseRequest.create({
      ...fields,
      number: await nextDocumentNumber('PR'),
      status: 'draft',
      requestedBy: snapshot(actor),
      history: [historyEntry(actor, 'created')],
    });
    res.status(201).json({ data: await toDto(pr.toObject() as PurchaseRequestRecord) });
  });

  router.patch('/:id', authorize('purchaseRequests:create'), async (req, res) => {
    const id = parseId(req.params.id, 'Purchase request');
    const actor = requireAuth(req).user;
    assertOwner(await getRequest(id), actor);
    const fields = await buildFields(purchaseRequestSchema.parse(req.body));
    const updated = await PurchaseRequest.findOneAndUpdate(
      { _id: id, status: 'draft' },
      { $set: fields },
      { new: true },
    ).lean<PurchaseRequestRecord>();
    if (!updated) throw invalidState('Only draft purchase requests can be edited');
    res.json({ data: await toDto(updated) });
  });

  router.delete('/:id', authorize('purchaseRequests:create'), async (req, res) => {
    const id = parseId(req.params.id, 'Purchase request');
    assertOwner(await getRequest(id), requireAuth(req).user);
    const deleted = await PurchaseRequest.findOneAndDelete({ _id: id, status: 'draft' });
    if (!deleted) throw invalidState('Only draft purchase requests can be deleted');
    res.status(204).end();
  });

  router.post('/:id/submit', authorize('purchaseRequests:create'), async (req, res) => {
    const id = parseId(req.params.id, 'Purchase request');
    const actor = requireAuth(req).user;
    assertOwner(await getRequest(id), actor);
    const pr = await transition(
      id,
      ['draft'],
      { status: 'submitted', rejectionReason: '' },
      historyEntry(actor, 'submitted'),
      'Only draft purchase requests can be submitted',
    );
    await notify(
      { permissions: ['purchaseRequests:approve'], exclude: actor.id },
      {
        type: 'purchase_request',
        title: `${pr.number} needs approval`,
        body: `Requested by ${actor.name}`,
        link: `/purchase-requests/${id}`,
      },
    );
    res.json({ data: await toDto(pr) });
  });

  router.post('/:id/approve', authorize('purchaseRequests:approve'), async (req, res) => {
    const id = parseId(req.params.id, 'Purchase request');
    const actor = requireAuth(req).user;
    const current = await getRequest(id);
    if (actor.role !== 'admin' && current.requestedBy._id.toString() === actor.id) {
      throw invalidState('Someone other than the requester must approve this request');
    }
    const pr = await transition(
      id,
      ['submitted'],
      { status: 'approved' },
      historyEntry(actor, 'approved'),
      'Only submitted purchase requests can be approved',
    );
    await notify(
      { userIds: [pr.requestedBy._id], exclude: actor.id },
      {
        type: 'purchase_request',
        title: `${pr.number} approved`,
        body: `Approved by ${actor.name}`,
        link: `/purchase-requests/${id}`,
      },
    );
    res.json({ data: await toDto(pr) });
  });

  router.post('/:id/reject', authorize('purchaseRequests:approve'), async (req, res) => {
    const id = parseId(req.params.id, 'Purchase request');
    const { reason } = reasonBodySchema.parse(req.body);
    const pr = await transition(
      id,
      ['submitted'],
      { status: 'rejected', rejectionReason: reason },
      historyEntry(requireAuth(req).user, 'rejected', reason),
      'Only submitted purchase requests can be rejected',
    );
    await notify(
      { userIds: [pr.requestedBy._id], exclude: requireAuth(req).user.id },
      {
        type: 'purchase_request',
        title: `${pr.number} rejected`,
        body: reason,
        link: `/purchase-requests/${id}`,
      },
    );
    res.json({ data: await toDto(pr) });
  });

  router.post('/:id/cancel', async (req, res) => {
    const id = parseId(req.params.id, 'Purchase request');
    const auth = requireAuth(req);
    const { reason } = reasonBodySchema.parse(req.body);
    const current = await getRequest(id);
    // The requester can withdraw their request; approvers can cancel any open request.
    if (!auth.permissions.includes('purchaseRequests:approve')) assertOwner(current, auth.user);
    const pr = await transition(
      id,
      ['draft', 'submitted', 'approved'],
      { status: 'cancelled' },
      historyEntry(auth.user, 'cancelled', reason),
      'This purchase request can no longer be cancelled',
    );
    res.json({ data: await toDto(pr) });
  });

  // Turns an approved request into a draft purchase order for the chosen supplier.
  router.post('/:id/convert', authorize('purchaseOrders:write'), async (req, res) => {
    const id = parseId(req.params.id, 'Purchase request');
    const actor = requireAuth(req).user;
    const { supplierId } = convertPurchaseRequestSchema.parse(req.body);

    const result = await inTransaction(async (session) => {
      const pr = await PurchaseRequest.findOne({ _id: id, status: 'approved' })
        .session(session)
        .lean<PurchaseRequestRecord>();
      if (!pr) {
        if (!(await PurchaseRequest.exists({ _id: id }).session(session)))
          throw notFound('Purchase request');
        throw invalidState('Only approved purchase requests can be converted');
      }
      const poId = await createPurchaseOrder(
        {
          supplierId,
          warehouseId: pr.warehouseId.toString(),
          expectedDate: null,
          notes: pr.notes,
          lines: pr.lines.map((l) => ({ productId: l.productId.toString(), quantity: l.quantity })),
        },
        actor,
        { purchaseRequest: { _id: pr._id, number: pr.number }, session },
      );
      const po = await PurchaseOrder.findById(poId, { number: 1 }).session(session).lean();
      const updated = await PurchaseRequest.updateOne(
        { _id: pr._id, status: 'approved' },
        {
          $set: { status: 'ordered', purchaseOrder: { _id: po!._id, number: po!.number } },
          $push: { history: historyEntry(actor, 'ordered', po!.number) },
        },
        { session },
      );
      if (updated.modifiedCount !== 1)
        throw invalidState('This purchase request changed. Try again.');
      await notify(
        { userIds: [pr.requestedBy._id], exclude: actor.id },
        {
          type: 'purchase_request',
          title: `${pr.number} ordered`,
          body: `Purchase order ${po!.number} raised by ${actor.name}`,
          link: `/purchase-orders/${poId}`,
        },
        session,
      );
      return poId;
    });

    res.status(201).json({ data: { purchaseOrderId: result } });
  });

  return router;
}
