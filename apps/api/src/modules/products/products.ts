import { Router } from 'express';
import { Types, type FilterQuery, type PipelineStage } from 'mongoose';
import {
  createProductSchema,
  listProductsQuerySchema,
  updateProductSchema,
  type ListProductsQuery,
  type ProductDto,
} from '@stockflow/shared';
import { nextSequence } from '../../lib/counters.js';
import { AppError, fieldError, isDuplicateKeyError, notFound } from '../../lib/errors.js';
import { escapeRegex, parseId, parseSort } from '../../lib/http.js';
import { pageResult, paginateStages } from '../../lib/pagination.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { Category } from '../categories/categories.js';
import { Product, type ProductRecord } from './product.model.js';

type ProductRow = ProductRecord & {
  category: { _id: Types.ObjectId; name: string; code: string } | null;
  stock: ProductDto['stock'];
};

function toDto(row: ProductRow): ProductDto {
  return {
    id: row._id.toString(),
    sku: row.sku,
    name: row.name,
    description: row.description,
    category: row.category
      ? { id: row.category._id.toString(), name: row.category.name, code: row.category.code }
      : null,
    unit: row.unit,
    barcode: row.barcode,
    costPrice: row.costPrice,
    sellingPrice: row.sellingPrice,
    taxRate: row.taxRate,
    avgCost: row.avgCost,
    reorderPoint: row.reorderPoint,
    reorderQuantity: row.reorderQuantity,
    isActive: row.isActive,
    stock: row.stock,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Adds per-product stock totals. Low stock is judged per warehouse that holds the product
 * (has a stock record), using the warehouse override or else the product's reorder point.
 */
function stockSummaryStages(warehouseId?: string): PipelineStage[] {
  return [
    {
      $lookup: {
        from: 'stocklevels',
        let: { productId: '$_id', productReorderPoint: '$reorderPoint' },
        as: 'levels',
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$productId', '$$productId'] },
              ...(warehouseId ? { warehouseId: new Types.ObjectId(warehouseId) } : {}),
            },
          },
          {
            $lookup: {
              from: 'warehouses',
              localField: 'warehouseId',
              foreignField: '_id',
              as: 'w',
            },
          },
          { $match: { 'w.isActive': true } },
          {
            $project: {
              onHand: 1,
              reserved: 1,
              available: { $subtract: ['$onHand', '$reserved'] },
              threshold: { $ifNull: ['$reorderPoint', '$$productReorderPoint'] },
            },
          },
        ],
      },
    },
    {
      $addFields: {
        stock: {
          onHand: { $sum: '$levels.onHand' },
          reserved: { $sum: '$levels.reserved' },
          available: { $sum: '$levels.available' },
          stockedWarehouses: { $size: '$levels' },
          lowStockWarehouses: {
            $size: {
              $filter: {
                input: '$levels',
                cond: {
                  $and: [
                    { $gt: ['$$this.threshold', 0] },
                    { $lte: ['$$this.available', '$$this.threshold'] },
                  ],
                },
              },
            },
          },
        },
      },
    },
    { $project: { levels: 0 } },
  ];
}

const categoryStages: PipelineStage.FacetPipelineStage[] = [
  {
    $lookup: {
      from: 'categories',
      localField: 'categoryId',
      foreignField: '_id',
      as: 'category',
      pipeline: [{ $project: { name: 1, code: 1 } }],
    },
  },
  { $set: { category: { $ifNull: [{ $first: '$category' }, null] } } },
];

export async function listProducts(query: ListProductsQuery) {
  const filter: FilterQuery<ProductRecord> = {};
  if (query.categoryId) filter.categoryId = new Types.ObjectId(query.categoryId);
  if (query.status) filter.isActive = query.status === 'active';
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ name: pattern }, { sku: pattern }, { barcode: pattern }];
  }

  const stockFilter: Record<string, unknown> =
    query.stock === 'low'
      ? { 'stock.lowStockWarehouses': { $gt: 0 } }
      : query.stock === 'out'
        ? { 'stock.available': { $lte: 0 } }
        : query.stock === 'in'
          ? { 'stock.available': { $gt: 0 } }
          : {};

  const result = await Product.aggregate([
    { $match: filter },
    ...stockSummaryStages(query.warehouseId),
    { $match: stockFilter },
    { $sort: { ...parseSort(query.sort), _id: 1 } },
    ...paginateStages(query, categoryStages),
  ]);
  return pageResult(result, query, toDto);
}

export async function getProduct(id: string): Promise<ProductDto> {
  const [row] = await Product.aggregate<ProductRow>([
    { $match: { _id: new Types.ObjectId(id) } },
    ...stockSummaryStages(),
    ...categoryStages,
  ]);
  if (!row) throw notFound('Product');
  return toDto(row);
}

function duplicateProductError(error: { keyPattern?: object }) {
  const field = Object.keys(error.keyPattern ?? {})[0] === 'barcode' ? 'barcode' : 'sku';
  const label = field === 'sku' ? 'SKU' : 'barcode';
  return new AppError(409, 'CONFLICT', `A product with this ${label} already exists`, [
    { path: field, message: `This ${label} is already in use` },
  ]);
}

const isSkuCollision = (error: unknown) =>
  isDuplicateKeyError(error) && Object.keys(error.keyPattern ?? {})[0] === 'sku';

async function requireCategory(categoryId: string) {
  const category = await Category.findById(categoryId).lean();
  if (!category) throw fieldError('categoryId', 'Category not found');
  return category;
}

export async function createProduct(input: ReturnType<typeof createProductSchema.parse>) {
  const category = await requireCategory(input.categoryId);
  const { sku: requestedSku, ...fields } = input;

  if (requestedSku) {
    try {
      return (await Product.create({ ...fields, sku: requestedSku }))._id.toString();
    } catch (error) {
      if (isDuplicateKeyError(error)) throw duplicateProductError(error);
      throw error;
    }
  }

  // Generated SKUs come from a per-category counter. A manually entered SKU can already
  // occupy the next number, so skip forward until one is free.
  for (let attempt = 0; attempt < 25; attempt++) {
    const seq = await nextSequence(`sku:${category.code}`);
    const sku = `${category.code}-${String(seq).padStart(5, '0')}`;
    try {
      return (await Product.create({ ...fields, sku }))._id.toString();
    } catch (error) {
      if (isSkuCollision(error)) continue;
      if (isDuplicateKeyError(error)) throw duplicateProductError(error);
      throw error;
    }
  }
  throw new AppError(409, 'CONFLICT', 'Could not generate a unique SKU. Enter one manually.');
}

export function createProductsRouter(): Router {
  const router = Router();
  router.use(authenticate());

  router.get('/', async (req, res) => {
    res.json(await listProducts(listProductsQuerySchema.parse(req.query)));
  });

  router.get('/:id', async (req, res) => {
    res.json({ data: await getProduct(parseId(req.params.id, 'Product')) });
  });

  router.post('/', authorize('products:write'), async (req, res) => {
    const id = await createProduct(createProductSchema.parse(req.body));
    res.status(201).json({ data: await getProduct(id) });
  });

  router.patch('/:id', authorize('products:write'), async (req, res) => {
    const id = parseId(req.params.id, 'Product');
    const input = updateProductSchema.parse(req.body);
    const product = await Product.findById(id);
    if (!product) throw notFound('Product');
    if (input.categoryId) await requireCategory(input.categoryId);

    product.set(input);
    try {
      await product.save();
    } catch (error) {
      if (isDuplicateKeyError(error)) throw duplicateProductError(error);
      throw error;
    }
    res.json({ data: await getProduct(id) });
  });

  return router;
}
