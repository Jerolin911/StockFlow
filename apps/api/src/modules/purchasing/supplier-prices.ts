import { Router } from 'express';
import { Types } from 'mongoose';
import { supplierPriceSchema, type SupplierPriceDto, type Unit } from '@stockflow/shared';
import { notFound } from '../../lib/errors.js';
import { parseId } from '../../lib/http.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { suppliers } from '../partners/partners.js';
import { Product } from '../products/product.model.js';
import { supplierDeliverySummary } from './goods-receipts.js';
import { SupplierPrice } from './models.js';

interface PriceRow {
  _id: Types.ObjectId;
  supplierId: Types.ObjectId;
  unitCost: number;
  supplierSku: string;
  updatedAt: Date;
  product: {
    _id: Types.ObjectId;
    sku: string;
    name: string;
    unit: Unit;
    costPrice: number;
    isActive: boolean;
  };
  supplier?: { _id: Types.ObjectId; code: string; name: string; isActive: boolean };
}

const toDto = (row: PriceRow): SupplierPriceDto => ({
  product: {
    id: row.product._id.toString(),
    sku: row.product.sku,
    name: row.product.name,
    unit: row.product.unit,
    costPrice: row.product.costPrice,
    isActive: row.product.isActive,
  },
  unitCost: row.unitCost,
  supplierSku: row.supplierSku,
  updatedAt: row.updatedAt.toISOString(),
});

const productLookup = [
  {
    $lookup: {
      from: 'products',
      localField: 'productId',
      foreignField: '_id',
      as: 'product',
      pipeline: [{ $project: { sku: 1, name: 1, unit: 1, costPrice: 1, isActive: 1 } }],
    },
  },
  { $unwind: '$product' },
];

async function requireSupplier(id: string) {
  if (!(await suppliers.Model.exists({ _id: id }))) throw notFound('Supplier');
}

/** Mounted at /suppliers/:supplierId — price list and delivery history for one supplier. */
export function createSupplierPurchasingRouter(): Router {
  const router = Router({ mergeParams: true });
  router.use(authenticate());

  router.get('/prices', async (req, res) => {
    const supplierId = parseId((req.params as { supplierId: string }).supplierId, 'Supplier');
    await requireSupplier(supplierId);
    const rows = await SupplierPrice.aggregate<PriceRow>([
      { $match: { supplierId: new Types.ObjectId(supplierId) } },
      ...productLookup,
      { $sort: { 'product.sku': 1 } },
    ]);
    res.json({ data: rows.map(toDto) });
  });

  router.put('/prices/:productId', authorize('suppliers:write'), async (req, res) => {
    const supplierId = parseId((req.params as { supplierId: string }).supplierId, 'Supplier');
    const productId = parseId(req.params.productId, 'Product');
    await requireSupplier(supplierId);
    if (!(await Product.exists({ _id: productId }))) throw notFound('Product');
    const input = supplierPriceSchema.parse(req.body);
    await SupplierPrice.findOneAndUpdate(
      { supplierId, productId },
      { $set: input },
      { upsert: true, setDefaultsOnInsert: true },
    );
    const [row] = await SupplierPrice.aggregate<PriceRow>([
      {
        $match: {
          supplierId: new Types.ObjectId(supplierId),
          productId: new Types.ObjectId(productId),
        },
      },
      ...productLookup,
    ]);
    res.json({ data: toDto(row!) });
  });

  router.delete('/prices/:productId', authorize('suppliers:write'), async (req, res) => {
    const supplierId = parseId((req.params as { supplierId: string }).supplierId, 'Supplier');
    const productId = parseId(req.params.productId, 'Product');
    const deleted = await SupplierPrice.findOneAndDelete({ supplierId, productId });
    if (!deleted) throw notFound('Supplier price');
    res.status(204).end();
  });

  router.get('/delivery-summary', async (req, res) => {
    const supplierId = parseId((req.params as { supplierId: string }).supplierId, 'Supplier');
    await requireSupplier(supplierId);
    res.json({ data: await supplierDeliverySummary(supplierId) });
  });

  return router;
}

/** Mounted at /products/:productId/supplier-prices — what each supplier charges for one product. */
export function createProductSupplierPricesRouter(): Router {
  const router = Router({ mergeParams: true });
  router.use(authenticate());

  router.get('/', async (req, res) => {
    const productId = parseId((req.params as { productId: string }).productId, 'Product');
    const rows = await SupplierPrice.aggregate<PriceRow>([
      { $match: { productId: new Types.ObjectId(productId) } },
      ...productLookup,
      {
        $lookup: {
          from: 'suppliers',
          localField: 'supplierId',
          foreignField: '_id',
          as: 'supplier',
          pipeline: [{ $project: { code: 1, name: 1, isActive: 1 } }],
        },
      },
      { $unwind: '$supplier' },
      { $sort: { unitCost: 1 } },
    ]);
    res.json({
      data: rows.map((row) => ({
        ...toDto(row),
        supplier: {
          id: row.supplier!._id.toString(),
          code: row.supplier!.code,
          name: row.supplier!.name,
          isActive: row.supplier!.isActive,
        },
      })),
    });
  });

  return router;
}
