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
    previousQuarantine: { type: Number, default: null },
    quarantineAfter: { type: Number, default: null },
    unitCost: { type: Number, required: true },
    reason: { type: String, enum: [...ADJUSTMENT_REASONS, null], default: null },
  },
  { _id: false },
);

const docRef = new Schema(
  {
    _id: { type: Schema.Types.ObjectId, required: true },
    number: { type: String, required: true },
  },
  { _id: false },
);

/**
 * Posted opening-stock, adjustment and quarantine documents. Their quantities never change;
 * the only later write is reversedBy, set when a reversal is posted.
 */
const stockAdjustmentSchema = new Schema(
  {
    number: { type: String, required: true },
    type: { type: String, enum: STOCK_DOCUMENT_TYPES, required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    reason: { type: String, enum: [...ADJUSTMENT_REASONS, null], default: null },
    notes: { type: String, default: '' },
    lines: { type: [lineSchema], required: true },
    reversalOf: { type: docRef, default: null },
    reversedBy: { type: docRef, default: null },
    source: {
      type: new Schema(
        {
          type: { type: String, enum: ['stockCount', 'transfer'], required: true },
          _id: { type: Schema.Types.ObjectId, required: true },
          number: { type: String, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

stockAdjustmentSchema.index({ number: 1 }, { unique: true });
stockAdjustmentSchema.index({ createdAt: -1 });
stockAdjustmentSchema.index({ warehouseId: 1, createdAt: -1 });

export const StockAdjustment = model('StockAdjustment', stockAdjustmentSchema);
