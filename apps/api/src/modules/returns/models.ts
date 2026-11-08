import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import {
  CUSTOMER_RETURN_STATUSES,
  RETURN_REASONS,
  STOCK_BUCKETS,
  SUPPLIER_RETURN_STATUSES,
  UNITS,
} from '@stockflow/shared';
import {
  historyEntrySchema,
  partnerSnapshotSchema,
  userSnapshotSchema,
} from '../common/schemas.js';

const docRefSchema = new Schema({ _id: Schema.Types.ObjectId, number: String }, { _id: false });

// Customer returns

/**
 * Received units go to the warehouse's quarantine (CUSTOMER_RETURN movements) until
 * inspected. Inspection releases restockable units to usable stock; the rest stay isolated.
 * received = restocked + quarantined once completed.
 */
const customerReturnLineSchema = new Schema({
  soLineId: { type: Schema.Types.ObjectId, required: true },
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  sku: { type: String, required: true },
  name: { type: String, required: true },
  unit: { type: String, enum: UNITS, required: true },
  quantity: { type: Number, required: true, min: 1 },
  receivedQuantity: { type: Number, required: true, min: 0, default: 0 },
  restockedQuantity: { type: Number, required: true, min: 0, default: 0 },
  quarantinedQuantity: { type: Number, required: true, min: 0, default: 0 },
  note: { type: String, default: '' },
  // Cost of the goods when they shipped; restocked units enter the average at this cost.
  unitCost: { type: Number, required: true, min: 0 },
});

const customerReturnSchema = new Schema(
  {
    number: { type: String, required: true },
    status: { type: String, enum: CUSTOMER_RETURN_STATUSES, required: true, default: 'requested' },
    salesOrder: { type: docRefSchema, required: true },
    customer: { type: partnerSnapshotSchema, required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    reason: { type: String, enum: RETURN_REASONS, required: true },
    notes: { type: String, default: '' },
    lines: { type: [customerReturnLineSchema], required: true },
    requestedBy: { type: userSnapshotSchema, required: true },
    approvedBy: { type: userSnapshotSchema, default: null },
    approvedAt: { type: Date, default: null },
    receivedAt: { type: Date, default: null },
    receivedBy: { type: userSnapshotSchema, default: null },
    inspectedAt: { type: Date, default: null },
    inspectedBy: { type: userSnapshotSchema, default: null },
    rejectionReason: { type: String, default: '' },
    cancelReason: { type: String, default: '' },
    history: { type: [historyEntrySchema], default: [] },
  },
  { timestamps: true },
);
customerReturnSchema.index({ number: 1 }, { unique: true });
customerReturnSchema.index({ status: 1, createdAt: -1 });
customerReturnSchema.index({ 'salesOrder._id': 1 });
customerReturnSchema.index({ 'customer._id': 1, createdAt: -1 });

export const CustomerReturn = model('CustomerReturn', customerReturnSchema);
export type CustomerReturnRecord = InferSchemaType<typeof customerReturnSchema> & {
  _id: Types.ObjectId;
};

// Supplier returns

const supplierReturnLineSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  sku: { type: String, required: true },
  name: { type: String, required: true },
  unit: { type: String, enum: UNITS, required: true },
  quantity: { type: Number, required: true, min: 1 },
  source: { type: String, enum: STOCK_BUCKETS, required: true },
  unitCost: { type: Number, required: true, min: 0 },
});

/** Dispatch takes each line out of its source bucket as a SUPPLIER_RETURN movement. */
const supplierReturnSchema = new Schema(
  {
    number: { type: String, required: true },
    status: { type: String, enum: SUPPLIER_RETURN_STATUSES, required: true, default: 'requested' },
    supplier: { type: partnerSnapshotSchema, required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    purchaseOrder: { type: docRefSchema, default: null },
    reason: { type: String, enum: RETURN_REASONS, required: true },
    notes: { type: String, default: '' },
    lines: { type: [supplierReturnLineSchema], required: true },
    carrier: { type: String, default: '' },
    reference: { type: String, default: '' },
    requestedBy: { type: userSnapshotSchema, required: true },
    approvedBy: { type: userSnapshotSchema, default: null },
    approvedAt: { type: Date, default: null },
    dispatchedAt: { type: Date, default: null },
    dispatchedBy: { type: userSnapshotSchema, default: null },
    rejectionReason: { type: String, default: '' },
    cancelReason: { type: String, default: '' },
    history: { type: [historyEntrySchema], default: [] },
  },
  { timestamps: true },
);
supplierReturnSchema.index({ number: 1 }, { unique: true });
supplierReturnSchema.index({ status: 1, createdAt: -1 });
supplierReturnSchema.index({ 'supplier._id': 1, createdAt: -1 });

export const SupplierReturn = model('SupplierReturn', supplierReturnSchema);
export type SupplierReturnRecord = InferSchemaType<typeof supplierReturnSchema> & {
  _id: Types.ObjectId;
};
