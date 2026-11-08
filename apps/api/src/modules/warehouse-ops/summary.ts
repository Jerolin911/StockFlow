import { Router } from 'express';
import type { WarehouseOpsSummaryDto } from '@stockflow/shared';
import { authenticate } from '../../middleware/auth.js';
import { CustomerReturn, SupplierReturn } from '../returns/models.js';
import { StockLevel } from '../stock/stock-level.model.js';
import { StockCount, StockTransfer } from './models.js';

async function summary(): Promise<WarehouseOpsSummaryDto> {
  const [
    transfersToApprove,
    transfersToDispatch,
    transfersInTransit,
    countsInProgress,
    returnsToApprove,
    returnsToReceive,
    returnsToInspect,
    supplierReturnsOpen,
    quarantine,
  ] = await Promise.all([
    StockTransfer.countDocuments({ status: 'requested' }),
    StockTransfer.countDocuments({ status: 'approved' }),
    StockTransfer.countDocuments({ status: { $in: ['in_transit', 'partially_received'] } }),
    StockCount.countDocuments({ isOpen: true }),
    CustomerReturn.countDocuments({ status: 'requested' }),
    CustomerReturn.countDocuments({ status: 'approved' }),
    CustomerReturn.countDocuments({ status: 'received' }),
    SupplierReturn.countDocuments({ status: { $in: ['requested', 'approved'] } }),
    StockLevel.aggregate<{ total: number }>([
      { $match: { quarantine: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$quarantine' } } },
    ]),
  ]);
  return {
    transfersToApprove,
    transfersToDispatch,
    transfersInTransit,
    countsInProgress,
    returnsToApprove,
    returnsToReceive,
    returnsToInspect,
    supplierReturnsOpen,
    quarantinedUnits: quarantine[0]?.total ?? 0,
  };
}

export function createWarehouseOpsRouter(): Router {
  const router = Router();
  router.use(authenticate());
  router.get('/summary', async (_req, res) => {
    res.json({ data: await summary() });
  });
  return router;
}
