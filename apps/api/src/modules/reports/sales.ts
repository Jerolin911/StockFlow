import type { FilterQuery, Types } from 'mongoose';
import type {
  FulfilmentStatsDto,
  ReportTableQuery,
  SalesOrderReportRowDto,
  SalesOrderStatus,
  SalesOrdersReportQuery,
  ShipmentStatus,
  TopProductRowDto,
  TrendDto,
  TrendQuery,
} from '@stockflow/shared';
import { escapeRegex } from '../../lib/http.js';
import { warehouseLookup, warehouseRef } from '../common/documents.js';
import { Category } from '../categories/categories.js';
import { Product } from '../products/product.model.js';
import { SalesOrder, Shipment } from '../sales/models.js';
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

const SHIPPED = { $in: ['dispatched', 'in_transit', 'delivered'] };
const HOUR = 3_600_000;

/** Orders confirmed and their value (by confirmation date), and units shipped (by dispatch). */
export async function salesTrend(query: TrendQuery): Promise<TrendDto> {
  const range = resolveRange(query);
  const interval = pickInterval(range.days, query.interval);
  const scope = {
    ...(query.customerId ? { 'customer._id': oid(query.customerId) } : {}),
    ...(query.warehouseId ? { warehouseId: oid(query.warehouseId) } : {}),
  };
  const [orders, shipped] = await Promise.all([
    SalesOrder.aggregate<{ _id: string; orders: number; value: number }>([
      { $match: { ...scope, confirmedAt: { $gte: range.from, $lt: range.until } } },
      {
        $group: {
          _id: periodExpr('$confirmedAt', interval),
          orders: { $sum: 1 },
          value: { $sum: '$total' },
        },
      },
    ]),
    Shipment.aggregate<{ _id: string; units: number }>([
      {
        $match: { ...scope, status: SHIPPED, dispatchedAt: { $gte: range.from, $lt: range.until } },
      },
      { $unwind: '$lines' },
      {
        $group: {
          _id: periodExpr('$dispatchedAt', interval),
          units: { $sum: { $ifNull: ['$lines.pickedQuantity', 0] } },
        },
      },
    ]),
  ]);
  return buildTrend(
    range,
    interval,
    [
      { key: 'orders', label: 'Orders confirmed' },
      { key: 'value', label: 'Order value' },
      { key: 'shipped', label: 'Units shipped' },
    ],
    [
      ...orders.flatMap((o) => [
        { period: o._id, key: 'orders', value: o.orders },
        { period: o._id, key: 'value', value: o.value },
      ]),
      ...shipped.map((s) => ({ period: s._id, key: 'shipped', value: s.units })),
    ],
  );
}

/**
 * Products ranked by units dispatched in the range. Revenue uses each order line's net price
 * (after discount, before tax); cost is the average cost recorded at dispatch.
 */
export async function topProducts(query: ReportTableQuery): Promise<TopProductRowDto[]> {
  const range = resolveRange(query);
  const rows = await Shipment.aggregate<{
    _id: Types.ObjectId;
    units: number;
    revenue: number;
    cost: number;
    orders: Types.ObjectId[];
  }>([
    {
      $match: {
        status: SHIPPED,
        dispatchedAt: { $gte: range.from, $lt: range.until },
        ...(query.warehouseId ? { warehouseId: oid(query.warehouseId) } : {}),
        ...(query.customerId ? { 'customer._id': oid(query.customerId) } : {}),
      },
    },
    { $unwind: '$lines' },
    { $match: { 'lines.pickedQuantity': { $gt: 0 } } },
    {
      $lookup: {
        from: 'salesorders',
        localField: 'salesOrder._id',
        foreignField: '_id',
        as: 'order',
        pipeline: [{ $project: { lines: 1 } }],
      },
    },
    {
      $set: {
        soLine: {
          $first: {
            $filter: {
              input: { $ifNull: [{ $first: '$order.lines' }, []] },
              as: 'l',
              cond: { $eq: ['$$l._id', '$lines.soLineId'] },
            },
          },
        },
      },
    },
    {
      $group: {
        _id: '$lines.productId',
        units: { $sum: '$lines.pickedQuantity' },
        revenue: {
          $sum: {
            $round: [
              {
                $multiply: [
                  '$lines.pickedQuantity',
                  { $divide: ['$soLine.lineSubtotal', { $max: ['$soLine.quantity', 1] }] },
                ],
              },
              0,
            ],
          },
        },
        cost: {
          $sum: { $multiply: ['$lines.pickedQuantity', { $ifNull: ['$lines.unitCost', 0] }] },
        },
        orders: { $addToSet: '$salesOrder._id' },
      },
    },
  ]);
  const productFilter: FilterQuery<unknown> = { _id: { $in: rows.map((r) => r._id) } };
  if (query.categoryId) productFilter.categoryId = oid(query.categoryId);
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    productFilter.$or = [{ sku: pattern }, { name: pattern }];
  }
  const [products, categories] = await Promise.all([
    Product.find(productFilter, { sku: 1, name: 1, unit: 1, categoryId: 1 }).lean(),
    Category.find({}, { name: 1 }).lean(),
  ]);
  const productFor = new Map(products.map((p) => [p._id.toString(), p]));
  const categoryFor = new Map(
    categories.map((c) => [c._id.toString(), { id: c._id.toString(), name: c.name }]),
  );
  return rows
    .filter((r) => productFor.has(r._id.toString()))
    .map((r) => {
      const p = productFor.get(r._id.toString())!;
      return {
        product: {
          id: p._id.toString(),
          sku: p.sku,
          name: p.name,
          unit: p.unit,
          category: categoryFor.get(p.categoryId.toString()) ?? null,
        },
        unitsShipped: r.units,
        revenue: r.revenue,
        cost: r.cost,
        orders: r.orders.length,
      };
    })
    .sort((a, b) => b.unitsShipped - a.unitsShipped || b.revenue - a.revenue);
}

/**
 * Fulfilment for orders created in the range: how many were confirmed, completed or
 * cancelled, how long dispatch and delivery took, and on-time delivery against the
 * required date. Shipment counts are for dispatches in the range; open counts are as of now.
 */
export async function fulfilmentStats(query: ReportTableQuery): Promise<FulfilmentStatsDto> {
  const range = resolveRange(query);
  const scope = {
    ...(query.warehouseId ? { warehouseId: oid(query.warehouseId) } : {}),
    ...(query.customerId ? { 'customer._id': oid(query.customerId) } : {}),
  };
  const [orders, dispatched, shortPicks, openOrders, shipmentStatuses] = await Promise.all([
    SalesOrder.find(
      { ...scope, orderDate: { $gte: range.from, $lt: range.until } },
      {
        status: 1,
        confirmedAt: 1,
        requiredDate: 1,
      },
    ).lean(),
    Shipment.aggregate<{ shipments: number; units: number }>([
      {
        $match: { ...scope, status: SHIPPED, dispatchedAt: { $gte: range.from, $lt: range.until } },
      },
      {
        $group: {
          _id: null,
          shipments: { $sum: 1 },
          units: { $sum: { $sum: '$lines.pickedQuantity' } },
        },
      },
    ]),
    Shipment.countDocuments({
      ...scope,
      pickedAt: { $gte: range.from, $lt: range.until },
      shortPickReason: { $ne: '' },
    }),
    SalesOrder.aggregate<{ _id: SalesOrderStatus; count: number }>([
      {
        $match: {
          ...scope,
          status: { $in: ['draft', 'confirmed', 'partially_shipped', 'shipped'] },
        },
      },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Shipment.aggregate<{ _id: ShipmentStatus; count: number }>([
      {
        $match: {
          ...scope,
          status: { $in: ['picking', 'picked', 'packed', 'dispatched', 'in_transit'] },
        },
      },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const confirmed = orders.filter((o) => o.confirmedAt);
  const shipments = await Shipment.find(
    { 'salesOrder._id': { $in: confirmed.map((o) => o._id) }, status: SHIPPED },
    { 'salesOrder._id': 1, dispatchedAt: 1, deliveredAt: 1, status: 1 },
  ).lean();
  const bySo = new Map<string, typeof shipments>();
  for (const s of shipments) {
    const key = s.salesOrder._id!.toString();
    bySo.set(key, [...(bySo.get(key) ?? []), s]);
  }

  const toDispatch: number[] = [];
  const toDeliver: number[] = [];
  let deliveredWithDate = 0;
  let onTime = 0;
  for (const o of confirmed) {
    const list = bySo.get(o._id.toString()) ?? [];
    const firstDispatch = Math.min(...list.map((s) => s.dispatchedAt?.getTime() ?? Infinity));
    if (Number.isFinite(firstDispatch))
      toDispatch.push((firstDispatch - o.confirmedAt!.getTime()) / HOUR);
    if (o.status === 'delivered') {
      const lastDelivery = Math.max(...list.map((s) => s.deliveredAt?.getTime() ?? 0));
      if (lastDelivery > 0) {
        toDeliver.push((lastDelivery - o.confirmedAt!.getTime()) / (24 * HOUR));
        if (o.requiredDate) {
          deliveredWithDate += 1;
          if (
            new Date(lastDelivery).toISOString().slice(0, 10) <=
            o.requiredDate.toISOString().slice(0, 10)
          ) {
            onTime += 1;
          }
        }
      }
    }
  }
  const mean = (values: number[]) =>
    values.length > 0 ? round(values.reduce((s, v) => s + v, 0) / values.length) : null;

  return {
    ordersCreated: orders.length,
    ordersConfirmed: confirmed.length,
    ordersCompleted: orders.filter((o) => o.status === 'shipped' || o.status === 'delivered')
      .length,
    ordersCancelled: orders.filter((o) => o.status === 'cancelled').length,
    unitsShipped: dispatched[0]?.units ?? 0,
    shipmentsDispatched: dispatched[0]?.shipments ?? 0,
    shortPicks,
    averageHoursToDispatch: mean(toDispatch),
    averageDaysToDeliver: mean(toDeliver),
    onTimeDeliveryRate: ratio(onTime, deliveredWithDate),
    openByStatus: Object.fromEntries(openOrders.map((r) => [r._id, r.count])),
    shipmentsByStatus: Object.fromEntries(shipmentStatuses.map((r) => [r._id, r.count])),
  };
}

const PENDING: SalesOrderStatus[] = ['draft', 'confirmed', 'partially_shipped'];
const COMPLETED: SalesOrderStatus[] = ['shipped', 'delivered'];

/** Orders created in the range, pending (not yet fully shipped) or completed. */
export async function salesOrdersReport(query: SalesOrdersReportQuery, all: boolean) {
  const range = resolveRange(query);
  const filter: FilterQuery<unknown> = { orderDate: { $gte: range.from, $lt: range.until } };
  filter.status =
    query.state === 'pending'
      ? { $in: PENDING }
      : query.state === 'completed'
        ? { $in: COMPLETED }
        : { $ne: 'cancelled' };
  if (query.customerId) filter['customer._id'] = oid(query.customerId);
  if (query.warehouseId) filter.warehouseId = oid(query.warehouseId);
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [
      { number: pattern },
      { 'customer.name': pattern },
      { customerReference: pattern },
    ];
  }
  const [rows, total] = await Promise.all([
    SalesOrder.find(filter)
      .sort({ orderDate: -1, _id: -1 })
      .skip(all ? 0 : (query.page - 1) * query.pageSize)
      .limit(all ? CSV_ROW_LIMIT : query.pageSize)
      .lean(),
    SalesOrder.countDocuments(filter),
  ]);
  const warehouses = await warehouseLookup(rows.map((r) => r.warehouseId));
  const today = new Date().toISOString().slice(0, 10);
  const data: SalesOrderReportRowDto[] = rows.map((so) => {
    const sum = (pick: (l: (typeof so.lines)[number]) => number) =>
      so.lines.reduce((s, l) => s + pick(l), 0);
    const required = dateOnly(so.requiredDate);
    return {
      salesOrder: { id: so._id.toString(), number: so.number },
      customer: {
        id: so.customer._id.toString(),
        code: so.customer.code ?? '',
        name: so.customer.name ?? '',
      },
      warehouse: warehouseRef(warehouses, so.warehouseId),
      status: so.status as SalesOrderStatus,
      orderDate: so.orderDate.toISOString(),
      requiredDate: required,
      ordered: sum((l) => l.quantity - l.cancelledQuantity),
      shipped: sum((l) => l.shippedQuantity),
      delivered: sum((l) => l.deliveredQuantity),
      total: so.total,
      isOverdue:
        ['confirmed', 'partially_shipped'].includes(so.status) &&
        required !== null &&
        required < today,
    };
  });
  return { data, meta: { page: query.page, pageSize: query.pageSize, total } };
}
