import type { ClientSession, Types } from 'mongoose';
import type { MovementReferenceType, MovementType } from '@stockflow/shared';
import { Product } from '../products/product.model.js';
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
  /** For withdrawals of stock already reserved: on-hand and reserved fall together. */
  fromReserved?: boolean;
}

export class InsufficientStockError extends Error {
  constructor(
    readonly productId: Types.ObjectId,
    readonly available: number,
  ) {
    super('Insufficient stock');
  }
}

/**
 * The only way stock quantities change. Updates the stock level atomically and records
 * the movement in the same transaction, so the ledger always sums to on-hand.
 */
export async function applyMovement(input: MovementInput, session: ClientSession) {
  if (!Number.isInteger(input.quantity) || input.quantity === 0) {
    throw new Error('Movement quantity must be a non-zero integer');
  }

  const key = { productId: input.productId, warehouseId: input.warehouseId };
  let level;

  if (input.quantity > 0) {
    level = await StockLevel.findOneAndUpdate(
      key,
      { $inc: { onHand: input.quantity } },
      { upsert: true, new: true, setDefaultsOnInsert: true, session },
    ).lean();
  } else if (input.fromReserved) {
    const removing = -input.quantity;
    level = await StockLevel.findOneAndUpdate(
      { ...key, onHand: { $gte: removing }, reserved: { $gte: removing } },
      { $inc: { onHand: input.quantity, reserved: input.quantity } },
      { new: true, session },
    ).lean();
    // Reservations are taken in the same transaction as the documents that hold them,
    // so a missing reservation means the books are inconsistent, not a user error.
    if (!level) throw new Error('Reserved stock is missing for this withdrawal');
  } else {
    const removing = -input.quantity;
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

  await StockMovement.create(
    [
      {
        ...key,
        type: input.type,
        quantity: input.quantity,
        balanceAfter: level.onHand,
        unitCost: input.unitCost,
        reference: input.reference,
        createdBy: input.createdBy,
      },
    ],
    { session },
  );

  return { previousOnHand: level.onHand - input.quantity, balanceAfter: level.onHand };
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
  const result = await StockLevel.updateOne(
    { ...key, $expr: { $gte: [{ $subtract: ['$onHand', '$reserved'] }, quantity] } },
    { $inc: { reserved: quantity } },
    { session },
  );
  if (result.modifiedCount === 0) {
    const current = await StockLevel.findOne(key).session(session).lean();
    throw new InsufficientStockError(productId, current ? current.onHand - current.reserved : 0);
  }
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
