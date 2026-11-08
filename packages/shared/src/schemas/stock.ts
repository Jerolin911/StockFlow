import { z } from 'zod';
import { objectIdSchema, paginationQuerySchema } from './common.js';
import {
  MAX_QUANTITY,
  dateParam,
  moneySchema,
  nonNegativeQuantity,
  optionalText,
  positiveQuantity,
  sortParam,
} from './fields.js';

export const MOVEMENT_TYPES = ['OPENING', 'ADJUSTMENT', 'RECEIPT', 'SHIPMENT'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  OPENING: 'Opening stock',
  ADJUSTMENT: 'Adjustment',
  RECEIPT: 'Goods receipt',
  SHIPMENT: 'Shipment',
};

export const ADJUSTMENT_REASONS = [
  'count',
  'damage',
  'loss',
  'found',
  'correction',
  'other',
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReason, string> = {
  count: 'Stock count',
  damage: 'Damaged',
  loss: 'Lost or stolen',
  found: 'Found',
  correction: 'Correction',
  other: 'Other',
};

export const STOCK_DOCUMENT_TYPES = ['opening', 'adjustment'] as const;
export type StockDocumentType = (typeof STOCK_DOCUMENT_TYPES)[number];

/** Documents a stock movement can point back to. */
export const MOVEMENT_REFERENCE_TYPES = [
  ...STOCK_DOCUMENT_TYPES,
  'goodsReceipt',
  'shipment',
] as const;
export type MovementReferenceType = (typeof MOVEMENT_REFERENCE_TYPES)[number];

const uniqueProducts = (lines: { productId: string }[]) =>
  new Set(lines.map((line) => line.productId)).size === lines.length;

export const openingStockSchema = z.object({
  warehouseId: objectIdSchema,
  notes: optionalText(500).default(''),
  lines: z
    .array(
      z.object({
        productId: objectIdSchema,
        quantity: positiveQuantity,
        // Defaults to the product's cost price.
        unitCost: moneySchema.optional(),
      }),
    )
    .min(1, 'Add at least one product')
    .max(200)
    .refine(uniqueProducts, 'Each product can appear only once'),
});

export const adjustmentLineSchema = z
  .object({
    productId: objectIdSchema,
    quantityChange: z
      .number()
      .int('Use whole units')
      .min(-MAX_QUANTITY)
      .max(MAX_QUANTITY)
      .refine((v) => v !== 0, 'Change cannot be zero')
      .optional(),
    countedQuantity: nonNegativeQuantity.optional(),
  })
  .refine((line) => (line.quantityChange === undefined) !== (line.countedQuantity === undefined), {
    message: 'Provide either a quantity change or a counted quantity',
  });

export const stockAdjustmentSchema = z
  .object({
    warehouseId: objectIdSchema,
    reason: z.enum(ADJUSTMENT_REASONS, 'Select a reason'),
    notes: optionalText(500).default(''),
    lines: z
      .array(adjustmentLineSchema)
      .min(1, 'Add at least one product')
      .max(200)
      .refine(uniqueProducts, 'Each product can appear only once'),
  })
  .superRefine((data, ctx) => {
    const counting = data.reason === 'count';
    data.lines.forEach((line, index) => {
      if (counting && line.countedQuantity === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index, 'countedQuantity'],
          message: 'Enter the counted quantity',
        });
      }
      if (!counting && line.quantityChange === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index, 'quantityChange'],
          message: 'Enter the quantity change',
        });
      }
    });
    if (data.reason === 'other' && data.notes.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['notes'], message: 'Describe the reason' });
    }
  });

export const updateThresholdSchema = z.object({
  reorderPoint: nonNegativeQuantity.nullable(),
});

export const listStockLevelsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  warehouseId: objectIdSchema.optional(),
  categoryId: objectIdSchema.optional(),
  productId: objectIdSchema.optional(),
  status: z.enum(['low', 'out', 'available']).optional(),
  sort: sortParam(['sku', 'name', 'onHand', 'available'] as const, 'sku'),
});

export const listMovementsQuerySchema = paginationQuerySchema.extend({
  productId: objectIdSchema.optional(),
  warehouseId: objectIdSchema.optional(),
  type: z.enum(MOVEMENT_TYPES).optional(),
  direction: z.enum(['in', 'out']).optional(),
  from: dateParam,
  to: dateParam,
});

export const listAdjustmentsQuerySchema = paginationQuerySchema.extend({
  warehouseId: objectIdSchema.optional(),
  type: z.enum(STOCK_DOCUMENT_TYPES).optional(),
});

export type OpeningStockInput = z.input<typeof openingStockSchema>;
export type StockAdjustmentInput = z.input<typeof stockAdjustmentSchema>;
export type ListStockLevelsQuery = z.infer<typeof listStockLevelsQuerySchema>;
export type ListMovementsQuery = z.infer<typeof listMovementsQuerySchema>;
export type ListAdjustmentsQuery = z.infer<typeof listAdjustmentsQuerySchema>;
