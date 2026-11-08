import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const warehouseSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    address: { type: String, default: '', maxlength: 500 },
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

warehouseSchema.index({ isActive: 1, name: 1 });

export type WarehouseRecord = InferSchemaType<typeof warehouseSchema> & { _id: Types.ObjectId };
export const Warehouse = model('Warehouse', warehouseSchema);
