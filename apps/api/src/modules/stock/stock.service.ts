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
