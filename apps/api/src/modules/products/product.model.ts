import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { UNITS } from '@stockflow/shared';

const productSchema = new Schema(
  {
    sku: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    name: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, default: '', maxlength: 1000 },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    unit: { type: String, enum: UNITS, required: true },
    barcode: { type: String, default: '' },
    costPrice: { type: Number, required: true, min: 0 },
    sellingPrice: { type: Number, required: true, min: 0 },
    taxRate: { type: Number, required: true, min: 0, max: 10_000, default: 0 },
    // Moving weighted average, maintained by stock-in movements that carry a cost.
    avgCost: { type: Number, required: true, min: 0, default: 0 },
    reorderPoint: { type: Number, required: true, min: 0, default: 0 },
    reorderQuantity: { type: Number, required: true, min: 0, default: 0 },
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

productSchema.index({ sku: 1 }, { unique: true });
productSchema.index(
  { barcode: 1 },
  { unique: true, partialFilterExpression: { barcode: { $type: 'string', $gt: '' } } },
);
productSchema.index({ categoryId: 1 });
productSchema.index({ isActive: 1, name: 1 });

export type ProductRecord = InferSchemaType<typeof productSchema> & { _id: Types.ObjectId };
export const Product = model('Product', productSchema);
