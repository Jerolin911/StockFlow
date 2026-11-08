import type { FilterQuery, Types } from 'mongoose';
import {
  FAST_MOVING_DAYS,
  SLOW_MOVING_DAYS,
  type AvailabilityReportQuery,
  type AvailabilityRowDto,
  type CategoryReportRowDto,
  type MovementClass,
  type OverviewDto,
  type TrendDto,
  type TrendQuery,
  type VelocityQuery,
  type VelocityRowDto,
  type WarehouseStockDto,
} from '@stockflow/shared';
import { escapeRegex } from '../../lib/http.js';
import { Category } from '../categories/categories.js';
import { PurchaseOrder } from '../purchasing/models.js';
import { Product, type ProductRecord } from '../products/product.model.js';
import { SalesOrder, Shipment } from '../sales/models.js';
import { hasUnallocated } from '../sales/sales-orders.js';
import { StockLevel } from '../stock/stock-level.model.js';
import { StockMovement } from '../stock/stock-movement.model.js';
import { levelStages, listMovements } from '../stock/stock.queries.js';
import { StockTransfer } from '../warehouse-ops/models.js';
import { Warehouse } from '../warehouses/warehouse.model.js';
import {
  buildTrend,
  oid,
  periodExpr,
  pickInterval,
  resolveRange,
  round,
  type ResolvedRange,
} from './common.js';

const USABLE = { bucket: { $ne: 'quarantine' } };

/** Per warehouse stock, low and out-of-stock counts, and value when allowed. */
export async function warehouseStock(withValue: boolean): Promise<WarehouseStockDto[]> {
  const [warehouses, rows] = await Promise.all([
    Warehouse.find({}, { code: 1, name: 1, isActive: 1 }).sort({ code: 1 }).lean(),
    StockLevel.aggregate<{
      _id: Types.ObjectId;
      skus: number;
      onHand: number;
      reserved: number;
      available: number;
      quarantine: number;
      value: number;
      lowStock: number;
      outOfStock: number;
    }>([
      ...levelStages({}),
      {
        $group: {
          _id: '$warehouseId',
          skus: {
            $sum: {
              $cond: [{ $gt: [{ $add: ['$onHand', { $ifNull: ['$quarantine', 0] }] }, 0] }, 1, 0],
            },
          },
          onHand: { $sum: '$onHand' },
          reserved: { $sum: '$reserved' },
          available: { $sum: '$available' },
          quarantine: { $sum: { $ifNull: ['$quarantine', 0] } },
          value: { $sum: { $multiply: ['$onHand', '$product.avgCost'] } },
          lowStock: { $sum: { $cond: ['$isLow', 1, 0] } },
          outOfStock: {
            $sum: {
              $cond: [{ $and: ['$product.isActive', { $lte: ['$available', 0] }] }, 1, 0],
            },
          },
        },
      },
    ]),
  ]);
  const byId = new Map(rows.map((r) => [r._id.toString(), r]));
  return warehouses.map((w) => {
    const r = byId.get(w._id.toString());
    return {
      warehouse: { id: w._id.toString(), code: w.code, name: w.name, isActive: w.isActive },
      skus: r?.skus ?? 0,
      onHand: r?.onHand ?? 0,
      reserved: r?.reserved ?? 0,
      available: r?.available ?? 0,
      quarantine: r?.quarantine ?? 0,
      value: withValue ? (r?.value ?? 0) : null,
      lowStock: w.isActive ? (r?.lowStock ?? 0) : 0,
      outOfStock: w.isActive ? (r?.outOfStock ?? 0) : 0,
    };
  });
}

/** Everything on the dashboard, from live records. Value figures need reports:inventory. */
export async function overview(withValue: boolean): Promise<OverviewDto> {
  const open = { $in: ['approved', 'partially_received'] };
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const [
    active,
    inactive,
    warehouses,
    pendingApproval,
    openOrders,
    overdue,
    pendingUnits,
    toConfirm,
    openSales,
    awaitingFulfilment,
    inTransit,
    movements,
  ] = await Promise.all([
    Product.countDocuments({ isActive: true }),
    Product.countDocuments({ isActive: false }),
    warehouseStock(true),
    PurchaseOrder.countDocuments({ status: 'pending_approval' }),
    PurchaseOrder.countDocuments({ status: open }),
    PurchaseOrder.countDocuments({ status: open, expectedDate: { $ne: null, $lt: today } }),
    PurchaseOrder.aggregate<{ total: number }>([
      { $match: { status: open } },
      { $unwind: '$lines' },
      {
        $group: {
          _id: null,
          total: {
            $sum: { $max: [{ $subtract: ['$lines.quantity', '$lines.receivedQuantity'] }, 0] },
          },
        },
      },
    ]),
    SalesOrder.countDocuments({ status: 'draft' }),
    SalesOrder.countDocuments({ status: { $in: ['confirmed', 'partially_shipped'] } }),
    SalesOrder.countDocuments({
      status: { $in: ['confirmed', 'partially_shipped'] },
      $expr: hasUnallocated,
    }),
    Shipment.countDocuments({ status: { $in: ['dispatched', 'in_transit'] } }),
    listMovements({ page: 1, pageSize: 10 }),
  ]);
  const activeWarehouses = warehouses.filter((w) => w.warehouse.isActive);
  const sum = (pick: (w: WarehouseStockDto) => number) =>
    activeWarehouses.reduce((s, w) => s + pick(w), 0);
  return {
    products: { active, inactive },
    stock: {
      onHand: sum((w) => w.onHand),
      reserved: sum((w) => w.reserved),
      available: sum((w) => w.available),
      quarantine: sum((w) => w.quarantine),
      value: withValue ? sum((w) => w.value ?? 0) : null,
    },
    lowStock: sum((w) => w.lowStock),
    outOfStock: sum((w) => w.outOfStock),
    warehouses: withValue ? warehouses : warehouses.map((w) => ({ ...w, value: null })),
    purchasing: {
      pendingApproval,
      open: openOrders,
      overdue,
      pendingUnits: pendingUnits[0]?.total ?? 0,
    },
    sales: { toConfirm, open: openSales, awaitingFulfilment, inTransit },
    recentMovements: movements.data,
  };
}

async function productIdsIn(categoryId: string | undefined) {
  if (!categoryId) return null;
  return (await Product.find({ categoryId: oid(categoryId) }, { _id: 1 }).lean()).map((p) => p._id);
}

/** Usable stock in and out per period (transfers count at both ends without a warehouse filter). */
export async function movementTrend(query: TrendQuery): Promise<TrendDto> {
  const range = resolveRange(query);
  const interval = pickInterval(range.days, query.interval);
  const products = await productIdsIn(query.categoryId);
  const match: FilterQuery<unknown> = {
    ...USABLE,
    createdAt: { $gte: range.from, $lt: range.until },
    ...(query.warehouseId ? { warehouseId: oid(query.warehouseId) } : {}),
    ...(products ? { productId: { $in: products } } : {}),
  };
  const rows = await StockMovement.aggregate<{
    _id: { period: string; key: string };
    value: number;
  }>([
    { $match: match },
    {
      $group: {
        _id: {
          period: periodExpr('$createdAt', interval),
          key: { $cond: [{ $gt: ['$quantity', 0] }, 'in', 'out'] },
        },
        value: { $sum: { $abs: '$quantity' } },
      },
    },
  ]);
  return buildTrend(
    range,
    interval,
    [
      { key: 'in', label: 'Units in' },
      { key: 'out', label: 'Units out' },
    ],
    rows.map((r) => ({ period: r._id.period, key: r._id.key, value: r.value })),
  );
}

interface ProductTotals {
  onHand: number;
  reserved: number;
  available: number;
  quarantine: number;
}

/** Stock per product, across warehouses or for one. */
async function stockByProduct(warehouseId?: string) {
  const rows = await StockLevel.aggregate<ProductTotals & { _id: Types.ObjectId }>([
    { $match: warehouseId ? { warehouseId: oid(warehouseId) } : {} },
    {
      $group: {
        _id: '$productId',
        onHand: { $sum: '$onHand' },
        reserved: { $sum: '$reserved' },
        available: { $sum: { $subtract: ['$onHand', '$reserved'] } },
        quarantine: { $sum: { $ifNull: ['$quarantine', 0] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r]));
}

/** Units received (RECEIPT) and shipped (SHIPMENT) per product in a range. */
async function flowsByProduct(range: ResolvedRange, warehouseId?: string) {
  const rows = await StockMovement.aggregate<{
    _id: Types.ObjectId;
    unitsIn: number;
    unitsOut: number;
  }>([
    {
      $match: {
        type: { $in: ['RECEIPT', 'SHIPMENT'] },
        createdAt: { $gte: range.from, $lt: range.until },
        ...(warehouseId ? { warehouseId: oid(warehouseId) } : {}),
      },
    },
    {
      $group: {
        _id: '$productId',
        unitsIn: { $sum: { $cond: [{ $eq: ['$type', 'RECEIPT'] }, '$quantity', 0] } },
        unitsOut: { $sum: { $cond: [{ $eq: ['$type', 'SHIPMENT'] }, { $abs: '$quantity' }, 0] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r]));
}

async function productsFor(query: {
  search?: string | undefined;
  categoryId?: string | undefined;
}) {
  const filter: FilterQuery<ProductRecord> = { isActive: true };
  if (query.categoryId) filter.categoryId = oid(query.categoryId);
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ sku: pattern }, { name: pattern }];
  }
  const [products, categories] = await Promise.all([
    Product.find(filter).sort({ sku: 1 }).lean(),
    Category.find({}, { name: 1 }).lean(),
  ]);
  const categoryFor = new Map(
    categories.map((c) => [c._id.toString(), { id: c._id.toString(), name: c.name }]),
  );
  return products.map((p) => ({
    record: p,
    ref: {
      id: p._id.toString(),
      sku: p.sku,
      name: p.name,
      unit: p.unit,
      category: categoryFor.get(p.categoryId.toString()) ?? null,
    },
  }));
}

export function classify(
  onHand: number,
  unitsOut: number,
  daysOfCover: number | null,
): MovementClass {
  if (unitsOut === 0) return onHand > 0 ? 'slow' : 'none';
  if (daysOfCover! <= FAST_MOVING_DAYS) return 'fast';
  if (daysOfCover! > SLOW_MOVING_DAYS) return 'slow';
  return 'normal';
}

/**
 * Fast and slow movers: shipments over the range as a daily rate, and how many days the
 * stock on hand would last at that rate.
 */
export async function velocity(query: VelocityQuery): Promise<VelocityRowDto[]> {
  const range = resolveRange(query);
  const [products, stock, flows] = await Promise.all([
    productsFor(query),
    stockByProduct(query.warehouseId),
    flowsByProduct(range, query.warehouseId),
  ]);
  const rows = products.map(({ ref }) => {
    const s = stock.get(ref.id);
    const f = flows.get(ref.id);
    const onHand = s?.onHand ?? 0;
    const unitsOut = f?.unitsOut ?? 0;
    const dailyRate = unitsOut / range.days;
    const daysOfCover = unitsOut > 0 ? round(onHand / dailyRate) : null;
    return {
      product: ref,
      onHand,
      available: s?.available ?? 0,
      unitsIn: f?.unitsIn ?? 0,
      unitsOut,
      dailyRate: round(dailyRate, 2),
      daysOfCover,
      movement: classify(onHand, unitsOut, daysOfCover),
    };
  });
  return rows
    .filter((r) => !query.movement || r.movement === query.movement)
    .sort((a, b) => b.unitsOut - a.unitsOut || a.product.sku.localeCompare(b.product.sku));
}

/** Per product: on hand, reserved, available, quarantined, incoming on POs and in transit. */
export async function availability(query: AvailabilityReportQuery): Promise<AvailabilityRowDto[]> {
  const warehouse = query.warehouseId ? oid(query.warehouseId) : null;
  const [products, stock, incoming, inTransit, overrides] = await Promise.all([
    productsFor(query),
    stockByProduct(query.warehouseId),
    PurchaseOrder.aggregate<{ _id: Types.ObjectId; units: number }>([
      {
        $match: {
          status: { $in: ['approved', 'partially_received'] },
          ...(warehouse ? { warehouseId: warehouse } : {}),
        },
      },
      { $unwind: '$lines' },
      {
        $group: {
          _id: '$lines.productId',
          units: {
            $sum: { $max: [{ $subtract: ['$lines.quantity', '$lines.receivedQuantity'] }, 0] },
          },
        },
      },
    ]),
    StockTransfer.aggregate<{ _id: Types.ObjectId; units: number }>([
      {
        $match: {
          status: { $in: ['in_transit', 'partially_received'] },
          ...(warehouse ? { toWarehouseId: warehouse } : {}),
        },
      },
      { $unwind: '$lines' },
      {
        $group: {
          _id: '$lines.productId',
          units: {
            $sum: {
              $subtract: [
                '$lines.dispatchedQuantity',
                {
                  $add: [
                    '$lines.receivedQuantity',
                    '$lines.damagedQuantity',
                    '$lines.lostQuantity',
                  ],
                },
              ],
            },
          },
        },
      },
    ]),
    warehouse
      ? StockLevel.find(
          { warehouseId: warehouse, reorderPoint: { $ne: null } },
          { productId: 1, reorderPoint: 1 },
        ).lean()
      : Promise.resolve([]),
  ]);
  const incomingFor = new Map(incoming.map((r) => [r._id.toString(), r.units]));
  const transitFor = new Map(inTransit.map((r) => [r._id.toString(), r.units]));
  const overrideFor = new Map(overrides.map((o) => [o.productId.toString(), o.reorderPoint ?? 0]));
  const rows = products.map(({ record, ref }) => {
    const s = stock.get(ref.id);
    const available = s?.available ?? 0;
    const reorderPoint = overrideFor.get(ref.id) ?? record.reorderPoint;
    const status: AvailabilityRowDto['status'] =
      available <= 0 ? 'out' : reorderPoint > 0 && available <= reorderPoint ? 'low' : 'available';
    return {
      product: ref,
      onHand: s?.onHand ?? 0,
      reserved: s?.reserved ?? 0,
      available,
      quarantine: s?.quarantine ?? 0,
      incoming: incomingFor.get(ref.id) ?? 0,
      inTransit: transitFor.get(ref.id) ?? 0,
      reorderPoint,
      status,
    };
  });
  return rows.filter((r) => !query.status || r.status === query.status);
}

/** Per category: products, stock, value and flows in the range. */
export async function categoryReport(query: TrendQuery): Promise<CategoryReportRowDto[]> {
  const range = resolveRange(query);
  const [categories, products, stock, flows] = await Promise.all([
    Category.find({}, { name: 1 }).sort({ name: 1 }).lean(),
    Product.find({ isActive: true }, { categoryId: 1, avgCost: 1 }).lean(),
    stockByProduct(query.warehouseId),
    flowsByProduct(range, query.warehouseId),
  ]);
  const totals = new Map<string, CategoryReportRowDto>();
  for (const c of categories) {
    totals.set(c._id.toString(), {
      category: { id: c._id.toString(), name: c.name },
      products: 0,
      onHand: 0,
      available: 0,
      value: 0,
      unitsIn: 0,
      unitsOut: 0,
    });
  }
  for (const p of products) {
    const row = totals.get(p.categoryId.toString());
    if (!row) continue;
    const s = stock.get(p._id.toString());
    const f = flows.get(p._id.toString());
    row.products += 1;
    row.onHand += s?.onHand ?? 0;
    row.available += s?.available ?? 0;
    row.value += (s?.onHand ?? 0) * p.avgCost;
    row.unitsIn += f?.unitsIn ?? 0;
    row.unitsOut += f?.unitsOut ?? 0;
  }
  return [...totals.values()];
}
