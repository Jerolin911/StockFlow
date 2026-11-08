import { z } from 'zod';
import { objectIdSchema, paginationQuerySchema } from './common.js';
import { nonNegativeQuantity, optionalText, positiveQuantity, sortParam } from './fields.js';
import { STOCK_BUCKETS } from './stock.js';

const uniqueLines = (lines: { lineId: string }[]) =>
  new Set(lines.map((line) => line.lineId)).size === lines.length;

export const RETURN_REASONS = [
  'damaged',
  'defective',
  'wrong_item',
  'not_needed',
  'other',
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

export const RETURN_REASON_LABELS: Record<ReturnReason, string> = {
  damaged: 'Damaged',
  defective: 'Defective',
  wrong_item: 'Wrong item',
  not_needed: 'No longer needed',
  other: 'Other',
};

// Customer returns

export const CUSTOMER_RETURN_STATUSES = [
  'requested',
  'approved',
  'received',
  'completed',
  'rejected',
  'cancelled',
] as const;
export type CustomerReturnStatus = (typeof CUSTOMER_RETURN_STATUSES)[number];

export const CUSTOMER_RETURN_STATUS_LABELS: Record<CustomerReturnStatus, string> = {
  requested: 'Awaiting approval',
  approved: 'Approved',
  received: 'Awaiting inspection',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export const customerReturnSchema = z
  .object({
    salesOrderId: objectIdSchema,
    // Where the goods come back to; defaults to the order's warehouse.
    warehouseId: objectIdSchema.optional(),
    reason: z.enum(RETURN_REASONS, 'Select a reason'),
    notes: optionalText(1000).default(''),
    lines: z
      .array(z.object({ soLineId: objectIdSchema, quantity: nonNegativeQuantity }))
      .min(1, 'Add at least one line')
      .max(200)
      .refine(
        (lines) => new Set(lines.map((l) => l.soLineId)).size === lines.length,
        'Each order line can appear only once',
      )
      .refine(
        (lines) => lines.some((l) => l.quantity > 0),
        'Enter a quantity for at least one line',
      ),
  })
  .refine((r) => r.reason !== 'other' || r.notes !== '', {
    path: ['notes'],
    message: 'Describe the reason',
  });

export const receiveCustomerReturnSchema = z.object({
  note: optionalText(500).default(''),
  lines: z
    .array(z.object({ lineId: objectIdSchema, receivedQuantity: nonNegativeQuantity }))
    .min(1)
    .max(200)
    .refine(uniqueLines, 'Each line can appear only once')
    .refine((lines) => lines.some((l) => l.receivedQuantity > 0), 'Nothing was received'),
});

export const inspectCustomerReturnSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: objectIdSchema,
        restockQuantity: nonNegativeQuantity,
        quarantineQuantity: nonNegativeQuantity,
        note: optionalText(200).default(''),
      }),
    )
    .min(1)
    .max(200)
    .refine(uniqueLines, 'Each line can appear only once'),
});

export const listCustomerReturnsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(CUSTOMER_RETURN_STATUSES).optional(),
  salesOrderId: objectIdSchema.optional(),
  customerId: objectIdSchema.optional(),
  warehouseId: objectIdSchema.optional(),
  sort: sortParam(['createdAt', 'number'] as const, '-createdAt'),
});

export type CustomerReturnInput = z.input<typeof customerReturnSchema>;
export type ReceiveCustomerReturnInput = z.input<typeof receiveCustomerReturnSchema>;
export type InspectCustomerReturnInput = z.input<typeof inspectCustomerReturnSchema>;
export type ListCustomerReturnsQuery = z.infer<typeof listCustomerReturnsQuerySchema>;

// Supplier returns

export const SUPPLIER_RETURN_STATUSES = [
  'requested',
  'approved',
  'dispatched',
  'rejected',
  'cancelled',
] as const;
export type SupplierReturnStatus = (typeof SUPPLIER_RETURN_STATUSES)[number];

export const SUPPLIER_RETURN_STATUS_LABELS: Record<SupplierReturnStatus, string> = {
  requested: 'Awaiting approval',
  approved: 'Approved',
  dispatched: 'Returned',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export const supplierReturnSchema = z
  .object({
    supplierId: objectIdSchema,
    warehouseId: objectIdSchema,
    purchaseOrderId: objectIdSchema.nullable().default(null),
    reason: z.enum(RETURN_REASONS, 'Select a reason'),
    notes: optionalText(1000).default(''),
    lines: z
      .array(
        z.object({
          productId: objectIdSchema,
          quantity: positiveQuantity,
          // Quarantined goods (returns, damaged stock) or usable stock.
          source: z.enum(STOCK_BUCKETS).default('quarantine'),
        }),
      )
      .min(1, 'Add at least one product')
      .max(200)
      .refine(
        (lines) => new Set(lines.map((l) => `${l.productId}:${l.source}`)).size === lines.length,
        'Each product can appear once per source',
      ),
  })
  .refine((r) => r.reason !== 'other' || r.notes !== '', {
    path: ['notes'],
    message: 'Describe the reason',
  });

export const dispatchSupplierReturnSchema = z.object({
  carrier: optionalText(100).default(''),
  reference: optionalText(100).default(''),
});

export const listSupplierReturnsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(SUPPLIER_RETURN_STATUSES).optional(),
  supplierId: objectIdSchema.optional(),
  warehouseId: objectIdSchema.optional(),
  sort: sortParam(['createdAt', 'number'] as const, '-createdAt'),
});

export type SupplierReturnInput = z.input<typeof supplierReturnSchema>;
export type DispatchSupplierReturnInput = z.input<typeof dispatchSupplierReturnSchema>;
export type ListSupplierReturnsQuery = z.infer<typeof listSupplierReturnsQuerySchema>;
