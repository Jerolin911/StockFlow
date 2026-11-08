import { z } from 'zod';
import { objectIdSchema, paginationQuerySchema } from './common.js';
import {
  basisPointsSchema,
  dateParam,
  moneySchema,
  nonNegativeQuantity,
  optionalText,
  positiveQuantity,
  requiredText,
  sortParam,
} from './fields.js';

// Sales order statuses

export const SALES_ORDER_STATUSES = [
  'draft',
  'confirmed',
  'partially_shipped',
  'shipped',
  'delivered',
  'cancelled',
] as const;
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];

export const SALES_ORDER_STATUS_LABELS: Record<SalesOrderStatus, string> = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  partially_shipped: 'Partially shipped',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/** Statuses in which an order still holds reservations or can still ship. */
export const OPEN_SALES_ORDER_STATUSES = ['confirmed', 'partially_shipped'] as const;

// Shipment statuses

export const SHIPMENT_STATUSES = [
  'picking',
  'picked',
  'packed',
  'dispatched',
  'in_transit',
  'delivered',
  'cancelled',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  picking: 'Picking',
  picked: 'Picked',
  packed: 'Packed',
  dispatched: 'Dispatched',
  in_transit: 'In transit',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/** Shipments still in the warehouse: their stock is allocated but hasn't left. */
export const PRE_DISPATCH_SHIPMENT_STATUSES = ['picking', 'picked', 'packed'] as const;

/** Updates a carrier or driver reports after dispatch. */
export const TRACKING_EVENT_TYPES = [
  'in_transit',
  'out_for_delivery',
  'delivery_attempted',
  'delivered',
] as const;
export type TrackingEventType = (typeof TRACKING_EVENT_TYPES)[number];

export const TRACKING_EVENT_LABELS: Record<TrackingEventType | 'dispatched', string> = {
  dispatched: 'Dispatched',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivery_attempted: 'Delivery attempted',
  delivered: 'Delivered',
};

// Pricing

export interface SalesLineAmounts {
  lineGross: number;
  lineDiscount: number;
  /** After discount, before tax. */
  lineSubtotal: number;
  lineTax: number;
  lineTotal: number;
}

/** Per-line amounts in minor units. Discount and tax are each rounded half-up per line. */
export function salesLineAmounts(
  quantity: number,
  unitPrice: number,
  discountRateBp: number,
  taxRateBp: number,
): SalesLineAmounts {
  const lineGross = quantity * unitPrice;
  const lineDiscount = Math.round((lineGross * discountRateBp) / 10_000);
  const lineSubtotal = lineGross - lineDiscount;
  const lineTax = Math.round((lineSubtotal * taxRateBp) / 10_000);
  return { lineGross, lineDiscount, lineSubtotal, lineTax, lineTotal: lineSubtotal + lineTax };
}

export function salesDocumentTotals(lines: SalesLineAmounts[]) {
  return lines.reduce(
    (acc, l) => ({
      grossTotal: acc.grossTotal + l.lineGross,
      discountTotal: acc.discountTotal + l.lineDiscount,
      subtotal: acc.subtotal + l.lineSubtotal,
      taxTotal: acc.taxTotal + l.lineTax,
      total: acc.total + l.lineTotal,
    }),
    { grossTotal: 0, discountTotal: 0, subtotal: 0, taxTotal: 0, total: 0 },
  );
}

// Sales orders

const uniqueProducts = (lines: { productId: string }[]) =>
  new Set(lines.map((line) => line.productId)).size === lines.length;

export const salesOrderSchema = z.object({
  customerId: objectIdSchema,
  warehouseId: objectIdSchema,
  requiredDate: z.iso.date('Use YYYY-MM-DD').nullable().default(null),
  // Defaults to the customer's shipping address.
  shippingAddress: optionalText(500).optional(),
  customerReference: optionalText(60).default(''),
  notes: optionalText(1000).default(''),
  lines: z
    .array(
      z.object({
        productId: objectIdSchema,
        quantity: positiveQuantity,
        // Defaults to the product's selling price.
        unitPrice: moneySchema.optional(),
        discountRate: basisPointsSchema.default(0),
      }),
    )
    .min(1, 'Add at least one product')
    .max(200)
    .refine(uniqueProducts, 'Each product can appear only once'),
});

export const SO_SORT_FIELDS = ['orderDate', 'requiredDate', 'number', 'total'] as const;

export const listSalesOrdersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(SALES_ORDER_STATUSES).optional(),
  /** Confirmed or partially shipped: holding reservations. */
  open: z.enum(['true']).optional(),
  /** Open orders with quantities not yet on a shipment. */
  toFulfil: z.enum(['true']).optional(),
  /** Orders with shipped units not already on a customer return. */
  returnable: z.enum(['true']).optional(),
  customerId: objectIdSchema.optional(),
  warehouseId: objectIdSchema.optional(),
  productId: objectIdSchema.optional(),
  sort: sortParam(SO_SORT_FIELDS, '-orderDate'),
});

export type SalesOrderInput = z.input<typeof salesOrderSchema>;
export type ListSalesOrdersQuery = z.infer<typeof listSalesOrdersQuerySchema>;

export const availabilityQuerySchema = z.object({
  productIds: z
    .string()
    .trim()
    .transform((v) => v.split(',').filter(Boolean))
    .pipe(z.array(objectIdSchema).min(1, 'Pass at least one product').max(200)),
});

// Shipments

export const createShipmentSchema = z.object({
  salesOrderId: objectIdSchema,
  notes: optionalText(1000).default(''),
  lines: z
    .array(z.object({ soLineId: objectIdSchema, quantity: nonNegativeQuantity }))
    .min(1, 'Add at least one line')
    .max(200)
    .refine(
      (lines) => new Set(lines.map((l) => l.soLineId)).size === lines.length,
      'Each order line can appear only once',
    )
    .refine((lines) => lines.some((l) => l.quantity > 0), 'Enter a quantity for at least one line'),
});

export const confirmPickSchema = z.object({
  lines: z
    .array(z.object({ lineId: objectIdSchema, pickedQuantity: nonNegativeQuantity }))
    .min(1)
    .max(200),
  shortPickReason: optionalText(500).default(''),
});

export const packShipmentSchema = z.object({
  packageCount: z.number('Enter the number of packages').int().min(1, 'At least 1').max(10_000),
  weightGrams: z
    .number('Enter a weight')
    .int('Use whole grams')
    .min(1, 'Must be more than zero')
    .max(1_000_000_000)
    .nullable()
    .default(null),
  notes: optionalText(500).default(''),
});

export const dispatchShipmentSchema = z.object({
  carrier: requiredText('the carrier', 100),
  trackingNumber: optionalText(100).default(''),
});

export const trackingEventSchema = z
  .object({
    type: z.enum(TRACKING_EVENT_TYPES, 'Select a status'),
    // Defaults to now. ISO date-time with offset.
    at: z.iso.datetime({ offset: true, message: 'Enter a valid date and time' }).optional(),
    location: optionalText(200).default(''),
    note: optionalText(500).default(''),
    receivedBy: optionalText(100).default(''),
  })
  .refine((e) => e.type !== 'delivery_attempted' || e.note !== '', {
    path: ['note'],
    message: 'Say why the delivery failed',
  });

export const SHIPMENT_SORT_FIELDS = ['createdAt', 'dispatchedAt', 'number'] as const;

export const listShipmentsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(SHIPMENT_STATUSES).optional(),
  /** Picking, picked or packed: still in the warehouse. */
  pending: z.enum(['true']).optional(),
  /** Dispatched or in transit. */
  inTransit: z.enum(['true']).optional(),
  salesOrderId: objectIdSchema.optional(),
  customerId: objectIdSchema.optional(),
  warehouseId: objectIdSchema.optional(),
  from: dateParam,
  to: dateParam,
  sort: sortParam(SHIPMENT_SORT_FIELDS, '-createdAt'),
});

export type CreateShipmentInput = z.input<typeof createShipmentSchema>;
export type ConfirmPickInput = z.input<typeof confirmPickSchema>;
export type PackShipmentInput = z.input<typeof packShipmentSchema>;
export type DispatchShipmentInput = z.input<typeof dispatchShipmentSchema>;
export type TrackingEventInput = z.input<typeof trackingEventSchema>;
export type ListShipmentsQuery = z.infer<typeof listShipmentsQuerySchema>;
