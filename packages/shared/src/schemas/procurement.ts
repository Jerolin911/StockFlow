import { z } from 'zod';
import { objectIdSchema, paginationQuerySchema } from './common.js';
import {
  MAX_QUANTITY,
  dateParam,
  moneySchema,
  nonNegativeQuantity,
  optionalText,
  positiveQuantity,
  requiredText,
  sortParam,
} from './fields.js';

// Statuses

export const PURCHASE_REQUEST_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'ordered',
  'cancelled',
] as const;
export type PurchaseRequestStatus = (typeof PURCHASE_REQUEST_STATUSES)[number];

export const PURCHASE_REQUEST_STATUS_LABELS: Record<PurchaseRequestStatus, string> = {
  draft: 'Draft',
  submitted: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
  ordered: 'Ordered',
  cancelled: 'Cancelled',
};

export const PURCHASE_ORDER_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'partially_received',
  'received',
  'closed',
  'cancelled',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Awaiting approval',
  approved: 'Approved',
  partially_received: 'Partially received',
  received: 'Received',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

/** Statuses in which goods can still be received. */
export const RECEIVABLE_PO_STATUSES = ['approved', 'partially_received'] as const;

// Totals

export interface LineAmounts {
  lineSubtotal: number;
  lineTax: number;
  lineTotal: number;
}

/** Per-line totals in minor units. Tax is rounded half-up per line. */
export function lineAmounts(quantity: number, unitPrice: number, taxRateBp: number): LineAmounts {
  const lineSubtotal = quantity * unitPrice;
  const lineTax = Math.round((lineSubtotal * taxRateBp) / 10_000);
  return { lineSubtotal, lineTax, lineTotal: lineSubtotal + lineTax };
}

export function documentTotals(lines: LineAmounts[]) {
  return lines.reduce(
    (acc, l) => ({
      subtotal: acc.subtotal + l.lineSubtotal,
      taxTotal: acc.taxTotal + l.lineTax,
      total: acc.total + l.lineTotal,
    }),
    { subtotal: 0, taxTotal: 0, total: 0 },
  );
}

const uniqueProducts = (lines: { productId: string }[]) =>
  new Set(lines.map((line) => line.productId)).size === lines.length;

const reasonSchema = requiredText('a reason', 500);

export const reasonBodySchema = z.object({ reason: reasonSchema });

// Supplier price list

export const supplierPriceSchema = z.object({
  unitCost: moneySchema,
  supplierSku: optionalText(60).default(''),
});

export type SupplierPriceInput = z.input<typeof supplierPriceSchema>;

// Purchase requests

export const purchaseRequestSchema = z.object({
  warehouseId: objectIdSchema,
  neededBy: z.iso.date('Use YYYY-MM-DD').nullable().default(null),
  supplierId: objectIdSchema.nullable().default(null),
  notes: optionalText(1000).default(''),
  lines: z
    .array(
      z.object({
        productId: objectIdSchema,
        quantity: positiveQuantity,
        note: optionalText(200).default(''),
      }),
    )
    .min(1, 'Add at least one product')
    .max(200)
    .refine(uniqueProducts, 'Each product can appear only once'),
});

export const convertPurchaseRequestSchema = z.object({
  supplierId: objectIdSchema,
});

export const listPurchaseRequestsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(PURCHASE_REQUEST_STATUSES).optional(),
  warehouseId: objectIdSchema.optional(),
  mine: z.enum(['true']).optional(),
});

export type PurchaseRequestInput = z.input<typeof purchaseRequestSchema>;
export type ListPurchaseRequestsQuery = z.infer<typeof listPurchaseRequestsQuerySchema>;

// Purchase orders

export const purchaseOrderSchema = z.object({
  supplierId: objectIdSchema,
  warehouseId: objectIdSchema,
  expectedDate: z.iso.date('Use YYYY-MM-DD').nullable().default(null),
  notes: optionalText(1000).default(''),
  lines: z
    .array(
      z.object({
        productId: objectIdSchema,
        quantity: positiveQuantity,
        // Defaults to the supplier's price, else the product's cost price.
        unitCost: moneySchema.optional(),
      }),
    )
    .min(1, 'Add at least one product')
    .max(200)
    .refine(uniqueProducts, 'Each product can appear only once'),
});

export const PO_SORT_FIELDS = ['orderDate', 'expectedDate', 'number', 'total'] as const;

export const listPurchaseOrdersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
  /** Approved or partially received: still expecting goods. */
  open: z.enum(['true']).optional(),
  /** Open orders whose expected date has passed. */
  overdue: z.enum(['true']).optional(),
  supplierId: objectIdSchema.optional(),
  warehouseId: objectIdSchema.optional(),
  productId: objectIdSchema.optional(),
  sort: sortParam(PO_SORT_FIELDS, '-orderDate'),
});

export type PurchaseOrderInput = z.input<typeof purchaseOrderSchema>;
export type ListPurchaseOrdersQuery = z.infer<typeof listPurchaseOrdersQuerySchema>;

// Goods receipts

export const goodsReceiptSchema = z.object({
  purchaseOrderId: objectIdSchema,
  receivedAt: z.iso.date('Use YYYY-MM-DD').optional(),
  deliveryNote: optionalText(60).default(''),
  notes: optionalText(1000).default(''),
  lines: z
    .array(
      z
        .object({
          poLineId: objectIdSchema,
          acceptedQuantity: nonNegativeQuantity.default(0),
          rejectedQuantity: nonNegativeQuantity.default(0),
          damagedQuantity: nonNegativeQuantity.default(0),
          rejectionReason: optionalText(200).default(''),
        })
        .refine(
          (l) => l.acceptedQuantity + l.rejectedQuantity + l.damagedQuantity <= MAX_QUANTITY,
          'Quantity is too large',
        )
        .refine((l) => l.rejectedQuantity + l.damagedQuantity === 0 || l.rejectionReason !== '', {
          path: ['rejectionReason'],
          message: 'Say why goods were rejected or damaged',
        }),
    )
    .min(1, 'Add at least one line')
    .max(200)
    .refine(
      (lines) => new Set(lines.map((l) => l.poLineId)).size === lines.length,
      'Each order line can appear only once',
    )
    .refine(
      (lines) => lines.some((l) => l.acceptedQuantity + l.rejectedQuantity + l.damagedQuantity > 0),
      'Enter the quantity delivered for at least one line',
    ),
});

export const listGoodsReceiptsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  purchaseOrderId: objectIdSchema.optional(),
  supplierId: objectIdSchema.optional(),
  warehouseId: objectIdSchema.optional(),
  issues: z.enum(['true']).optional(),
  from: dateParam,
  to: dateParam,
});

export type GoodsReceiptInput = z.input<typeof goodsReceiptSchema>;
export type ListGoodsReceiptsQuery = z.infer<typeof listGoodsReceiptsQuerySchema>;
