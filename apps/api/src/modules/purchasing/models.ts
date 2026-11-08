import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { PURCHASE_ORDER_STATUSES, PURCHASE_REQUEST_STATUSES, UNITS } from '@stockflow/shared';
import {
  historyEntrySchema,
  partnerSnapshotSchema,
  userSnapshotSchema,
} from '../common/schemas.js';

// Supplier price list

const supplierPriceSchema = new Schema(
  {
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    unitCost: { type: Number, required: true, min: 0 },
    supplierSku: { type: String, default: '' },
  },
  { timestamps: true },
);
supplierPriceSchema.index({ supplierId: 1, productId: 1 }, { unique: true });
supplierPriceSchema.index({ productId: 1 });

export const SupplierPrice = model('SupplierPrice', supplierPriceSchema);

// Purchase requests

const requestLineSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  sku: { type: String, required: true },
  name: { type: String, required: true },
  unit: { type: String, enum: UNITS, required: true },
  quantity: { type: Number, required: true, min: 1 },
  note: { type: String, default: '' },
});

const purchaseRequestSchema = new Schema(
  {
    number: { type: String, required: true },
    status: { type: String, enum: PURCHASE_REQUEST_STATUSES, required: true, default: 'draft' },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    supplier: { type: partnerSnapshotSchema, default: null },
    neededBy: { type: Date, default: null },
    notes: { type: String, default: '' },
    lines: { type: [requestLineSchema], required: true },
    requestedBy: { type: userSnapshotSchema, required: true },
    purchaseOrder: {
      type: new Schema({ _id: Schema.Types.ObjectId, number: String }, { _id: false }),
      default: null,
    },
    rejectionReason: { type: String, default: '' },
    history: { type: [historyEntrySchema], default: [] },
  },
  { timestamps: true },
);
purchaseRequestSchema.index({ number: 1 }, { unique: true });
purchaseRequestSchema.index({ status: 1, createdAt: -1 });
purchaseRequestSchema.index({ 'requestedBy._id': 1, createdAt: -1 });

export const PurchaseRequest = model('PurchaseRequest', purchaseRequestSchema);
export type PurchaseRequestRecord = InferSchemaType<typeof purchaseRequestSchema> & {
  _id: Types.ObjectId;
};

// Purchase orders

const orderLineSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  sku: { type: String, required: true },
  name: { type: String, required: true },
  unit: { type: String, enum: UNITS, required: true },
  quantity: { type: Number, required: true, min: 1 },
  // Accepted into stock; never more than quantity.
  receivedQuantity: { type: Number, required: true, min: 0, default: 0 },
  // Delivered but not accepted. Kept for supplier performance; doesn't reduce what's outstanding.
  rejectedQuantity: { type: Number, required: true, min: 0, default: 0 },
  damagedQuantity: { type: Number, required: true, min: 0, default: 0 },
  unitCost: { type: Number, required: true, min: 0 },
  taxRate: { type: Number, required: true, min: 0 },
  lineSubtotal: { type: Number, required: true },
  lineTax: { type: Number, required: true },
  lineTotal: { type: Number, required: true },
});

const purchaseOrderSchema = new Schema(
  {
    number: { type: String, required: true },
    status: { type: String, enum: PURCHASE_ORDER_STATUSES, required: true, default: 'draft' },
    supplier: { type: partnerSnapshotSchema, required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    purchaseRequest: {
      type: new Schema({ _id: Schema.Types.ObjectId, number: String }, { _id: false }),
      default: null,
    },
    orderDate: { type: Date, required: true },
    expectedDate: { type: Date, default: null },
    notes: { type: String, default: '' },
    lines: { type: [orderLineSchema], required: true },
    subtotal: { type: Number, required: true },
    taxTotal: { type: Number, required: true },
    total: { type: Number, required: true },
    createdBy: { type: userSnapshotSchema, required: true },
    approvedBy: { type: userSnapshotSchema, default: null },
    approvedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: '' },
    cancelReason: { type: String, default: '' },
    closeReason: { type: String, default: '' },
    receiptCount: { type: Number, required: true, default: 0 },
    history: { type: [historyEntrySchema], default: [] },
  },
  { timestamps: true },
);
purchaseOrderSchema.index({ number: 1 }, { unique: true });
purchaseOrderSchema.index({ status: 1, orderDate: -1 });
purchaseOrderSchema.index({ 'supplier._id': 1, orderDate: -1 });
purchaseOrderSchema.index({ warehouseId: 1, status: 1 });
purchaseOrderSchema.index({ 'lines.productId': 1, status: 1 });

export const PurchaseOrder = model('PurchaseOrder', purchaseOrderSchema);
export type PurchaseOrderRecord = InferSchemaType<typeof purchaseOrderSchema> & {
  _id: Types.ObjectId;
};

// Goods receipts

const receiptLineSchema = new Schema(
  {
    poLineId: { type: Schema.Types.ObjectId, required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    sku: { type: String, required: true },
    name: { type: String, required: true },
    unit: { type: String, enum: UNITS, required: true },
    acceptedQuantity: { type: Number, required: true, min: 0 },
    rejectedQuantity: { type: Number, required: true, min: 0 },
    damagedQuantity: { type: Number, required: true, min: 0 },
    rejectionReason: { type: String, default: '' },
    unitCost: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

/** Posted at creation and immutable. Only accepted quantities enter stock. */
const goodsReceiptSchema = new Schema(
  {
    number: { type: String, required: true },
    purchaseOrder: {
      type: new Schema({ _id: Schema.Types.ObjectId, number: String }, { _id: false }),
      required: true,
    },
    supplier: { type: partnerSnapshotSchema, required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    receivedAt: { type: Date, required: true },
    // Copied from the order so on-time performance doesn't change if the order is edited later.
    expectedDate: { type: Date, default: null },
    deliveryNote: { type: String, default: '' },
    notes: { type: String, default: '' },
    lines: { type: [receiptLineSchema], required: true },
    createdBy: { type: userSnapshotSchema, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
goodsReceiptSchema.index({ number: 1 }, { unique: true });
goodsReceiptSchema.index({ 'purchaseOrder._id': 1 });
goodsReceiptSchema.index({ 'supplier._id': 1, receivedAt: -1 });
goodsReceiptSchema.index({ receivedAt: -1 });

export const GoodsReceipt = model('GoodsReceipt', goodsReceiptSchema);
export type GoodsReceiptRecord = InferSchemaType<typeof goodsReceiptSchema> & {
  _id: Types.ObjectId;
};
