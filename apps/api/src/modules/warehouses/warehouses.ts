import { Router } from 'express';
import { Types, type FilterQuery, type PipelineStage } from 'mongoose';
import {
  createWarehouseSchema,
  listWarehousesQuerySchema,
  updateWarehouseSchema,
  type ListWarehousesQuery,
  type WarehouseDto,
} from '@stockflow/shared';
import { AppError, invalidState, isDuplicateKeyError, notFound } from '../../lib/errors.js';
import { escapeRegex, parseId } from '../../lib/http.js';
import { pageResult, paginateStages } from '../../lib/pagination.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { StockLevel } from '../stock/stock-level.model.js';
import { Warehouse, type WarehouseRecord } from './warehouse.model.js';

type WarehouseRow = WarehouseRecord & { stock?: { skuCount: number; onHand: number } };

const codeTaken = () =>
  new AppError(409, 'CONFLICT', 'A warehouse with this code already exists', [
    { path: 'code', message: 'This code is already in use' },
  ]);

function toDto(row: WarehouseRow): WarehouseDto {
  return {
    id: row._id.toString(),
    code: row.code,
    name: row.name,
    address: row.address,
    isActive: row.isActive,
    stock: row.stock ?? { skuCount: 0, onHand: 0 },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const stockSummaryStages: PipelineStage.FacetPipelineStage[] = [
  {
    $lookup: {
      from: 'stocklevels',
      localField: '_id',
      foreignField: 'warehouseId',
      as: 'levels',
      pipeline: [{ $match: { onHand: { $gt: 0 } } }, { $project: { onHand: 1 } }],
    },
  },
  {
    $addFields: {
      stock: { skuCount: { $size: '$levels' }, onHand: { $sum: '$levels.onHand' } },
    },
  },
  { $project: { levels: 0 } },
];

export async function listWarehouses(query: ListWarehousesQuery) {
  const filter: FilterQuery<WarehouseRecord> = {};
  if (query.status) filter.isActive = query.status === 'active';
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ name: pattern }, { code: pattern }];
  }
  const result = await Warehouse.aggregate([
    { $match: filter },
    { $sort: { isActive: -1, name: 1, _id: 1 } },
    ...paginateStages(query, stockSummaryStages),
  ]);
  return pageResult(result, query, toDto);
}

async function getWarehouse(id: string): Promise<WarehouseDto> {
  const [row] = await Warehouse.aggregate<WarehouseRow>([
    { $match: { _id: new Types.ObjectId(id) } },
    ...stockSummaryStages,
  ]);
  if (!row) throw notFound('Warehouse');
  return toDto(row);
}

export function createWarehousesRouter(): Router {
  const router = Router();
  router.use(authenticate());

  router.get('/', async (req, res) => {
    res.json(await listWarehouses(listWarehousesQuerySchema.parse(req.query)));
  });

  router.get('/:id', async (req, res) => {
    res.json({ data: await getWarehouse(parseId(req.params.id, 'Warehouse')) });
  });

  router.post('/', authorize('warehouses:manage'), async (req, res) => {
    const input = createWarehouseSchema.parse(req.body);
    try {
      const warehouse = await Warehouse.create(input);
      res.status(201).json({ data: await getWarehouse(warehouse.id as string) });
    } catch (error) {
      if (isDuplicateKeyError(error)) throw codeTaken();
      throw error;
    }
  });

  router.patch('/:id', authorize('warehouses:manage'), async (req, res) => {
    const id = parseId(req.params.id, 'Warehouse');
    const input = updateWarehouseSchema.parse(req.body);
    const warehouse = await Warehouse.findById(id);
    if (!warehouse) throw notFound('Warehouse');

    if (input.isActive === false && warehouse.isActive) {
      const holding = await StockLevel.exists({
        warehouseId: warehouse._id,
        $or: [{ onHand: { $gt: 0 } }, { reserved: { $gt: 0 } }],
      });
      if (holding) {
        throw invalidState(
          'This warehouse still holds stock. Adjust it to zero before deactivating.',
        );
      }
    }

    warehouse.set(input);
    try {
      await warehouse.save();
    } catch (error) {
      if (isDuplicateKeyError(error)) throw codeTaken();
      throw error;
    }
    res.json({ data: await getWarehouse(id) });
  });

  return router;
}
