import { Types, type FilterQuery, type PipelineStage } from 'mongoose';
import type {
  ProductAvailabilityDto,
  ListAdjustmentsQuery,
  ListMovementsQuery,
  ListStockLevelsQuery,
  StockAdjustmentDto,
  StockLevelDto,
  StockMovementDto,
} from '@stockflow/shared';
import { notFound } from '../../lib/errors.js';
import { escapeRegex } from '../../lib/http.js';
import { pageResult, paginateStages } from '../../lib/pagination.js';
import { StockAdjustment } from './stock-adjustment.model.js';
import { StockLevel } from './stock-level.model.js';
import { StockMovement } from './stock-movement.model.js';
import { Warehouse } from '../warehouses/warehouse.model.js';

const oid = (id: string) => new Types.ObjectId(id);

interface LevelRow {
  _id: Types.ObjectId;
  onHand: number;
  reserved: number;
  available: number;
  threshold: number;
  reorderPoint: number | null;
  isLow: boolean;
  updatedAt: Date;
  product: {
    _id: Types.ObjectId;
    sku: string;
    name: string;
    unit: StockLevelDto['product']['unit'];
    isActive: boolean;
    categoryName: string | null;
  };
  warehouse: { _id: Types.ObjectId; code: string; name: string };
}

const toLevelDto = (row: LevelRow): StockLevelDto => ({
  id: row._id.toString(),
  product: {
    id: row.product._id.toString(),
    sku: row.product.sku,
    name: row.product.name,
    unit: row.product.unit,
    isActive: row.product.isActive,
    categoryName: row.product.categoryName,
  },
  warehouse: {
    id: row.warehouse._id.toString(),
    code: row.warehouse.code,
    name: row.warehouse.name,
  },
  onHand: row.onHand,
  reserved: row.reserved,
  available: row.available,
  reorderPoint: row.threshold,
  reorderPointOverride: row.reorderPoint,
  isLow: row.isLow,
  updatedAt: row.updatedAt.toISOString(),
});

const LEVEL_SORT: Record<string, string> = {
  sku: 'product.sku',
  name: 'product.name',
  onHand: 'onHand',
  available: 'available',
};

function levelStages(match: FilterQuery<unknown>): PipelineStage[] {
  return [
    { $match: match },
    {
      $lookup: {
        from: 'products',
        localField: 'productId',
        foreignField: '_id',
        as: 'product',
        pipeline: [
          { $project: { sku: 1, name: 1, unit: 1, isActive: 1, categoryId: 1, reorderPoint: 1 } },
        ],
      },
    },
    { $unwind: '$product' },
    {
      $lookup: {
        from: 'warehouses',
        localField: 'warehouseId',
        foreignField: '_id',
        as: 'warehouse',
        pipeline: [{ $project: { code: 1, name: 1, isActive: 1 } }],
      },
    },
    { $unwind: '$warehouse' },
    {
      $addFields: {
        available: { $subtract: ['$onHand', '$reserved'] },
        threshold: { $ifNull: ['$reorderPoint', '$product.reorderPoint'] },
      },
    },
    {
      $addFields: {
        isLow: {
          $and: [
            '$warehouse.isActive',
            { $gt: ['$threshold', 0] },
            { $lte: ['$available', '$threshold'] },
          ],
        },
      },
    },
  ];
}

const categoryNameStages: PipelineStage.FacetPipelineStage[] = [
  {
    $lookup: {
      from: 'categories',
      localField: 'product.categoryId',
      foreignField: '_id',
      as: 'category',
      pipeline: [{ $project: { name: 1 } }],
    },
  },
  { $set: { 'product.categoryName': { $ifNull: [{ $first: '$category.name' }, null] } } },
];

export async function listStockLevels(query: ListStockLevelsQuery) {
  const match: FilterQuery<unknown> = {};
  if (query.warehouseId) match.warehouseId = oid(query.warehouseId);
  if (query.productId) match.productId = oid(query.productId);

  const after: Record<string, unknown> = {};
  if (query.categoryId) after['product.categoryId'] = oid(query.categoryId);
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    after.$or = [{ 'product.sku': pattern }, { 'product.name': pattern }];
  }
  if (query.status === 'low') after.isLow = true;
  if (query.status === 'out') after.available = { $lte: 0 };
  if (query.status === 'available') after.available = { $gt: 0 };

  const desc = query.sort.startsWith('-');
  const sortField = LEVEL_SORT[desc ? query.sort.slice(1) : query.sort] ?? 'product.sku';

  const result = await StockLevel.aggregate([
    ...levelStages(match),
    { $match: after },
    { $sort: { [sortField]: desc ? -1 : 1, 'warehouse.code': 1, _id: 1 } },
    ...paginateStages(query, categoryNameStages),
  ]);
  return pageResult(result, query, toLevelDto);
}

export async function getStockLevel(id: string): Promise<StockLevelDto> {
  const [row] = await StockLevel.aggregate<LevelRow>([
    ...levelStages({ _id: oid(id) }),
    ...categoryNameStages,
  ]);
  if (!row) throw notFound('Stock level');
  return toLevelDto(row);
}

interface PopulatedMovement {
  _id: Types.ObjectId;
  type: StockMovementDto['type'];
  quantity: number;
  balanceAfter: number;
  unitCost: number;
  productId: {
    _id: Types.ObjectId;
    sku: string;
    name: string;
    unit: StockMovementDto['product']['unit'];
  };
  warehouseId: { _id: Types.ObjectId; code: string; name: string };
  reference: { type: StockMovementDto['reference']['type']; id: Types.ObjectId; number: string };
  createdBy: { _id: Types.ObjectId; name: string } | null;
  createdAt: Date;
}

export async function listMovements(query: ListMovementsQuery) {
  const filter: FilterQuery<unknown> = {};
  if (query.productId) filter.productId = oid(query.productId);
  if (query.warehouseId) filter.warehouseId = oid(query.warehouseId);
  if (query.type) filter.type = query.type;
  if (query.direction) filter.quantity = query.direction === 'in' ? { $gt: 0 } : { $lt: 0 };
  if (query.from || query.to) {
    filter.createdAt = {
      ...(query.from ? { $gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
      ...(query.to ? { $lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
    };
  }

  const [rows, total] = await Promise.all([
    StockMovement.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .populate('productId', 'sku name unit')
      .populate('warehouseId', 'code name')
      .populate('createdBy', 'name')
      .lean<PopulatedMovement[]>(),
    StockMovement.countDocuments(filter),
  ]);

  return {
    data: rows.map((row): StockMovementDto => ({
      id: row._id.toString(),
      type: row.type,
      quantity: row.quantity,
      balanceAfter: row.balanceAfter,
      unitCost: row.unitCost,
      product: {
        id: row.productId._id.toString(),
        sku: row.productId.sku,
        name: row.productId.name,
        unit: row.productId.unit,
      },
      warehouse: {
        id: row.warehouseId._id.toString(),
        code: row.warehouseId.code,
        name: row.warehouseId.name,
      },
      reference: {
        type: row.reference.type,
        id: row.reference.id.toString(),
        number: row.reference.number,
      },
      createdBy: row.createdBy
        ? { id: row.createdBy._id.toString(), name: row.createdBy.name }
        : { id: '', name: 'Unknown user' },
      createdAt: row.createdAt.toISOString(),
    })),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

interface PopulatedAdjustment {
  _id: Types.ObjectId;
  number: string;
  type: StockAdjustmentDto['type'];
  warehouseId: { _id: Types.ObjectId; code: string; name: string };
  reason: StockAdjustmentDto['reason'];
  notes: string;
  lines: (Omit<StockAdjustmentDto['lines'][number], 'productId'> & { productId: Types.ObjectId })[];
  createdBy: { _id: Types.ObjectId; name: string } | null;
  createdAt: Date;
}

function toAdjustmentDto(row: PopulatedAdjustment): StockAdjustmentDto {
  const lines = row.lines.map((line) => ({
    productId: line.productId.toString(),
    sku: line.sku,
    name: line.name,
    unit: line.unit,
    quantityChange: line.quantityChange,
    previousOnHand: line.previousOnHand,
    balanceAfter: line.balanceAfter,
    unitCost: line.unitCost,
  }));
  return {
    id: row._id.toString(),
    number: row.number,
    type: row.type,
    warehouse: {
      id: row.warehouseId._id.toString(),
      code: row.warehouseId.code,
      name: row.warehouseId.name,
    },
    reason: row.reason ?? null,
    notes: row.notes,
    lines,
    totalIn: lines.reduce((sum, l) => sum + Math.max(l.quantityChange, 0), 0),
    totalOut: lines.reduce((sum, l) => sum + Math.max(-l.quantityChange, 0), 0),
    createdBy: row.createdBy
      ? { id: row.createdBy._id.toString(), name: row.createdBy.name }
      : { id: '', name: 'Unknown user' },
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listAdjustments(query: ListAdjustmentsQuery) {
  const filter: FilterQuery<unknown> = {};
  if (query.warehouseId) filter.warehouseId = oid(query.warehouseId);
  if (query.type) filter.type = query.type;

  const [rows, total] = await Promise.all([
    StockAdjustment.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .populate('warehouseId', 'code name')
      .populate('createdBy', 'name')
      .lean<PopulatedAdjustment[]>(),
    StockAdjustment.countDocuments(filter),
  ]);
  return {
    data: rows.map(toAdjustmentDto),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

export async function getAdjustment(id: string): Promise<StockAdjustmentDto> {
  const row = await StockAdjustment.findById(id)
    .populate('warehouseId', 'code name')
    .populate('createdBy', 'name')
    .lean<PopulatedAdjustment>();
  if (!row) throw notFound('Stock adjustment');
  return toAdjustmentDto(row);
}

/** On-hand, reserved and available per warehouse for each product, zeros included. */
export async function productAvailability(productIds: string[]): Promise<ProductAvailabilityDto[]> {
  const [warehouses, levels] = await Promise.all([
    Warehouse.find({}, { code: 1, name: 1, isActive: 1 }).sort({ code: 1 }).lean(),
    StockLevel.find({ productId: { $in: productIds.map(oid) } }).lean(),
  ]);
  const byKey = new Map(
    levels.map((l) => [`${l.productId.toString()}:${l.warehouseId.toString()}`, l]),
  );
  return productIds.map((productId) => ({
    productId,
    warehouses: warehouses
      .map((w) => {
        const level = byKey.get(`${productId}:${w._id.toString()}`);
        const onHand = level?.onHand ?? 0;
        const reserved = level?.reserved ?? 0;
        return {
          warehouse: { id: w._id.toString(), code: w.code, name: w.name, isActive: w.isActive },
          onHand,
          reserved,
          available: onHand - reserved,
        };
      })
      .filter((w) => w.warehouse.isActive || w.onHand > 0),
  }));
}
