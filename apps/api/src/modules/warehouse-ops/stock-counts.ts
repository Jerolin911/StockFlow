import { Router } from 'express';
import { Types, type FilterQuery } from 'mongoose';
import {
  createStockCountSchema,
  listStockCountsQuerySchema,
  postStockCountSchema,
  reasonBodySchema,
  recordCountsSchema,
  type ListStockCountsQuery,
  type StockCountDto,
  type StockCountStatus,
  type VarianceReason,
} from '@stockflow/shared';
import type { z } from 'zod';
import { nextDocumentNumber } from '../../lib/counters.js';
import { AppError, invalidState, isDuplicateKeyError, notFound } from '../../lib/errors.js';
import { parseId } from '../../lib/http.js';
import { inTransaction } from '../../lib/transaction.js';
import { notify } from '../notifications/notifications.js';
import { authenticate, authorize, requireAuth } from '../../middleware/auth.js';
import { Category } from '../categories/categories.js';
import {
  historyDto,
  historyEntry,
  requireActiveWarehouse,
  snapshot,
  userRef,
  validation,
  warehouseLookup,
  warehouseRef,
  type Actor,
} from '../common/documents.js';
import { Product } from '../products/product.model.js';
import { StockAdjustment } from '../stock/stock-adjustment.model.js';
import { StockLevel } from '../stock/stock-level.model.js';
import { applyMovement } from '../stock/stock.service.js';
import { StockCount, type StockCountRecord } from './models.js';

type CreateInput = z.output<typeof createStockCountSchema>;
type PostInput = z.output<typeof postStockCountSchema>;
type Issue = { path: string; message: string };

async function currentLevels(warehouseId: Types.ObjectId, productIds: Types.ObjectId[]) {
  const levels = await StockLevel.find(
    { warehouseId, productId: { $in: productIds } },
    { productId: 1, onHand: 1, reserved: 1 },
  ).lean();
  return new Map(levels.map((l) => [l.productId.toString(), l]));
}

async function toDto(c: StockCountRecord): Promise<StockCountDto> {
  const posted = c.status === 'posted';
  const [warehouses, levels] = await Promise.all([
    warehouseLookup([c.warehouseId]),
    currentLevels(
      c.warehouseId,
      c.lines.map((l) => l.productId),
    ),
  ]);
  const lines = c.lines.map((l) => {
    const level = levels.get(l.productId.toString());
    const system = posted ? (l.systemQuantity ?? 0) : (level?.onHand ?? 0);
    const counted = l.countedQuantity ?? null;
    return {
      id: l._id.toString(),
      productId: l.productId.toString(),
      sku: l.sku,
      name: l.name,
      unit: l.unit,
      snapshotQuantity: l.snapshotQuantity,
      systemQuantity: system,
      countedQuantity: counted,
      variance: posted ? (l.variance ?? 0) : counted === null ? null : counted - system,
      reason: (l.reason as VarianceReason | null) ?? null,
      note: l.note,
      reserved: level?.reserved ?? 0,
    };
  });
  return {
    id: c._id.toString(),
    number: c.number,
    status: c.status as StockCountStatus,
    warehouse: warehouseRef(warehouses, c.warehouseId),
    category: c.category?._id
      ? { id: c.category._id.toString(), name: c.category.name ?? '' }
      : null,
    notes: c.notes,
    lines,
    progress: {
      counted: lines.filter((l) => l.countedQuantity !== null).length,
      total: lines.length,
      withVariance: lines.filter((l) => l.variance !== null && l.variance !== 0).length,
    },
    adjustment: c.adjustment
      ? { id: c.adjustment._id.toString(), number: c.adjustment.number }
      : null,
    createdBy: userRef(c.createdBy)!,
    submittedBy: userRef(c.submittedBy),
    postedBy: userRef(c.postedBy),
    postedAt: c.postedAt ? c.postedAt.toISOString() : null,
    history: historyDto(c.history),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export async function getStockCount(id: string): Promise<StockCountDto> {
  const c = await StockCount.findById(id).lean<StockCountRecord>();
  if (!c) throw notFound('Stock count');
  return toDto(c);
}

/**
 * Starts a count sheet for every active product held in the warehouse (optionally one
 * category), recording on-hand at the start for reference. One open count per warehouse.
 */
export async function createStockCount(input: CreateInput, actor: Actor): Promise<string> {
  const warehouse = await requireActiveWarehouse(input.warehouseId);
  let category = null;
  if (input.categoryId) {
    category = await Category.findById(input.categoryId, { name: 1 }).lean();
    if (!category) throw validation('categoryId', 'Category not found');
  }
  const levels = await StockLevel.find(
    { warehouseId: warehouse._id },
    { productId: 1, onHand: 1 },
  ).lean();
  const products = await Product.find({
    _id: { $in: levels.map((l) => l.productId) },
    isActive: true,
    ...(category ? { categoryId: category._id } : {}),
  })
    .sort({ sku: 1 })
    .lean();
  if (products.length === 0) {
    throw validation(
      category ? 'categoryId' : 'warehouseId',
      category
        ? `No ${category.name} products are held in ${warehouse.code}`
        : `No products are held in ${warehouse.code}`,
    );
  }
  const onHandFor = new Map(levels.map((l) => [l.productId.toString(), l.onHand]));

  try {
    const [doc] = await StockCount.create([
      {
        number: await nextDocumentNumber('CNT'),
        status: 'counting',
        isOpen: true,
        warehouseId: warehouse._id,
        category: category ? { _id: category._id, name: category.name } : null,
        notes: input.notes,
        lines: products.map((p) => ({
          productId: p._id,
          sku: p.sku,
          name: p.name,
          unit: p.unit,
          snapshotQuantity: onHandFor.get(p._id.toString()) ?? 0,
        })),
        createdBy: snapshot(actor),
        history: [
          historyEntry(
            actor,
            'count_started',
            `${products.length} products${category ? ` in ${category.name}` : ''}`,
          ),
        ],
      },
    ]);
    return doc!._id.toString();
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw invalidState(
        `${warehouse.code} already has a count in progress. Finish or cancel it first.`,
      );
    }
    throw error;
  }
}

/**
 * Records counted quantities. Each line is set individually, so people counting different
 * products at the same time don't overwrite each other.
 */
async function recordCounts(id: string, input: z.output<typeof recordCountsSchema>) {
  const count = await StockCount.findById(id, { status: 1, 'lines._id': 1 }).lean();
  if (!count) throw notFound('Stock count');
  if (count.status !== 'counting') throw invalidState('Only counts in progress can be edited');
  const known = new Set(count.lines.map((l) => l._id.toString()));
  const issues: Issue[] = input.lines.flatMap((entry, index) =>
    known.has(entry.lineId)
      ? []
      : [{ path: `lines.${index}.lineId`, message: 'Not on this count' }],
  );
  if (issues.length > 0) throw new AppError(400, 'VALIDATION_ERROR', issues[0]!.message, issues);

  const set: Record<string, number | null> = {};
  const arrayFilters = input.lines.map((entry, index) => {
    set[`lines.$[l${index}].countedQuantity`] = entry.countedQuantity;
    return { [`l${index}._id`]: new Types.ObjectId(entry.lineId) };
  });
  const result = await StockCount.updateOne(
    { _id: id, status: 'counting' },
    { $set: set },
    { arrayFilters },
  );
  if (result.matchedCount === 0) throw invalidState('Only counts in progress can be edited');
}

/**
 * Applies the variances: each line's counted quantity minus on-hand now, read inside the
 * transaction. Every variance needs a reason; together they post one adjustment (reason:
 * count) whose lines carry their own reason. A count below the reserved quantity is refused
 * because it would leave confirmed orders without stock.
 */
async function postStockCount(id: string, input: PostInput, actor: Actor) {
  await inTransaction(async (session) => {
    const count = await StockCount.findById(id).session(session);
    if (!count) throw notFound('Stock count');
    if (count.status !== 'submitted') {
      throw invalidState('Submit the count before posting it');
    }
    const warehouse = await requireActiveWarehouse(count.warehouseId.toString(), session);
    const reasons = new Map(input.lines.map((l) => [l.lineId, l]));
    const levels = await StockLevel.find(
      { warehouseId: count.warehouseId, productId: { $in: count.lines.map((l) => l.productId) } },
      { productId: 1, onHand: 1, reserved: 1 },
    )
      .session(session)
      .lean();
    const levelFor = new Map(levels.map((l) => [l.productId.toString(), l]));

    const issues: Issue[] = [];
    count.lines.forEach((line, index) => {
      const level = levelFor.get(line.productId.toString());
      const system = level?.onHand ?? 0;
      const variance = (line.countedQuantity ?? 0) - system;
      const given = reasons.get(line._id.toString());
      line.systemQuantity = system;
      line.variance = variance;
      line.reason = variance === 0 ? null : (given?.reason ?? null);
      line.note = given?.note ?? '';
      if (variance === 0) return;
      if (!line.reason) {
        issues.push({ path: `lines.${index}.reason`, message: `Give a reason for ${line.sku}` });
      } else if (variance > 0 && (line.reason === 'damage' || line.reason === 'loss')) {
        issues.push({
          path: `lines.${index}.reason`,
          message: 'A surplus can’t be damaged or lost',
        });
      } else if (variance < 0 && line.reason === 'found') {
        issues.push({ path: `lines.${index}.reason`, message: 'A shortfall can’t be found stock' });
      }
      if ((line.countedQuantity ?? 0) < (level?.reserved ?? 0)) {
        issues.push({
          path: `lines.${index}.countedQuantity`,
          message: `${line.sku}: counted ${line.countedQuantity}, but ${level!.reserved} are reserved for orders`,
        });
      }
    });
    if (issues.length > 0) throw new AppError(400, 'VALIDATION_ERROR', issues[0]!.message, issues);

    const changed = count.lines.filter((l) => l.variance !== 0);
    if (changed.length > 0) {
      const products = await Product.find(
        { _id: { $in: changed.map((l) => l.productId) } },
        { avgCost: 1 },
      )
        .session(session)
        .lean();
      const costFor = new Map(products.map((p) => [p._id.toString(), p.avgCost]));
      const adjustmentId = new Types.ObjectId();
      const number = await nextDocumentNumber('ADJ', session);
      const createdBy = new Types.ObjectId(actor.id);
      const lines = [];
      for (const line of changed) {
        const unitCost = costFor.get(line.productId.toString()) ?? 0;
        const { previousOnHand, balanceAfter } = await applyMovement(
          {
            productId: line.productId,
            warehouseId: count.warehouseId,
            type: 'ADJUSTMENT',
            quantity: line.variance!,
            unitCost,
            reference: { type: 'adjustment', id: adjustmentId, number },
            createdBy,
          },
          session,
        );
        lines.push({
          productId: line.productId,
          sku: line.sku,
          name: line.name,
          unit: line.unit,
          quantityChange: line.variance!,
          previousOnHand,
          balanceAfter,
          unitCost,
          reason: line.reason,
        });
      }
      await StockAdjustment.create(
        [
          {
            _id: adjustmentId,
            number,
            type: 'adjustment',
            warehouseId: warehouse._id,
            reason: 'count',
            notes: `Stock count ${count.number}`,
            lines,
            source: { type: 'stockCount', _id: count._id, number: count.number },
            createdBy,
          },
        ],
        { session },
      );
      count.adjustment = { _id: adjustmentId, number };
    }

    count.status = 'posted';
    count.isOpen = false;
    count.postedBy = snapshot(actor);
    count.postedAt = new Date();
    const net = changed.reduce((s, l) => s + l.variance!, 0);
    count.history.push(
      historyEntry(
        actor,
        'posted',
        changed.length === 0
          ? 'No variances'
          : `${changed.length} variance${changed.length === 1 ? '' : 's'} (net ${net > 0 ? '+' : ''}${net}) in ${count.adjustment!.number}`,
      ),
    );
    await count.save({ session });
    await notify(
      { userIds: [count.createdBy._id, count.submittedBy?._id], exclude: actor.id },
      {
        type: 'stock_count',
        title: `${count.number} posted`,
        body:
          changed.length === 0
            ? 'No variances'
            : `${changed.length} variance${changed.length === 1 ? '' : 's'} adjusted in ${count.adjustment!.number}`,
        link: `/stock/counts/${count._id.toString()}`,
      },
      session,
    );
  });
}

async function transition(
  id: string,
  from: StockCountStatus,
  set: Record<string, unknown>,
  entry: ReturnType<typeof historyEntry>,
  message: string,
) {
  const updated = await StockCount.findOneAndUpdate(
    { _id: id, status: from },
    { $set: set, $push: { history: entry } },
  );
  if (!updated) {
    if (!(await StockCount.exists({ _id: id }))) throw notFound('Stock count');
    throw invalidState(message);
  }
}

async function listStockCounts(query: ListStockCountsQuery) {
  const filter: FilterQuery<StockCountRecord> = {};
  if (query.status) filter.status = query.status;
  if (query.warehouseId) filter.warehouseId = new Types.ObjectId(query.warehouseId);
  const [rows, total] = await Promise.all([
    StockCount.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<StockCountRecord[]>(),
    StockCount.countDocuments(filter),
  ]);
  return {
    data: await Promise.all(rows.map(toDto)),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

export function createStockCountsRouter(): Router {
  const router = Router();
  router.use(authenticate());

  router.get('/', async (req, res) => {
    res.json(await listStockCounts(listStockCountsQuerySchema.parse(req.query)));
  });

  router.get('/:id', async (req, res) => {
    res.json({ data: await getStockCount(parseId(req.params.id, 'Stock count')) });
  });

  router.post('/', authorize('stock:count'), async (req, res) => {
    const id = await createStockCount(
      createStockCountSchema.parse(req.body),
      requireAuth(req).user,
    );
    res.status(201).json({ data: await getStockCount(id) });
  });

  router.put('/:id/counts', authorize('stock:count'), async (req, res) => {
    const id = parseId(req.params.id, 'Stock count');
    await recordCounts(id, recordCountsSchema.parse(req.body));
    res.json({ data: await getStockCount(id) });
  });

  router.post('/:id/submit', authorize('stock:count'), async (req, res) => {
    const id = parseId(req.params.id, 'Stock count');
    const count = await StockCount.findById(id, { lines: 1 }).lean();
    if (!count) throw notFound('Stock count');
    const missing = count.lines.filter((l) => l.countedQuantity === null).length;
    if (missing > 0) {
      throw validation(
        'lines',
        `${missing} product${missing === 1 ? ' hasn’t' : 's haven’t'} been counted yet`,
      );
    }
    const actor = requireAuth(req).user;
    await transition(
      id,
      'counting',
      { status: 'submitted', submittedBy: snapshot(actor) },
      historyEntry(actor, 'submitted'),
      'Only counts in progress can be submitted',
    );
    await notify(
      { permissions: ['stock:adjust'], exclude: actor.id },
      {
        type: 'stock_count',
        title: `Stock count ready to post`,
        body: `Submitted by ${actor.name}; review the variances`,
        link: `/stock/counts/${id}`,
      },
    );
    res.json({ data: await getStockCount(id) });
  });

  router.post('/:id/reopen', authorize('stock:count'), async (req, res) => {
    const id = parseId(req.params.id, 'Stock count');
    await transition(
      id,
      'submitted',
      { status: 'counting', submittedBy: null },
      historyEntry(requireAuth(req).user, 'reopened'),
      'Only submitted counts can be reopened',
    );
    res.json({ data: await getStockCount(id) });
  });

  router.post('/:id/post', authorize('stock:adjust'), async (req, res) => {
    const id = parseId(req.params.id, 'Stock count');
    await postStockCount(id, postStockCountSchema.parse(req.body), requireAuth(req).user);
    res.json({ data: await getStockCount(id) });
  });

  router.post('/:id/cancel', authorize('stock:count'), async (req, res) => {
    const id = parseId(req.params.id, 'Stock count');
    const { reason } = reasonBodySchema.parse(req.body);
    const actor = requireAuth(req).user;
    const updated = await StockCount.findOneAndUpdate(
      { _id: id, status: { $in: ['counting', 'submitted'] } },
      {
        $set: { status: 'cancelled', isOpen: false },
        $push: { history: historyEntry(actor, 'cancelled', reason) },
      },
    );
    if (!updated) {
      if (!(await StockCount.exists({ _id: id }))) throw notFound('Stock count');
      throw invalidState('Posted counts can’t be cancelled. Reverse the adjustment instead.');
    }
    res.json({ data: await getStockCount(id) });
  });

  return router;
}
