import { Schema, model } from 'mongoose';
import { ADJUSTMENT_REASONS, STOCK_DOCUMENT_TYPES, UNITS } from '@stockflow/shared';

const lineSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    sku: { type: String, required: true },
    name: { type: String, required: true },
    unit: { type: String, enum: UNITS, required: true },
    quantityChange: { type: Number, required: true },
    previousOnHand: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    unitCost: { type: Number, required: true },
  },
  { _id: false },
);

/** Posted opening-stock and adjustment documents. Immutable once created. */
const stockAdjustmentSchema = new Schema(
  {
    number: { type: String, required: true },
    type: { type: String, enum: STOCK_DOCUMENT_TYPES, required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    reason: { type: String, enum: [...ADJUSTMENT_REASONS, null], default: null },
    notes: { type: String, default: '' },
    lines: { type: [lineSchema], required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

stockAdjustmentSchema.index({ number: 1 }, { unique: true });
stockAdjustmentSchema.index({ createdAt: -1 });
stockAdjustmentSchema.index({ warehouseId: 1, createdAt: -1 });

export const StockAdjustment = model('StockAdjustment', stockAdjustmentSchema);
