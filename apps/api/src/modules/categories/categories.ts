import { Router } from 'express';
import {
  Schema,
  Types,
  model,
  type FilterQuery,
  type InferSchemaType,
  type PipelineStage,
} from 'mongoose';
import {
  createCategorySchema,
  listCategoriesQuerySchema,
  updateCategorySchema,
  type CategoryDto,
} from '@stockflow/shared';
import { AppError, invalidState, isDuplicateKeyError, notFound } from '../../lib/errors.js';
import { escapeRegex, parseId } from '../../lib/http.js';
import { pageResult, paginateStages } from '../../lib/pagination.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { Product } from '../products/product.model.js';

const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    code: { type: String, required: true, uppercase: true, trim: true },
    description: { type: String, default: '', maxlength: 300 },
  },
  { timestamps: true },
);

categorySchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
categorySchema.index({ code: 1 }, { unique: true });

export type CategoryRecord = InferSchemaType<typeof categorySchema> & { _id: Types.ObjectId };
export const Category = model('Category', categorySchema);

type CategoryRow = CategoryRecord & { productCount: number };

function toDto(row: CategoryRow): CategoryDto {
  return {
    id: row._id.toString(),
    name: row.name,
    code: row.code,
    description: row.description,
    productCount: row.productCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function duplicateError(error: { keyPattern?: object }) {
  const field = Object.keys(error.keyPattern ?? {})[0] === 'code' ? 'code' : 'name';
  return new AppError(409, 'CONFLICT', `A category with this ${field} already exists`, [
    { path: field, message: `This ${field} is already in use` },
  ]);
}

const productCountStages: PipelineStage.FacetPipelineStage[] = [
  {
    $lookup: {
      from: 'products',
      localField: '_id',
      foreignField: 'categoryId',
      as: 'products',
      pipeline: [{ $project: { _id: 1 } }],
    },
  },
  { $addFields: { productCount: { $size: '$products' } } },
  { $project: { products: 0 } },
];

async function getCategory(id: Types.ObjectId | string): Promise<CategoryDto> {
  const [row] = await Category.aggregate<CategoryRow>([
    { $match: { _id: typeof id === 'string' ? new Types.ObjectId(id) : id } },
    ...productCountStages,
  ]);
  if (!row) throw notFound('Category');
  return toDto(row);
}

export function createCategoriesRouter(): Router {
  const router = Router();
  router.use(authenticate());

  router.get('/', async (req, res) => {
    const query = listCategoriesQuerySchema.parse(req.query);
    const filter: FilterQuery<CategoryRecord> = {};
    if (query.search) {
      const pattern = new RegExp(escapeRegex(query.search), 'i');
      filter.$or = [{ name: pattern }, { code: pattern }];
    }
    const result = await Category.aggregate([
      { $match: filter },
      { $sort: { name: 1, _id: 1 } },
      ...paginateStages(query, productCountStages),
    ]).collation({ locale: 'en', strength: 2 });
    res.json(pageResult(result, query, toDto));
  });

  router.post('/', authorize('categories:manage'), async (req, res) => {
    try {
      const category = await Category.create(createCategorySchema.parse(req.body));
      res.status(201).json({ data: await getCategory(category._id) });
    } catch (error) {
      if (isDuplicateKeyError(error)) throw duplicateError(error);
      throw error;
    }
  });

  router.patch('/:id', authorize('categories:manage'), async (req, res) => {
    const id = parseId(req.params.id, 'Category');
    const input = updateCategorySchema.parse(req.body);
    const category = await Category.findById(id);
    if (!category) throw notFound('Category');
    category.set(input);
    try {
      await category.save();
    } catch (error) {
      if (isDuplicateKeyError(error)) throw duplicateError(error);
      throw error;
    }
    res.json({ data: await getCategory(category._id) });
  });

  router.delete('/:id', authorize('categories:manage'), async (req, res) => {
    const id = parseId(req.params.id, 'Category');
    if (await Product.exists({ categoryId: id })) {
      throw invalidState('Move or reassign its products before deleting this category.');
    }
    const deleted = await Category.findByIdAndDelete(id);
    if (!deleted) throw notFound('Category');
    res.status(204).end();
  });

  return router;
}
