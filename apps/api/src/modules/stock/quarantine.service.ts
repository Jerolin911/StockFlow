import { Types, type ClientSession } from 'mongoose';
import type { QuarantineAction, quarantineActionSchema } from '@stockflow/shared';
import type { z } from 'zod';
import { nextDocumentNumber } from '../../lib/counters.js';
import { AppError } from '../../lib/errors.js';
import { inTransaction } from '../../lib/transaction.js';
import { requireActiveWarehouse } from '../common/documents.js';
import { Product } from '../products/product.model.js';
import { StockAdjustment } from './stock-adjustment.model.js';
import { InsufficientStockError, applyMovement, type MovementInput } from './stock.service.js';

type Input = z.output<typeof quarantineActionSchema>;

const TYPE: Record<QuarantineAction, MovementInput['type']> = {
  quarantine: 'QUARANTINE',
  release: 'RELEASE',
  write_off: 'WRITE_OFF',
};

/**
 * Moves stock between a warehouse's usable and quarantine buckets, or writes off quarantined
 * units, as one numbered document with a movement per bucket change.
 * - quarantine: usable −q, quarantine +q (only unreserved stock can be isolated)
 * - release:    quarantine −q, usable +q
 * - write_off:  quarantine −q
 */
export async function moveBetweenBuckets(
  args: {
    warehouseId: Types.ObjectId;
    productId: Types.ObjectId;
    quantity: number;
    action: QuarantineAction;
    unitCost: number;
    reference: MovementInput['reference'];
    createdBy: Types.ObjectId;
  },
  session: ClientSession,
) {
  const base = {
    productId: args.productId,
    warehouseId: args.warehouseId,
    type: TYPE[args.action],
    unitCost: args.unitCost,
    reference: args.reference,
    createdBy: args.createdBy,
  };
  if (args.action === 'quarantine') {
    await applyMovement({ ...base, quantity: -args.quantity, bucket: 'usable' }, session);
    return applyMovement({ ...base, quantity: args.quantity, bucket: 'quarantine' }, session);
  }
  const out = await applyMovement(
    { ...base, quantity: -args.quantity, bucket: 'quarantine' },
    session,
  );
  if (args.action === 'write_off') return out;
  return applyMovement({ ...base, quantity: args.quantity, bucket: 'usable' }, session);
}

export async function postQuarantineAction(input: Input, actorId: string): Promise<string> {
  return inTransaction(async (session) => {
    const warehouse = await requireActiveWarehouse(input.warehouseId, session);
    const products = await Product.find({ _id: { $in: input.lines.map((l) => l.productId) } })
      .session(session)
      .lean();
    const productFor = new Map(products.map((p) => [p._id.toString(), p]));

    const documentId = new Types.ObjectId();
    const number = await nextDocumentNumber('QTN', session);
    const createdBy = new Types.ObjectId(actorId);
    const issues: { path: string; message: string }[] = [];
    const lines = [];

    for (const [index, line] of input.lines.entries()) {
      const product = productFor.get(line.productId);
      if (!product) {
        issues.push({ path: `lines.${index}.productId`, message: 'Product not found' });
        continue;
      }
      try {
        const result = await moveBetweenBuckets(
          {
            warehouseId: warehouse._id,
            productId: product._id,
            quantity: line.quantity,
            action: input.action,
            unitCost: product.avgCost,
            reference: { type: 'adjustment', id: documentId, number },
            createdBy,
          },
          session,
        );
        const usableChange =
          input.action === 'quarantine'
            ? -line.quantity
            : input.action === 'release'
              ? line.quantity
              : 0;
        lines.push({
          productId: product._id,
          sku: product.sku,
          name: product.name,
          unit: product.unit,
          quantityChange: input.action === 'release' ? line.quantity : -line.quantity,
          previousOnHand: result.balanceAfter - usableChange,
          balanceAfter: result.balanceAfter,
          previousQuarantine:
            result.quarantineAfter +
            (input.action === 'quarantine' ? -line.quantity : line.quantity),
          quarantineAfter: result.quarantineAfter,
          unitCost: product.avgCost,
        });
      } catch (error) {
        if (!(error instanceof InsufficientStockError)) throw error;
        issues.push({
          path: `lines.${index}.quantity`,
          message:
            error.bucket === 'quarantine'
              ? `Only ${error.available} ${product.unit} of ${product.sku} in quarantine at ${warehouse.code}`
              : `Only ${Math.max(error.available, 0)} ${product.unit} of ${product.sku} available at ${warehouse.code}`,
        });
      }
    }
    if (issues.length > 0) {
      const insufficient = issues.some((i) => i.path.endsWith('.quantity'));
      throw new AppError(
        insufficient ? 409 : 400,
        insufficient ? 'INSUFFICIENT_STOCK' : 'VALIDATION_ERROR',
        issues[0]!.message,
        issues,
      );
    }

    await StockAdjustment.create(
      [
        {
          _id: documentId,
          number,
          type: input.action,
          warehouseId: warehouse._id,
          reason: input.reason,
          notes: input.notes,
          lines,
          createdBy,
        },
      ],
      { session },
    );
    return documentId.toString();
  });
}
