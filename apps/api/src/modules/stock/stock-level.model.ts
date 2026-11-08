import { Schema, model } from 'mongoose';

/**
 * Current quantity of one product in one warehouse. Only stock.service.ts writes
 * onHand/reserved, always together with a stock movement in the same transaction.
 */
const stockLevelSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    onHand: { type: Number, required: true, min: 0, default: 0 },
    reserved: { type: Number, required: true, min: 0, default: 0 },
    // Overrides the product's reorder point for this warehouse when set.
    reorderPoint: { type: Number, min: 0, default: null },
  },
  { timestamps: true },
);

stockLevelSchema.index({ productId: 1, warehouseId: 1 }, { unique: true });
stockLevelSchema.index({ warehouseId: 1 });

export const StockLevel = model('StockLevel', stockLevelSchema);
