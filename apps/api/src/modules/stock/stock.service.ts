import type { ClientSession, Types } from 'mongoose';
import type { MovementReferenceType, MovementType, StockBucket } from '@stockflow/shared';
import { notify } from '../notifications/notifications.js';
import { Product } from '../products/product.model.js';
import { Warehouse } from '../warehouses/warehouse.model.js';
import { StockLevel } from './stock-level.model.js';
import { StockMovement } from './stock-movement.model.js';

export interface MovementInput {
  productId: Types.ObjectId;
  warehouseId: Types.ObjectId;
  type: MovementType;
  /** Signed: positive adds stock, negative removes it. Never zero. */
  quantity: number;
  unitCost: number;
  reference: { type: MovementReferenceType; id: Types.ObjectId; number: string };
  createdBy: Types.ObjectId;
  /** Usable stock (onHand, the default) or the warehouse's quarantine. */
  bucket?: StockBucket;
  /** For withdrawals of stock already reserved: on-hand and reserved fall together. */
  fromReserved?: boolean;
}

export class InsufficientStockError extends Error {
  constructor(
    readonly productId: Types.ObjectId,
    readonly available: number,
    readonly bucket: StockBucket = 'usable',
  ) {
    super('Insufficient stock');
  }
}

/**
 * The only way stock quantities change. Updates the stock level atomically and records
 * the movement in the same transaction, so each bucket's ledger always sums to its balance.
 */
export async function applyMovement(input: MovementInput, session: ClientSession) {
  if (!Number.isInteger(input.quantity) || input.quantity === 0) {
    throw new Error('Movement quantity must be a non-zero integer');
  }

  const key = { productId: input.productId, warehouseId: input.warehouseId };
  const bucket = input.bucket ?? 'usable';
  const field = bucket === 'usable' ? 'onHand' : 'quarantine';
  const removing = -input.quantity;
  let level;

  if (input.quantity > 0) {
    level = await StockLevel.findOneAndUpdate(
      key,
      { $inc: { [field]: input.quantity } },
      { upsert: true, new: true, setDefaultsOnInsert: true, session },
    ).lean();
  } else if (bucket === 'quarantine') {
    level = await StockLevel.findOneAndUpdate(
      { ...key, quarantine: { $gte: removing } },
      { $inc: { quarantine: input.quantity } },
      { new: true, session },
    ).lean();
    if (!level) {
      const current = await StockLevel.findOne(key).session(session).lean();
      throw new InsufficientStockError(input.productId, current?.quarantine ?? 0, 'quarantine');
    }
  } else if (input.fromReserved) {
    level = await StockLevel.findOneAndUpdate(
      { ...key, onHand: { $gte: removing }, reserved: { $gte: removing } },
      { $inc: { onHand: input.quantity, reserved: input.quantity } },
      { new: true, session },
    ).lean();
    // Reservations are taken in the same transaction as the documents that hold them,
    // so a missing reservation means the books are inconsistent, not a user error.
    if (!level) throw new Error('Reserved stock is missing for this withdrawal');
  } else {
    // The filter only matches when enough unreserved stock exists, so concurrent
    // withdrawals cannot push on-hand below the reserved quantity or below zero.
    level = await StockLevel.findOneAndUpdate(
      { ...key, $expr: { $gte: [{ $subtract: ['$onHand', '$reserved'] }, removing] } },
      { $inc: { onHand: input.quantity } },
      { new: true, session },
    ).lean();
    if (!level) {
      const current = await StockLevel.findOne(key).session(session).lean();
      throw new InsufficientStockError(
        input.productId,
        current ? current.onHand - current.reserved : 0,
      );
    }
  }

  if (bucket === 'usable' && input.quantity < 0 && !input.fromReserved) {
    const after = level.onHand - level.reserved;
    await alertIfLow(input.productId, input.warehouseId, after - input.quantity, after, session);
  }

  const balanceAfter = level[field];
  await StockMovement.create(
    [
      {
        ...key,
        type: input.type,
        bucket,
        quantity: input.quantity,
        balanceAfter,
        unitCost: input.unitCost,
        reference: input.reference,
        createdBy: input.createdBy,
      },
    ],
    { session },
  );

  return {
    previousOnHand: level.onHand - (bucket === 'usable' ? input.quantity : 0),
    balanceAfter: level.onHand,
    previousQuarantine: level.quarantine - (bucket === 'quarantine' ? input.quantity : 0),
    quarantineAfter: level.quarantine,
  };
}

/**
 * Moving weighted average across all warehouses. Call before applying the incoming movement.
 * newAvg = (Q × avg + q × c) / (Q + q), or c when there is no stock on hand.
 */
export async function updateAverageCost(
  productId: Types.ObjectId,
  incomingQuantity: number,
  unitCost: number,
  session: ClientSession,
): Promise<void> {
  const [totals] = await StockLevel.aggregate<{ onHand: number }>([
    { $match: { productId } },
    { $group: { _id: null, onHand: { $sum: '$onHand' } } },
  ]).session(session);
  const product = await Product.findById(productId).session(session).select('avgCost').lean();
  if (!product) return;

  const onHand = totals?.onHand ?? 0;
  const avgCost =
    onHand <= 0
      ? unitCost
      : Math.round(
          (onHand * product.avgCost + incomingQuantity * unitCost) / (onHand + incomingQuantity),
        );
  await Product.updateOne({ _id: productId }, { $set: { avgCost } }, { session });
}

/**
 * Reserves stock for a confirmed order. The filter only matches when enough unreserved
 * stock exists, so concurrent confirmations can never reserve the same units: the
 * second one either sees the first's reservation or conflicts and is retried.
 */
export async function reserveStock(
  productId: Types.ObjectId,
  warehouseId: Types.ObjectId,
  quantity: number,
  session: ClientSession,
): Promise<void> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error('Reservation quantity must be a positive integer');
  }
  const key = { productId, warehouseId };
  const level = await StockLevel.findOneAndUpdate(
    { ...key, $expr: { $gte: [{ $subtract: ['$onHand', '$reserved'] }, quantity] } },
    { $inc: { reserved: quantity } },
    { new: true, session },
  ).lean();
  if (!level) {
    const current = await StockLevel.findOne(key).session(session).lean();
    throw new InsufficientStockError(productId, current ? current.onHand - current.reserved : 0);
  }
  const after = level.onHand - level.reserved;
  await alertIfLow(productId, warehouseId, after + quantity, after, session);
}

/**
 * Notifies inventory and procurement when available stock drops to or below the threshold
 * (the warehouse override, else the product's). Only the crossing alerts, not every
 * withdrawal while already low, and only in active warehouses.
 */
async function alertIfLow(
  productId: Types.ObjectId,
  warehouseId: Types.ObjectId,
  before: number,
  after: number,
  session: ClientSession,
) {
  const [product, level, warehouse] = await Promise.all([
    Product.findById(productId, { sku: 1, name: 1, unit: 1, reorderPoint: 1 })
      .session(session)
      .lean(),
    StockLevel.findOne({ productId, warehouseId }, { reorderPoint: 1 }).session(session).lean(),
    Warehouse.findById(warehouseId, { code: 1, isActive: 1 }).session(session).lean(),
  ]);
  if (!product || !warehouse?.isActive) return;
  const threshold = level?.reorderPoint ?? product.reorderPoint;
  if (threshold <= 0 || before <= threshold || after > threshold) return;
  await notify(
    { permissions: ['stock:adjust', 'purchaseOrders:write'] },
    {
      type: 'low_stock',
      title: `${after <= 0 ? 'Out of stock' : 'Low stock'}: ${product.sku} at ${warehouse.code}`,
      body: `${product.name}: ${Math.max(after, 0)} ${product.unit} available, threshold ${threshold}`,
      link: `/products/${productId.toString()}`,
    },
    session,
  );
}

/** Returns reserved units to available stock when an order or its remainder is cancelled. */
export async function releaseReservation(
  productId: Types.ObjectId,
  warehouseId: Types.ObjectId,
  quantity: number,
  session: ClientSession,
): Promise<void> {
  if (quantity === 0) return;
  const result = await StockLevel.updateOne(
    { productId, warehouseId, reserved: { $gte: quantity } },
    { $inc: { reserved: -quantity } },
    { session },
  );
  if (result.modifiedCount === 0) throw new Error('Reservation to release is missing');
}
