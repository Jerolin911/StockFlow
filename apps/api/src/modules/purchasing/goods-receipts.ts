import { Router } from 'express';
import { Types, type FilterQuery } from 'mongoose';
import {
  PURCHASE_ORDER_STATUS_LABELS,
  RECEIVABLE_PO_STATUSES,
  goodsReceiptSchema,
  listGoodsReceiptsQuerySchema,
  type GoodsReceiptDto,
  type ListGoodsReceiptsQuery,
  type PurchaseOrderStatus,
  type SupplierDeliverySummaryDto,
} from '@stockflow/shared';
import type { z } from 'zod';
import { nextDocumentNumber } from '../../lib/counters.js';
import { AppError, invalidState, notFound } from '../../lib/errors.js';
import { escapeRegex, parseId } from '../../lib/http.js';
import { inTransaction } from '../../lib/transaction.js';
import { authenticate, authorize, requireAuth } from '../../middleware/auth.js';
import { applyMovement, updateAverageCost } from '../stock/stock.service.js';
import { Warehouse } from '../warehouses/warehouse.model.js';
import {
  historyEntry,
  isoDate,
  snapshot,
  todayIso,
  userRef,
  validation,
  type Actor,
} from '../common/documents.js';
import { GoodsReceipt, PurchaseOrder, type GoodsReceiptRecord } from './models.js';

type ReceiptInput = z.output<typeof goodsReceiptSchema>;

function toDto(
  grn: GoodsReceiptRecord,
  warehouse?: { code: string; name: string },
): GoodsReceiptDto {
  const lines = grn.lines.map((l) => ({
    poLineId: l.poLineId.toString(),
    productId: l.productId.toString(),
    sku: l.sku,
    name: l.name,
    unit: l.unit,
    acceptedQuantity: l.acceptedQuantity,
    rejectedQuantity: l.rejectedQuantity,
    damagedQuantity: l.damagedQuantity,
    rejectionReason: l.rejectionReason,
    unitCost: l.unitCost,
  }));
  const expected = isoDate(grn.expectedDate);
  return {
    id: grn._id.toString(),
    number: grn.number,
    purchaseOrder: {
      id: grn.purchaseOrder._id!.toString(),
      number: grn.purchaseOrder.number ?? '',
    },
    supplier: {
      id: grn.supplier._id.toString(),
      code: grn.supplier.code ?? '',
      name: grn.supplier.name ?? '',
    },
    warehouse: {
      id: grn.warehouseId.toString(),
      code: warehouse?.code ?? '',
      name: warehouse?.name ?? '',
    },
    receivedAt: grn.receivedAt.toISOString(),
    deliveryNote: grn.deliveryNote,
    notes: grn.notes,
    lines,
    totals: {
      accepted: lines.reduce((s, l) => s + l.acceptedQuantity, 0),
      rejected: lines.reduce((s, l) => s + l.rejectedQuantity, 0),
      damaged: lines.reduce((s, l) => s + l.damagedQuantity, 0),
    },
    onTime: expected === null ? null : isoDate(grn.receivedAt)! <= expected,
    createdBy: userRef(grn.createdBy)!,
    createdAt: grn.createdAt.toISOString(),
  };
}

async function withWarehouses(rows: GoodsReceiptRecord[]) {
  const warehouses = await Warehouse.find(
    { _id: { $in: rows.map((r) => r.warehouseId) } },
    { code: 1, name: 1 },
  ).lean();
  const byId = new Map(warehouses.map((w) => [w._id.toString(), { code: w.code, name: w.name }]));
  return rows.map((r) => toDto(r, byId.get(r.warehouseId.toString())));
}

export async function getGoodsReceipt(id: string): Promise<GoodsReceiptDto> {
  const grn = await GoodsReceipt.findById(id).lean<GoodsReceiptRecord>();
  if (!grn) throw notFound('Goods receipt');
  return (await withWarehouses([grn]))[0]!;
}

function receivedAtFor(input: ReceiptInput, orderDate: Date): Date {
  if (!input.receivedAt || input.receivedAt === todayIso()) return new Date();
  if (input.receivedAt > todayIso())
    throw validation('receivedAt', 'The receipt date can’t be in the future');
  if (input.receivedAt < isoDate(orderDate)!) {
    throw validation('receivedAt', 'The receipt date can’t be before the order date');
  }
  return new Date(`${input.receivedAt}T12:00:00.000Z`);
}

/**
 * Posts a goods receipt. Accepted quantities enter stock as RECEIPT movements and count
 * towards the order; rejected and damaged quantities are recorded but stay outstanding.
 * Everything happens in one transaction: concurrent receipts against the same order
 * conflict on the order document and are retried against fresh quantities.
 */
export async function postGoodsReceipt(input: ReceiptInput, actor: Actor): Promise<string> {
  return inTransaction(async (session) => {
    const po = await PurchaseOrder.findById(input.purchaseOrderId).session(session);
    if (!po) throw validation('purchaseOrderId', 'Purchase order not found');

    const status = po.status as PurchaseOrderStatus;
    if (!(RECEIVABLE_PO_STATUSES as readonly string[]).includes(status)) {
      throw invalidState(
        `Goods can only be received against approved purchase orders. ${po.number} is ${PURCHASE_ORDER_STATUS_LABELS[status].toLowerCase()}.`,
      );
    }
    const warehouse = await Warehouse.findById(po.warehouseId).session(session).lean();
    if (!warehouse?.isActive) {
      throw invalidState(
        'The destination warehouse is deactivated. Reactivate it to receive goods.',
      );
    }

    const receivedAt = receivedAtFor(input, po.orderDate);
    const issues: { path: string; message: string }[] = [];
    const matched = input.lines.map((line, index) => {
      const poLine = po.lines.id(line.poLineId);
      if (!poLine) {
        issues.push({
          path: `lines.${index}.poLineId`,
          message: 'This line isn’t on the purchase order',
        });
        return null;
      }
      const outstanding = poLine.quantity - poLine.receivedQuantity;
      if (line.acceptedQuantity > outstanding) {
        issues.push({
          path: `lines.${index}.acceptedQuantity`,
          message: `Only ${outstanding} ${poLine.unit} of ${poLine.sku} outstanding`,
        });
      }
      return { line, poLine };
    });
    if (issues.length > 0) {
      throw new AppError(400, 'VALIDATION_ERROR', issues[0]!.message, issues);
    }

    const receiptId = new Types.ObjectId();
    const number = await nextDocumentNumber('GRN', session);
    const createdBy = new Types.ObjectId(actor.id);
    const receiptLines = [];

    for (const entry of matched) {
      const { line, poLine } = entry!;
      if (line.acceptedQuantity + line.rejectedQuantity + line.damagedQuantity === 0) continue;

      if (line.acceptedQuantity > 0) {
        await updateAverageCost(poLine.productId, line.acceptedQuantity, poLine.unitCost, session);
        await applyMovement(
          {
            productId: poLine.productId,
            warehouseId: po.warehouseId,
            type: 'RECEIPT',
            quantity: line.acceptedQuantity,
            unitCost: poLine.unitCost,
            reference: { type: 'goodsReceipt', id: receiptId, number },
            createdBy,
          },
          session,
        );
      }

      poLine.receivedQuantity += line.acceptedQuantity;
      poLine.rejectedQuantity += line.rejectedQuantity;
      poLine.damagedQuantity += line.damagedQuantity;
      receiptLines.push({
        poLineId: poLine._id,
        productId: poLine.productId,
        sku: poLine.sku,
        name: poLine.name,
        unit: poLine.unit,
        acceptedQuantity: line.acceptedQuantity,
        rejectedQuantity: line.rejectedQuantity,
        damagedQuantity: line.damagedQuantity,
        rejectionReason: line.rejectionReason,
        unitCost: poLine.unitCost,
      });
    }

    const accepted = receiptLines.reduce((s, l) => s + l.acceptedQuantity, 0);
    const notAccepted = receiptLines.reduce(
      (s, l) => s + l.rejectedQuantity + l.damagedQuantity,
      0,
    );
    const complete = po.lines.every((l) => l.receivedQuantity >= l.quantity);
    po.status = complete ? 'received' : 'partially_received';
    po.receiptCount += 1;
    po.history.push(
      historyEntry(
        actor,
        'received',
        `${number}: ${accepted} accepted${notAccepted > 0 ? `, ${notAccepted} rejected or damaged` : ''}`,
      ),
    );
    await po.save({ session });

    await GoodsReceipt.create(
      [
        {
          _id: receiptId,
          number,
          purchaseOrder: { _id: po._id, number: po.number },
          supplier: po.supplier,
          warehouseId: po.warehouseId,
          receivedAt,
          expectedDate: po.expectedDate,
          deliveryNote: input.deliveryNote,
          notes: input.notes,
          lines: receiptLines,
          createdBy: snapshot(actor),
        },
      ],
      { session },
    );
    return receiptId.toString();
  });
}

async function listGoodsReceipts(query: ListGoodsReceiptsQuery) {
  const filter: FilterQuery<GoodsReceiptRecord> = {};
  if (query.purchaseOrderId)
    filter['purchaseOrder._id'] = new Types.ObjectId(query.purchaseOrderId);
  if (query.supplierId) filter['supplier._id'] = new Types.ObjectId(query.supplierId);
  if (query.warehouseId) filter.warehouseId = new Types.ObjectId(query.warehouseId);
  if (query.issues) {
    filter.lines = {
      $elemMatch: { $or: [{ rejectedQuantity: { $gt: 0 } }, { damagedQuantity: { $gt: 0 } }] },
    };
  }
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [
      { number: pattern },
      { 'purchaseOrder.number': pattern },
      { 'supplier.name': pattern },
      { deliveryNote: pattern },
    ];
  }
  if (query.from || query.to) {
    filter.receivedAt = {
      ...(query.from ? { $gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
      ...(query.to ? { $lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
    };
  }
  const [rows, total] = await Promise.all([
    GoodsReceipt.find(filter)
      .sort({ receivedAt: -1, _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<GoodsReceiptRecord[]>(),
    GoodsReceipt.countDocuments(filter),
  ]);
  return {
    data: await withWarehouses(rows),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

export async function supplierDeliverySummary(
  supplierId: string,
): Promise<SupplierDeliverySummaryDto> {
  const id = new Types.ObjectId(supplierId);
  const [receipts] = await GoodsReceipt.aggregate<{
    receipts: number;
    onTime: number;
    late: number;
    acceptedUnits: number;
    rejectedUnits: number;
    damagedUnits: number;
  }>([
    { $match: { 'supplier._id': id } },
    {
      $project: {
        receivedDay: { $dateToString: { format: '%Y-%m-%d', date: '$receivedAt' } },
        expectedDay: {
          $cond: [
            { $eq: ['$expectedDate', null] },
            null,
            { $dateToString: { format: '%Y-%m-%d', date: '$expectedDate' } },
          ],
        },
        accepted: { $sum: '$lines.acceptedQuantity' },
        rejected: { $sum: '$lines.rejectedQuantity' },
        damaged: { $sum: '$lines.damagedQuantity' },
      },
    },
    {
      $group: {
        _id: null,
        receipts: { $sum: 1 },
        onTime: {
          $sum: {
            $cond: [
              {
                $and: [{ $ne: ['$expectedDay', null] }, { $lte: ['$receivedDay', '$expectedDay'] }],
              },
              1,
              0,
            ],
          },
        },
        late: {
          $sum: {
            $cond: [
              {
                $and: [{ $ne: ['$expectedDay', null] }, { $gt: ['$receivedDay', '$expectedDay'] }],
              },
              1,
              0,
            ],
          },
        },
        acceptedUnits: { $sum: '$accepted' },
        rejectedUnits: { $sum: '$rejected' },
        damagedUnits: { $sum: '$damaged' },
      },
    },
  ]);

  const today = new Date(`${todayIso()}T00:00:00.000Z`);
  const [openOrders, overdueOrders] = await Promise.all([
    PurchaseOrder.countDocuments({
      'supplier._id': id,
      status: { $in: [...RECEIVABLE_PO_STATUSES] },
    }),
    PurchaseOrder.countDocuments({
      'supplier._id': id,
      status: { $in: [...RECEIVABLE_PO_STATUSES] },
      expectedDate: { $ne: null, $lt: today },
    }),
  ]);

  return {
    receipts: receipts?.receipts ?? 0,
    onTime: receipts?.onTime ?? 0,
    late: receipts?.late ?? 0,
    acceptedUnits: receipts?.acceptedUnits ?? 0,
    rejectedUnits: receipts?.rejectedUnits ?? 0,
    damagedUnits: receipts?.damagedUnits ?? 0,
    openOrders,
    overdueOrders,
  };
}

export function createGoodsReceiptsRouter(): Router {
  const router = Router();
  router.use(authenticate());

  router.get('/', async (req, res) => {
    res.json(await listGoodsReceipts(listGoodsReceiptsQuerySchema.parse(req.query)));
  });

  router.get('/:id', async (req, res) => {
    res.json({ data: await getGoodsReceipt(parseId(req.params.id, 'Goods receipt')) });
  });

  router.post('/', authorize('goodsReceipts:create'), async (req, res) => {
    const id = await postGoodsReceipt(goodsReceiptSchema.parse(req.body), requireAuth(req).user);
    res.status(201).json({ data: await getGoodsReceipt(id) });
  });

  return router;
}
