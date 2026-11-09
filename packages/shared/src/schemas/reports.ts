import { z } from 'zod';
import { objectIdSchema, paginationQuerySchema } from './common.js';

export const REPORT_INTERVALS = ['day', 'week', 'month'] as const;
export type ReportInterval = (typeof REPORT_INTERVALS)[number];

/** Longest range a report accepts, so a typo in a year can't scan the whole ledger by day. */
export const MAX_REPORT_DAYS = 731;

const isoDate = z.iso.date('Use YYYY-MM-DD');

const range = {
  from: isoDate.optional(),
  to: isoDate.optional(),
  warehouseId: objectIdSchema.optional(),
};

const validRange = (r: { from?: string | undefined; to?: string | undefined }) =>
  !r.from || !r.to || r.from <= r.to;

export const reportRangeSchema = z
  .object(range)
  .refine(validRange, { path: ['to'], message: 'The end date must be on or after the start' });

export const trendQuerySchema = z
  .object({
    ...range,
    interval: z.enum(REPORT_INTERVALS).optional(),
    categoryId: objectIdSchema.optional(),
    supplierId: objectIdSchema.optional(),
    customerId: objectIdSchema.optional(),
  })
  .refine(validRange, { path: ['to'], message: 'The end date must be on or after the start' });

const table = {
  ...range,
  search: z.string().trim().max(100).optional(),
  categoryId: objectIdSchema.optional(),
  supplierId: objectIdSchema.optional(),
  customerId: objectIdSchema.optional(),
  /** csv returns every matching row as a file instead of a page of JSON. */
  format: z.enum(['csv']).optional(),
};

export const MOVEMENT_CLASSES = ['fast', 'normal', 'slow', 'none'] as const;
export type MovementClass = (typeof MOVEMENT_CLASSES)[number];

export const MOVEMENT_CLASS_LABELS: Record<MovementClass, string> = {
  fast: 'Fast-moving',
  normal: 'Steady',
  slow: 'Slow-moving',
  none: 'No stock or sales',
};

/** Days of cover at the period's shipment rate that separate fast, steady and slow. */
export const FAST_MOVING_DAYS = 30;
export const SLOW_MOVING_DAYS = 90;

export const velocityQuerySchema = paginationQuerySchema
  .extend({ ...table, movement: z.enum(MOVEMENT_CLASSES).optional() })
  .refine(validRange, { path: ['to'], message: 'The end date must be on or after the start' });

export const availabilityReportQuerySchema = paginationQuerySchema.extend({
  ...table,
  status: z.enum(['low', 'out', 'available']).optional(),
});

export const reportTableQuerySchema = paginationQuerySchema
  .extend(table)
  .refine(validRange, { path: ['to'], message: 'The end date must be on or after the start' });

export const salesOrdersReportQuerySchema = paginationQuerySchema
  .extend({ ...table, state: z.enum(['pending', 'completed']).optional() })
  .refine(validRange, { path: ['to'], message: 'The end date must be on or after the start' });

export type ReportRangeQuery = z.infer<typeof reportRangeSchema>;
export type TrendQuery = z.infer<typeof trendQuerySchema>;
export type VelocityQuery = z.infer<typeof velocityQuerySchema>;
export type AvailabilityReportQuery = z.infer<typeof availabilityReportQuerySchema>;
export type ReportTableQuery = z.infer<typeof reportTableQuerySchema>;
export type SalesOrdersReportQuery = z.infer<typeof salesOrdersReportQuerySchema>;

// Notifications

export const NOTIFICATION_TYPES = [
  'low_stock',
  'purchase_request',
  'purchase_order',
  'goods_receipt',
  'sales_order',
  'shipment',
  'transfer',
  'stock_count',
  'return',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  low_stock: 'Low stock',
  purchase_request: 'Purchase requests',
  purchase_order: 'Purchase orders',
  goods_receipt: 'Goods receipts',
  sales_order: 'Sales orders',
  shipment: 'Shipments',
  transfer: 'Transfers',
  stock_count: 'Stock counts',
  return: 'Returns',
};

export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  type: z.enum(NOTIFICATION_TYPES).optional(),
  unread: z.enum(['true']).optional(),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

// Audit log

export const listAuditLogsQuerySchema = paginationQuerySchema.extend({
  actorId: objectIdSchema.optional(),
  entityType: z.string().trim().max(60).optional(),
  entityId: z.string().trim().max(60).optional(),
  outcome: z.enum(['failed']).optional(),
  search: z.string().trim().max(100).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
