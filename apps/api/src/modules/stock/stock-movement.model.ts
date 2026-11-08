import { Schema, model } from 'mongoose';
import { MOVEMENT_REFERENCE_TYPES, MOVEMENT_TYPES } from '@stockflow/shared';

/** Append-only ledger: one row per change to a stock level. Never updated or deleted. */
const stockMovementSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    type: { type: String, enum: MOVEMENT_TYPES, required: true },
    quantity: { type: Number, required: true }, // signed: + in, − out
    balanceAfter: { type: Number, required: true, min: 0 },
    unitCost: { type: Number, required: true, min: 0 },
    reference: {
      type: { type: String, enum: MOVEMENT_REFERENCE_TYPES, required: true },
      id: { type: Schema.Types.ObjectId, required: true },
      number: { type: String, required: true },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

stockMovementSchema.index({ productId: 1, warehouseId: 1, createdAt: -1 });
stockMovementSchema.index({ warehouseId: 1, createdAt: -1 });
stockMovementSchema.index({ createdAt: -1 });
stockMovementSchema.index({ 'reference.id': 1 });

export const StockMovement = model('StockMovement', stockMovementSchema);
