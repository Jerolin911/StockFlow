import { z } from 'zod';
import { objectIdSchema, paginationQuerySchema } from './common.js';
import {
  MAX_QUANTITY,
  nonNegativeQuantity,
  optionalText,
  positiveQuantity,
  requiredText,
  sortParam,
} from './fields.js';
import type { ADJUSTMENT_REASONS } from './stock.js';

const uniqueProducts = (lines: { productId: string }[]) =>
  new Set(lines.map((line) => line.productId)).size === lines.length;

const uniqueLines = (lines: { lineId: string }[]) =>
  new Set(lines.map((line) => line.lineId)).size === lines.length;

// Transfers

export const TRANSFER_STATUSES = [
  'requested',
  'approved',
  'in_transit',
  'partially_received',
  'received',
  'closed',
  'rejected',
  'cancelled',
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  requested: 'Awaiting approval',
  approved: 'Approved',
  in_transit: 'In transit',
  partially_received: 'Partially received',
  received: 'Received',
  closed: 'Closed short',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

/** Dispatched and not fully accounted for at the destination. */
export const IN_TRANSIT_TRANSFER_STATUSES = ['in_transit', 'partially_received'] as const;

export const transferSchema = z
  .object({
    fromWarehouseId: objectIdSchema,
    toWarehouseId: objectIdSchema,
    neededBy: z.iso.date('Use YYYY-MM-DD').nullable().default(null),
    notes: optionalText(1000).default(''),
    lines: z
      .array(z.object({ productId: objectIdSchema, quantity: positiveQuantity }))
      .min(1, 'Add at least one product')
      .max(200)
      .refine(uniqueProducts, 'Each product can appear only once'),
  })
  .refine((t) => t.fromWarehouseId !== t.toWarehouseId, {
    path: ['toWarehouseId'],
    message: 'Choose a different warehouse from the source',
  });

export const dispatchTransferSchema = z.object({
  carrier: optionalText(100).default(''),
  reference: optionalText(100).default(''),
  // Omitted lines ship their full requested quantity; 0 drops a line from the shipment.
  lines: z
    .array(z.object({ lineId: objectIdSchema, quantity: nonNegativeQuantity }))
    .max(200)
    .refine(uniqueLines, 'Each line can appear only once')
    .default([]),
});

export const receiveTransferSchema = z.object({
  note: optionalText(500).default(''),
  lines: z
    .array(
      z
        .object({
          lineId: objectIdSchema,
          receivedQuantity: nonNegativeQuantity.default(0),
          damagedQuantity: nonNegativeQuantity.default(0),
        })
        .refine((l) => l.receivedQuantity + l.damagedQuantity <= MAX_QUANTITY, 'Too large'),
    )
    .min(1, 'Add at least one line')
    .max(200)
    .refine(uniqueLines, 'Each line can appear only once')
    .refine(
      (lines) => lines.some((l) => l.receivedQuantity + l.damagedQuantity > 0),
      'Enter what arrived for at least one line',
    ),
});

export const listTransfersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(TRANSFER_STATUSES).optional(),
  inTransit: z.enum(['true']).optional(),
  warehouseId: objectIdSchema.optional(),
  productId: objectIdSchema.optional(),
  sort: sortParam(['createdAt', 'number'] as const, '-createdAt'),
});

export type TransferInput = z.input<typeof transferSchema>;
export type DispatchTransferInput = z.input<typeof dispatchTransferSchema>;
export type ReceiveTransferInput = z.input<typeof receiveTransferSchema>;
export type ListTransfersQuery = z.infer<typeof listTransfersQuerySchema>;

// Physical inventory counts

export const STOCK_COUNT_STATUSES = ['counting', 'submitted', 'posted', 'cancelled'] as const;
export type StockCountStatus = (typeof STOCK_COUNT_STATUSES)[number];

export const STOCK_COUNT_STATUS_LABELS: Record<StockCountStatus, string> = {
  counting: 'Counting',
  submitted: 'Awaiting review',
  posted: 'Posted',
  cancelled: 'Cancelled',
};

/** Reasons for a count variance: shortages are damaged, lost or a miscount; surpluses are found. */
export const VARIANCE_REASONS = [
  'damage',
  'loss',
  'found',
  'correction',
] as const satisfies readonly (typeof ADJUSTMENT_REASONS)[number][];
export type VarianceReason = (typeof VARIANCE_REASONS)[number];

export const createStockCountSchema = z.object({
  warehouseId: objectIdSchema,
  // Limits the count to one category; otherwise every product held in the warehouse.
  categoryId: objectIdSchema.nullable().default(null),
  notes: optionalText(500).default(''),
});

export const recordCountsSchema = z.object({
  lines: z
    .array(z.object({ lineId: objectIdSchema, countedQuantity: nonNegativeQuantity.nullable() }))
    .min(1)
    .max(1000)
    .refine(uniqueLines, 'Each line can appear only once'),
});

export const postStockCountSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: objectIdSchema,
        reason: z.enum(VARIANCE_REASONS).nullable().default(null),
        note: optionalText(200).default(''),
      }),
    )
    .max(1000)
    .refine(uniqueLines, 'Each line can appear only once')
    .default([]),
});

export const listStockCountsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(STOCK_COUNT_STATUSES).optional(),
  warehouseId: objectIdSchema.optional(),
});

export type CreateStockCountInput = z.input<typeof createStockCountSchema>;
export type RecordCountsInput = z.input<typeof recordCountsSchema>;
export type PostStockCountInput = z.input<typeof postStockCountSchema>;
export type ListStockCountsQuery = z.infer<typeof listStockCountsQuerySchema>;

export const reversalSchema = z.object({ reason: requiredText('a reason', 500) });
