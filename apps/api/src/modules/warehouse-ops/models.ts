import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import {
  STOCK_COUNT_STATUSES,
  TRANSFER_STATUSES,
  UNITS,
  VARIANCE_REASONS,
} from '@stockflow/shared';
import { historyEntrySchema, userSnapshotSchema } from '../common/schemas.js';

const docRefSchema = new Schema(
  {
    _id: { type: Schema.Types.ObjectId, required: true },
    number: { type: String, required: true },
  },
  { _id: false },
);

// Transfers

/**
 * in transit for a line = dispatched − received − damaged − lost. Dispatch writes
 * TRANSFER_OUT at the source; receipts write TRANSFER_IN at the destination (damaged units
 * into its quarantine). Closing short writes off what never arrived at the destination.
 */
const transferLineSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  sku: { type: String, required: true },
  name: { type: String, required: true },
  unit: { type: String, enum: UNITS, required: true },
  quantity: { type: Number, required: true, min: 1 },
  dispatchedQuantity: { type: Number, required: true, min: 0, default: 0 },
  receivedQuantity: { type: Number, required: true, min: 0, default: 0 },
  damagedQuantity: { type: Number, required: true, min: 0, default: 0 },
  lostQuantity: { type: Number, required: true, min: 0, default: 0 },
  unitCost: { type: Number, min: 0, default: null },
});

const transferReceiptSchema = new Schema(
  {
    at: { type: Date, required: true },
    by: { type: userSnapshotSchema, required: true },
    note: { type: String, default: '' },
    lines: [
      new Schema(
        {
          lineId: { type: Schema.Types.ObjectId, required: true },
          receivedQuantity: { type: Number, required: true, min: 0 },
          damagedQuantity: { type: Number, required: true, min: 0 },
        },
        { _id: false },
      ),
    ],
  },
  { _id: false },
);

const transferSchema = new Schema(
  {
    number: { type: String, required: true },
    status: { type: String, enum: TRANSFER_STATUSES, required: true, default: 'requested' },
    fromWarehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    toWarehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    neededBy: { type: Date, default: null },
    notes: { type: String, default: '' },
    lines: { type: [transferLineSchema], required: true },
    carrier: { type: String, default: '' },
    reference: { type: String, default: '' },
    requestedBy: { type: userSnapshotSchema, required: true },
    approvedBy: { type: userSnapshotSchema, default: null },
    approvedAt: { type: Date, default: null },
    dispatchedAt: { type: Date, default: null },
    dispatchedBy: { type: userSnapshotSchema, default: null },
    receipts: { type: [transferReceiptSchema], default: [] },
    rejectionReason: { type: String, default: '' },
    cancelReason: { type: String, default: '' },
    closeReason: { type: String, default: '' },
    lossAdjustment: { type: docRefSchema, default: null },
    history: { type: [historyEntrySchema], default: [] },
  },
  { timestamps: true },
);
transferSchema.index({ number: 1 }, { unique: true });
transferSchema.index({ status: 1, createdAt: -1 });
transferSchema.index({ fromWarehouseId: 1, status: 1 });
transferSchema.index({ toWarehouseId: 1, status: 1 });
transferSchema.index({ 'lines.productId': 1, status: 1 });

export const StockTransfer = model('StockTransfer', transferSchema);
export type TransferRecord = InferSchemaType<typeof transferSchema> & { _id: Types.ObjectId };

// Physical counts

const countLineSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  sku: { type: String, required: true },
  name: { type: String, required: true },
  unit: { type: String, enum: UNITS, required: true },
  snapshotQuantity: { type: Number, required: true },
  countedQuantity: { type: Number, min: 0, default: null },
  // Set when posted: on hand at that moment and counted − on hand.
  systemQuantity: { type: Number, default: null },
  variance: { type: Number, default: null },
  reason: { type: String, enum: [...VARIANCE_REASONS, null], default: null },
  note: { type: String, default: '' },
});

const stockCountSchema = new Schema(
  {
    number: { type: String, required: true },
    status: { type: String, enum: STOCK_COUNT_STATUSES, required: true, default: 'counting' },
    // True while counting or awaiting review; one open count per warehouse.
    isOpen: { type: Boolean, required: true, default: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    category: {
      type: new Schema({ _id: Schema.Types.ObjectId, name: String }, { _id: false }),
      default: null,
    },
    notes: { type: String, default: '' },
    lines: { type: [countLineSchema], required: true },
    adjustment: { type: docRefSchema, default: null },
    createdBy: { type: userSnapshotSchema, required: true },
    submittedBy: { type: userSnapshotSchema, default: null },
    postedBy: { type: userSnapshotSchema, default: null },
    postedAt: { type: Date, default: null },
    history: { type: [historyEntrySchema], default: [] },
  },
  { timestamps: true },
);
stockCountSchema.index({ number: 1 }, { unique: true });
stockCountSchema.index({ createdAt: -1 });
stockCountSchema.index(
  { warehouseId: 1 },
  { unique: true, partialFilterExpression: { isOpen: { $eq: true } } },
);

export const StockCount = model('StockCount', stockCountSchema);
export type StockCountRecord = InferSchemaType<typeof stockCountSchema> & { _id: Types.ObjectId };
