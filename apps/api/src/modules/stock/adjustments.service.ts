import { Types, type ClientSession } from 'mongoose';
import type { openingStockSchema, stockAdjustmentSchema } from '@stockflow/shared';
import type { z } from 'zod';
import { nextDocumentNumber } from '../../lib/counters.js';
import { AppError, invalidState } from '../../lib/errors.js';
import { inTransaction } from '../../lib/transaction.js';
import { Product, type ProductRecord } from '../products/product.model.js';
import { Warehouse } from '../warehouses/warehouse.model.js';
import { StockAdjustment } from './stock-adjustment.model.js';
import { StockLevel } from './stock-level.model.js';
import { StockMovement } from './stock-movement.model.js';
import { InsufficientStockError, applyMovement, updateAverageCost } from './stock.service.js';

type OpeningInput = z.output<typeof openingStockSchema>;
type AdjustmentInput = z.output<typeof stockAdjustmentSchema>;
type LineIssue = { path: string; message: string };

const lineErrors = (details: LineIssue[]) =>
  new AppError(400, 'VALIDATION_ERROR', details[0]?.message ?? 'Some lines are invalid', details);

async function requireActiveWarehouse(warehouseId: string, session: ClientSession) {
  const warehouse = await Warehouse.findById(warehouseId).session(session).lean();
  if (!warehouse) throw lineErrors([{ path: 'warehouseId', message: 'Warehouse not found' }]);
  if (!warehouse.isActive) {
    throw lineErrors([{ path: 'warehouseId', message: 'This warehouse is deactivated' }]);
  }
  return warehouse;
}

async function loadProducts(
  lines: { productId: string }[],
  session: ClientSession,
  { requireActive }: { requireActive: boolean },
) {
  const products = await Product.find({ _id: { $in: lines.map((l) => l.productId) } })
    .session(session)
    .lean();
  const byId = new Map(products.map((p) => [p._id.toString(), p]));
  const issues: LineIssue[] = [];
  lines.forEach((line, index) => {
    const product = byId.get(line.productId);
    if (!product) issues.push({ path: `lines.${index}.productId`, message: 'Product not found' });
    else if (requireActive && !product.isActive) {
      issues.push({ path: `lines.${index}.productId`, message: `${product.sku} is inactive` });
    }
  });
  if (issues.length > 0) throw lineErrors(issues);
  return (id: string) => byId.get(id)!;
}

function insufficientStock(error: InsufficientStockError, index: number, product: ProductRecord) {
  const message = `Only ${error.available} ${product.unit} of ${product.sku} available`;
  return new AppError(409, 'INSUFFICIENT_STOCK', message, [
    { path: `lines.${index}.quantityChange`, message },
  ]);
}

/**
 * Records the first stock of products in a warehouse. Allowed only while the product
 * has no movements in that warehouse; later corrections go through adjustments.
 */
export async function registerOpeningStock(input: OpeningInput, actorId: string): Promise<string> {
  return inTransaction(async (session) => {
    const warehouse = await requireActiveWarehouse(input.warehouseId, session);
    const productFor = await loadProducts(input.lines, session, { requireActive: true });

    const alreadyStocked = new Set(
      (
        await StockMovement.distinct('productId', {
          warehouseId: warehouse._id,
          productId: { $in: input.lines.map((l) => new Types.ObjectId(l.productId)) },
        }).session(session)
      ).map(String),
    );
    const conflicts = input.lines.flatMap((line, index) =>
      alreadyStocked.has(line.productId)
        ? [
            {
              path: `lines.${index}.productId`,
              message: `${productFor(line.productId).sku} already has stock history in ${warehouse.code}. Use an adjustment.`,
            },
          ]
        : [],
    );
    if (conflicts.length > 0) throw lineErrors(conflicts);

    const documentId = new Types.ObjectId();
    const number = await nextDocumentNumber('OPN', session);
    const createdBy = new Types.ObjectId(actorId);
    const lines = [];

    for (const line of input.lines) {
      const product = productFor(line.productId);
      const unitCost = line.unitCost ?? product.costPrice;
      await updateAverageCost(product._id, line.quantity, unitCost, session);
      const { previousOnHand, balanceAfter } = await applyMovement(
        {
          productId: product._id,
          warehouseId: warehouse._id,
          type: 'OPENING',
          quantity: line.quantity,
          unitCost,
          reference: { type: 'opening', id: documentId, number },
          createdBy,
        },
        session,
      );
      lines.push({
        productId: product._id,
        sku: product.sku,
        name: product.name,
        unit: product.unit,
        quantityChange: line.quantity,
        previousOnHand,
        balanceAfter,
        unitCost,
      });
    }

    await StockAdjustment.create(
      [
        {
          _id: documentId,
          number,
          type: 'opening',
          warehouseId: warehouse._id,
          reason: null,
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

/**
 * Posts a stock adjustment. For stock counts the change is counted − on hand, read inside
 * the transaction so a concurrent movement forces a retry rather than a wrong delta.
 */
export async function postAdjustment(input: AdjustmentInput, actorId: string): Promise<string> {
  return inTransaction(async (session) => {
    const warehouse = await requireActiveWarehouse(input.warehouseId, session);
    const productFor = await loadProducts(input.lines, session, { requireActive: false });

    const documentId = new Types.ObjectId();
    const createdBy = new Types.ObjectId(actorId);
    // Numbered up front so movements can reference it; an aborted transaction releases it.
    const number = await nextDocumentNumber('ADJ', session);
    const lines = [];

    for (const [index, line] of input.lines.entries()) {
      const product = productFor(line.productId);
      let change = line.quantityChange ?? 0;
      if (line.countedQuantity !== undefined) {
        const level = await StockLevel.findOne({
          productId: product._id,
          warehouseId: warehouse._id,
        })
          .session(session)
          .lean();
        change = line.countedQuantity - (level?.onHand ?? 0);
      }
      if (change === 0) continue;

      try {
        const { previousOnHand, balanceAfter } = await applyMovement(
          {
            productId: product._id,
            warehouseId: warehouse._id,
            type: 'ADJUSTMENT',
            quantity: change,
            unitCost: product.avgCost,
            reference: { type: 'adjustment', id: documentId, number },
            createdBy,
          },
          session,
        );
        lines.push({
          productId: product._id,
          sku: product.sku,
          name: product.name,
          unit: product.unit,
          quantityChange: change,
          previousOnHand,
          balanceAfter,
          unitCost: product.avgCost,
        });
      } catch (error) {
        if (!(error instanceof InsufficientStockError)) throw error;
        if (line.countedQuantity !== undefined) {
          // A count below the reserved quantity would leave reservations unbacked.
          throw invalidState(
            `${product.sku}: the counted quantity is below the reserved quantity in ${warehouse.code}.`,
          );
        }
        throw insufficientStock(error, index, product);
      }
    }

    if (lines.length === 0) {
      throw invalidState('The counted quantities match current stock. Nothing to adjust.');
    }

    await StockAdjustment.create(
      [
        {
          _id: documentId,
          number,
          type: 'adjustment',
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
