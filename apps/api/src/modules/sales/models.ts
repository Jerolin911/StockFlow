import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import {
  SALES_ORDER_STATUSES,
  SHIPMENT_STATUSES,
  TRACKING_EVENT_TYPES,
  UNITS,
} from '@stockflow/shared';
import {
  historyEntrySchema,
  partnerSnapshotSchema,
  userSnapshotSchema,
} from '../common/schemas.js';

// Sales orders

/**
 * For an open order, reserved stock for a line = quantity − shipped − cancelled.
 * allocated counts units on shipments that haven't been dispatched; it's a subset of
 * what's reserved. quantity ≥ allocated + shipped + cancelled always holds.
 */
const salesOrderLineSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  sku: { type: String, required: true },
  name: { type: String, required: true },
  unit: { type: String, enum: UNITS, required: true },
  quantity: { type: Number, required: true, min: 1 },
  allocatedQuantity: { type: Number, required: true, min: 0, default: 0 },
  shippedQuantity: { type: Number, required: true, min: 0, default: 0 },
  deliveredQuantity: { type: Number, required: true, min: 0, default: 0 },
  cancelledQuantity: { type: Number, required: true, min: 0, default: 0 },
  unitPrice: { type: Number, required: true, min: 0 },
  discountRate: { type: Number, required: true, min: 0, max: 10_000 },
  taxRate: { type: Number, required: true, min: 0 },
  lineGross: { type: Number, required: true },
  lineDiscount: { type: Number, required: true },
  lineSubtotal: { type: Number, required: true },
  lineTax: { type: Number, required: true },
  lineTotal: { type: Number, required: true },
});

const salesOrderSchema = new Schema(
  {
    number: { type: String, required: true },
    status: { type: String, enum: SALES_ORDER_STATUSES, required: true, default: 'draft' },
    customer: { type: partnerSnapshotSchema, required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    orderDate: { type: Date, required: true },
    requiredDate: { type: Date, default: null },
    shippingAddress: { type: String, default: '' },
    customerReference: { type: String, default: '' },
    notes: { type: String, default: '' },
    lines: { type: [salesOrderLineSchema], required: true },
    grossTotal: { type: Number, required: true },
    discountTotal: { type: Number, required: true },
    subtotal: { type: Number, required: true },
    taxTotal: { type: Number, required: true },
    total: { type: Number, required: true },
    createdBy: { type: userSnapshotSchema, required: true },
    confirmedBy: { type: userSnapshotSchema, default: null },
    confirmedAt: { type: Date, default: null },
    cancelReason: { type: String, default: '' },
    shipmentCount: { type: Number, required: true, default: 0 },
    history: { type: [historyEntrySchema], default: [] },
  },
  { timestamps: true },
);
salesOrderSchema.index({ number: 1 }, { unique: true });
salesOrderSchema.index({ status: 1, orderDate: -1 });
salesOrderSchema.index({ 'customer._id': 1, orderDate: -1 });
salesOrderSchema.index({ warehouseId: 1, status: 1 });
salesOrderSchema.index({ 'lines.productId': 1, status: 1 });

export const SalesOrder = model('SalesOrder', salesOrderSchema);
export type SalesOrderRecord = InferSchemaType<typeof salesOrderSchema> & { _id: Types.ObjectId };

// Shipments

const shipmentLineSchema = new Schema({
  soLineId: { type: Schema.Types.ObjectId, required: true },
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  sku: { type: String, required: true },
  name: { type: String, required: true },
  unit: { type: String, enum: UNITS, required: true },
  quantity: { type: Number, required: true, min: 1 },
  pickedQuantity: { type: Number, min: 0, default: null },
  unitCost: { type: Number, min: 0, default: null },
});

const trackingEventSchema = new Schema(
  {
    type: { type: String, enum: ['dispatched', ...TRACKING_EVENT_TYPES], required: true },
    at: { type: Date, required: true },
    location: { type: String, default: '' },
    note: { type: String, default: '' },
    by: { type: userSnapshotSchema, required: true },
  },
  { _id: false },
);

/**
 * Picking, picked and packed shipments hold allocated units of their order's reservation.
 * Dispatch issues the picked quantities from stock; nothing after that changes stock.
 */
const shipmentSchema = new Schema(
  {
    number: { type: String, required: true },
    status: { type: String, enum: SHIPMENT_STATUSES, required: true, default: 'picking' },
    salesOrder: {
      type: new Schema({ _id: Schema.Types.ObjectId, number: String }, { _id: false }),
      required: true,
    },
    customer: { type: partnerSnapshotSchema, required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    shippingAddress: { type: String, default: '' },
    lines: { type: [shipmentLineSchema], required: true },
    notes: { type: String, default: '' },
    shortPickReason: { type: String, default: '' },
    packageCount: { type: Number, default: null },
    weightGrams: { type: Number, default: null },
    carrier: { type: String, default: '' },
    trackingNumber: { type: String, default: '' },
    receivedBy: { type: String, default: '' },
    cancelReason: { type: String, default: '' },
    pickedAt: { type: Date, default: null },
    pickedBy: { type: userSnapshotSchema, default: null },
    packedAt: { type: Date, default: null },
    packedBy: { type: userSnapshotSchema, default: null },
    dispatchedAt: { type: Date, default: null },
    dispatchedBy: { type: userSnapshotSchema, default: null },
    deliveredAt: { type: Date, default: null },
    tracking: { type: [trackingEventSchema], default: [] },
    history: { type: [historyEntrySchema], default: [] },
    createdBy: { type: userSnapshotSchema, required: true },
  },
  { timestamps: true },
);
shipmentSchema.index({ number: 1 }, { unique: true });
shipmentSchema.index({ 'salesOrder._id': 1 });
shipmentSchema.index({ status: 1, createdAt: -1 });
shipmentSchema.index({ warehouseId: 1, status: 1 });
shipmentSchema.index({ 'customer._id': 1, createdAt: -1 });
shipmentSchema.index({ dispatchedAt: -1 });

export const Shipment = model('Shipment', shipmentSchema);
export type ShipmentRecord = InferSchemaType<typeof shipmentSchema> & { _id: Types.ObjectId };
