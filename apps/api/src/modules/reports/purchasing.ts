import type { FilterQuery, PipelineStage, Types } from 'mongoose';
import type {
  DeliveryRowDto,
  PendingPurchaseRowDto,
  ReportTableQuery,
  SupplierPerformanceDto,
  TrendDto,
  TrendQuery,
} from '@stockflow/shared';
import { escapeRegex } from '../../lib/http.js';
import { warehouseLookup, warehouseRef } from '../common/documents.js';
import { suppliers } from '../partners/partners.js';
import { GoodsReceipt, PurchaseOrder } from '../purchasing/models.js';
import {
  CSV_ROW_LIMIT,
  buildTrend,
  dateOnly,
  oid,
  periodExpr,
  pickInterval,
  ratio,
  resolveRange,
  round,
} from './common.js';

const DAY = 86_400_000;
const RAISED = { $nin: ['draft', 'cancelled'] };
const OPEN = { $in: ['approved', 'partially_received'] };

const todayStart = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

/** Orders raised (excluding drafts and cancellations), their value, and units received. */
export async function purchaseTrend(query: TrendQuery): Promise<TrendDto> {
  const range = resolveRange(query);
  const interval = pickInterval(range.days, query.interval);
  const scope = {
    ...(query.supplierId ? { 'supplier._id': oid(query.supplierId) } : {}),
    ...(query.warehouseId ? { warehouseId: oid(query.warehouseId) } : {}),
  };
  const [orders, receipts] = await Promise.all([
    PurchaseOrder.aggregate<{ _id: string; orders: number; value: number }>([
      { $match: { ...scope, status: RAISED, orderDate: { $gte: range.from, $lt: range.until } } },
      {
        $group: {
          _id: periodExpr('$orderDate', interval),
          orders: { $sum: 1 },
          value: { $sum: '$total' },
        },
      },
    ]),
    GoodsReceipt.aggregate<{ _id: string; units: number }>([
      { $match: { ...scope, receivedAt: { $gte: range.from, $lt: range.until } } },
      {
        $group: {
          _id: periodExpr('$receivedAt', interval),
          units: { $sum: { $sum: '$lines.acceptedQuantity' } },
        },
      },
    ]),
  ]);
  return buildTrend(
    range,
    interval,
    [
      { key: 'orders', label: 'Orders raised' },
      { key: 'value', label: 'Value ordered' },
      { key: 'received', label: 'Units received' },
    ],
    [
      ...orders.flatMap((o) => [
        { period: o._id, key: 'orders', value: o.orders },
        { period: o._id, key: 'value', value: o.value },
      ]),
      ...receipts.map((r) => ({ period: r._id, key: 'received', value: r.units })),
    ],
  );
}

/**
 * Per supplier over the range: orders and value raised, deliveries on time or late (by the
 * order's expected date), and the share of delivered units rejected or damaged. Open and
 * overdue orders are as of today.
 */
export async function supplierPerformance(
  query: ReportTableQuery,
): Promise<SupplierPerformanceDto[]> {
  const range = resolveRange(query);
  const supplierMatch = query.supplierId ? { 'supplier._id': oid(query.supplierId) } : {};
  const [orders, receipts, open, list] = await Promise.all([
    PurchaseOrder.aggregate<{ _id: Types.ObjectId; orders: number; value: number }>([
      {
        $match: {
          ...supplierMatch,
          status: RAISED,
          orderDate: { $gte: range.from, $lt: range.until },
        },
      },
      { $group: { _id: '$supplier._id', orders: { $sum: 1 }, value: { $sum: '$total' } } },
    ]),
    GoodsReceipt.aggregate<{
      _id: Types.ObjectId;
      receipts: number;
      onTime: number;
      late: number;
      lateDays: number;
      withExpected: number;
      accepted: number;
      rejected: number;
      damaged: number;
    }>([
      { $match: { ...supplierMatch, receivedAt: { $gte: range.from, $lt: range.until } } },
      {
        $project: {
          supplier: '$supplier._id',
          daysLate: {
            $cond: [
              { $eq: ['$expectedDate', null] },
              null,
              {
                $dateDiff: {
                  startDate: '$expectedDate',
                  endDate: { $dateTrunc: { date: '$receivedAt', unit: 'day', timezone: 'UTC' } },
                  unit: 'day',
                },
              },
            ],
          },
          accepted: { $sum: '$lines.acceptedQuantity' },
          rejected: { $sum: '$lines.rejectedQuantity' },
          damaged: { $sum: '$lines.damagedQuantity' },
        },
      },
      {
        $group: {
          _id: '$supplier',
          receipts: { $sum: 1 },
          onTime: {
            $sum: {
              $cond: [{ $and: [{ $ne: ['$daysLate', null] }, { $lte: ['$daysLate', 0] }] }, 1, 0],
            },
          },
          late: { $sum: { $cond: [{ $gt: ['$daysLate', 0] }, 1, 0] } },
          lateDays: { $sum: { $cond: [{ $gt: ['$daysLate', 0] }, '$daysLate', 0] } },
          withExpected: { $sum: { $cond: [{ $ne: ['$daysLate', null] }, 1, 0] } },
          accepted: { $sum: '$accepted' },
          rejected: { $sum: '$rejected' },
          damaged: { $sum: '$damaged' },
        },
      },
    ]),
    PurchaseOrder.aggregate<{ _id: Types.ObjectId; open: number; overdue: number }>([
      { $match: { ...supplierMatch, status: OPEN } },
      {
        $group: {
          _id: '$supplier._id',
          open: { $sum: 1 },
          overdue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$expectedDate', null] },
                    { $lt: ['$expectedDate', todayStart()] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
    suppliers.Model.find(query.supplierId ? { _id: oid(query.supplierId) } : {}, {
      code: 1,
      name: 1,
    }).lean<{ _id: Types.ObjectId; code: string; name: string }[]>(),
  ]);
  const ordersFor = new Map(orders.map((o) => [o._id.toString(), o]));
  const receiptsFor = new Map(receipts.map((r) => [r._id.toString(), r]));
  const openFor = new Map(open.map((o) => [o._id.toString(), o]));
  const pattern = query.search ? new RegExp(escapeRegex(query.search), 'i') : null;

  return list
    .filter((s) => !pattern || pattern.test(s.name) || pattern.test(s.code))
    .map((s) => {
      const id = s._id.toString();
      const o = ordersFor.get(id);
      const r = receiptsFor.get(id);
      const w = openFor.get(id);
      const delivered = (r?.accepted ?? 0) + (r?.rejected ?? 0) + (r?.damaged ?? 0);
      return {
        supplier: { id, code: s.code, name: s.name },
        orders: o?.orders ?? 0,
        orderedValue: o?.value ?? 0,
        receipts: r?.receipts ?? 0,
        onTime: r?.onTime ?? 0,
        late: r?.late ?? 0,
        onTimeRate: ratio(r?.onTime ?? 0, r?.withExpected ?? 0),
        averageDaysLate: r && r.withExpected > 0 ? round(r.lateDays / r.withExpected) : null,
        acceptedUnits: r?.accepted ?? 0,
        rejectedUnits: r?.rejected ?? 0,
        damagedUnits: r?.damaged ?? 0,
        issueRate: ratio((r?.rejected ?? 0) + (r?.damaged ?? 0), delivered),
        openOrders: w?.open ?? 0,
        overdueOrders: w?.overdue ?? 0,
      };
    })
    .filter((s) => query.supplierId || s.orders + s.receipts + s.openOrders > 0)
    .sort(
      (a, b) =>
        b.receipts - a.receipts ||
        b.orders - a.orders ||
        a.supplier.name.localeCompare(b.supplier.name),
    );
}

/** Goods receipts in the range with how late each was against the order's expected date. */
export async function deliveries(query: ReportTableQuery, all: boolean) {
  const range = resolveRange(query);
  const filter: FilterQuery<unknown> = { receivedAt: { $gte: range.from, $lt: range.until } };
  if (query.supplierId) filter['supplier._id'] = oid(query.supplierId);
  if (query.warehouseId) filter.warehouseId = oid(query.warehouseId);
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [
      { number: pattern },
      { 'purchaseOrder.number': pattern },
      { 'supplier.name': pattern },
    ];
  }
  const [rows, total] = await Promise.all([
    GoodsReceipt.find(filter)
      .sort({ receivedAt: -1, _id: -1 })
      .skip(all ? 0 : (query.page - 1) * query.pageSize)
      .limit(all ? CSV_ROW_LIMIT : query.pageSize)
      .lean(),
    GoodsReceipt.countDocuments(filter),
  ]);
  const warehouses = await warehouseLookup(rows.map((r) => r.warehouseId));
  const data: DeliveryRowDto[] = rows.map((r) => {
    const expected = dateOnly(r.expectedDate);
    const received = dateOnly(r.receivedAt)!;
    return {
      receipt: { id: r._id.toString(), number: r.number },
      purchaseOrder: { id: r.purchaseOrder._id!.toString(), number: r.purchaseOrder.number ?? '' },
      supplier: {
        id: r.supplier._id.toString(),
        code: r.supplier.code ?? '',
        name: r.supplier.name ?? '',
      },
      warehouse: warehouseRef(warehouses, r.warehouseId),
      receivedAt: r.receivedAt.toISOString(),
      expectedDate: expected,
      daysLate: expected ? Math.round((Date.parse(received) - Date.parse(expected)) / DAY) : null,
      acceptedUnits: r.lines.reduce((s, l) => s + l.acceptedQuantity, 0),
      rejectedUnits: r.lines.reduce((s, l) => s + l.rejectedQuantity, 0),
      damagedUnits: r.lines.reduce((s, l) => s + l.damagedQuantity, 0),
    };
  });
  return { data, meta: { page: query.page, pageSize: query.pageSize, total } };
}

/** Lines of open purchase orders with units still to arrive. */
export async function pendingPurchases(query: ReportTableQuery, all: boolean) {
  const match: FilterQuery<unknown> = { status: OPEN };
  if (query.supplierId) match['supplier._id'] = oid(query.supplierId);
  if (query.warehouseId) match.warehouseId = oid(query.warehouseId);
  const after: FilterQuery<unknown> = { pending: { $gt: 0 } };
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    after.$or = [
      { number: pattern },
      { 'line.sku': pattern },
      { 'line.name': pattern },
      { 'supplier.name': pattern },
    ];
  }
  const stages: PipelineStage[] = [
    { $match: match },
    { $unwind: { path: '$lines', includeArrayIndex: 'index' } },
    {
      $set: {
        line: '$lines',
        pending: { $subtract: ['$lines.quantity', '$lines.receivedQuantity'] },
      },
    },
    { $match: after },
    { $sort: { expectedDate: 1, number: 1, index: 1 } },
  ];
  const [result] = await PurchaseOrder.aggregate<{
    rows: {
      _id: Types.ObjectId;
      number: string;
      supplier: { _id: Types.ObjectId; code: string; name: string };
      warehouseId: Types.ObjectId;
      expectedDate: Date | null;
      line: {
        productId: Types.ObjectId;
        sku: string;
        name: string;
        unit: PendingPurchaseRowDto['product']['unit'];
        quantity: number;
        receivedQuantity: number;
      };
      pending: number;
    }[];
    total: { count: number }[];
  }>([
    ...stages,
    {
      $facet: {
        rows: all
          ? [{ $limit: CSV_ROW_LIMIT }]
          : [{ $skip: (query.page - 1) * query.pageSize }, { $limit: query.pageSize }],
        total: [{ $count: 'count' }],
      },
    },
  ]);
  const rows = result?.rows ?? [];
  const warehouses = await warehouseLookup(rows.map((r) => r.warehouseId));
  const today = todayStart();
  const data: PendingPurchaseRowDto[] = rows.map((r) => ({
    purchaseOrder: { id: r._id.toString(), number: r.number },
    supplier: { id: r.supplier._id.toString(), code: r.supplier.code, name: r.supplier.name },
    warehouse: warehouseRef(warehouses, r.warehouseId),
    product: {
      id: r.line.productId.toString(),
      sku: r.line.sku,
      name: r.line.name,
      unit: r.line.unit,
    },
    ordered: r.line.quantity,
    received: r.line.receivedQuantity,
    pending: r.pending,
    expectedDate: dateOnly(r.expectedDate),
    isOverdue: r.expectedDate !== null && r.expectedDate < today,
  }));
  return {
    data,
    meta: { page: query.page, pageSize: query.pageSize, total: result?.total[0]?.count ?? 0 },
  };
}
