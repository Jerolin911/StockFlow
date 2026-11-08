import { Router } from 'express';
import {
  availabilityQuerySchema,
  listAdjustmentsQuerySchema,
  listMovementsQuerySchema,
  listQuarantineQuerySchema,
  listStockLevelsQuerySchema,
  openingStockSchema,
  quarantineActionSchema,
  reversalSchema,
  stockAdjustmentSchema,
  updateThresholdSchema,
} from '@stockflow/shared';
import { notFound } from '../../lib/errors.js';
import { parseId } from '../../lib/http.js';
import { authenticate, authorize, requireAuth } from '../../middleware/auth.js';
import { postAdjustment, registerOpeningStock, reverseAdjustment } from './adjustments.service.js';
import { postQuarantineAction } from './quarantine.service.js';
import { StockLevel } from './stock-level.model.js';
import {
  getAdjustment,
  getStockLevel,
  listAdjustments,
  listMovements,
  listQuarantine,
  listStockLevels,
  productAvailability,
} from './stock.queries.js';

export function createStockRouter(): Router {
  const router = Router();
  router.use(authenticate());

  router.get('/levels', async (req, res) => {
    res.json(await listStockLevels(listStockLevelsQuerySchema.parse(req.query)));
  });

  // The threshold is configuration, not a quantity, so it changes without a movement.
  router.patch('/levels/:id', authorize('products:write'), async (req, res) => {
    const id = parseId(req.params.id, 'Stock level');
    const { reorderPoint } = updateThresholdSchema.parse(req.body);
    const updated = await StockLevel.findByIdAndUpdate(id, { $set: { reorderPoint } });
    if (!updated) throw notFound('Stock level');
    res.json({ data: await getStockLevel(id) });
  });

  router.get('/availability', async (req, res) => {
    const { productIds } = availabilityQuerySchema.parse(req.query);
    res.json({ data: await productAvailability(productIds) });
  });

  router.get('/movements', async (req, res) => {
    res.json(await listMovements(listMovementsQuerySchema.parse(req.query)));
  });

  router.get('/adjustments', async (req, res) => {
    res.json(await listAdjustments(listAdjustmentsQuerySchema.parse(req.query)));
  });

  router.get('/adjustments/:id', async (req, res) => {
    res.json({ data: await getAdjustment(parseId(req.params.id, 'Stock adjustment')) });
  });

  router.post('/adjustments', authorize('stock:adjust'), async (req, res) => {
    const id = await postAdjustment(
      stockAdjustmentSchema.parse(req.body),
      requireAuth(req).user.id,
    );
    res.status(201).json({ data: await getAdjustment(id) });
  });

  router.post('/adjustments/:id/reverse', authorize('stock:adjust'), async (req, res) => {
    const id = parseId(req.params.id, 'Stock adjustment');
    const { reason } = reversalSchema.parse(req.body);
    const reversal = await reverseAdjustment(id, reason, requireAuth(req).user.id);
    res.status(201).json({ data: await getAdjustment(reversal) });
  });

  router.get('/quarantine', async (req, res) => {
    res.json(await listQuarantine(listQuarantineQuerySchema.parse(req.query)));
  });

  router.post('/quarantine', authorize('stock:adjust'), async (req, res) => {
    const id = await postQuarantineAction(
      quarantineActionSchema.parse(req.body),
      requireAuth(req).user.id,
    );
    res.status(201).json({ data: await getAdjustment(id) });
  });

  router.post('/opening', authorize('stock:adjust'), async (req, res) => {
    const id = await registerOpeningStock(
      openingStockSchema.parse(req.body),
      requireAuth(req).user.id,
    );
    res.status(201).json({ data: await getAdjustment(id) });
  });

  return router;
}
