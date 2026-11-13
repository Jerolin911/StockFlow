import { z } from 'zod';
import { CURRENCIES } from '../money.js';
import { objectIdSchema, paginationQuerySchema } from './common.js';
import {
  basisPointsSchema,
  codeSchema,
  moneySchema,
  nonNegativeQuantity,
  optionalEmail,
  optionalText,
  requiredText,
  sortParam,
  statusFilter,
} from './fields.js';

/*
 * Update schemas are built from field definitions without defaults. Zod applies a
 * field's default even inside .partial(), which would overwrite stored values on PATCH.
 */

// Settings

export const updateSettingsSchema = z
  .object({
    companyName: requiredText('a company name', 120),
    currency: z.enum(CURRENCIES, 'Select a currency'),
  })
  .partial();

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

// Warehouses

const warehouseFields = {
  code: codeSchema(2, 10),
  name: requiredText('a name', 100),
  address: optionalText(500),
};

export const createWarehouseSchema = z.object({
  ...warehouseFields,
  address: warehouseFields.address.default(''),
});

export const updateWarehouseSchema = z
  .object({ ...warehouseFields, isActive: z.boolean() })
  .partial();

export const listWarehousesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: statusFilter,
});

export type CreateWarehouseInput = z.input<typeof createWarehouseSchema>;
export type UpdateWarehouseInput = z.input<typeof updateWarehouseSchema>;
export type ListWarehousesQuery = z.infer<typeof listWarehousesQuerySchema>;

// Categories

const categoryFields = {
  name: requiredText('a name', 80),
  code: codeSchema(2, 6),
  description: optionalText(300),
};

export const createCategorySchema = z.object({
  ...categoryFields,
  description: categoryFields.description.default(''),
});

export const updateCategorySchema = z.object(categoryFields).partial();

export const listCategoriesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateCategoryInput = z.input<typeof createCategorySchema>;
export type UpdateCategoryInput = z.input<typeof updateCategorySchema>;
export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>;

// Products

export const UNITS = [
  'pcs',
  'box',
  'pack',
  'pair',
  'set',
  'roll',
  'bottle',
  'bag',
  'm',
  'g',
  'ml',
] as const;
export type Unit = (typeof UNITS)[number];

export const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9._-]{1,39}$/, 'Use 2–40 letters, numbers, dots, dashes or underscores');

const productFields = {
  name: requiredText('a product name', 150),
  categoryId: objectIdSchema,
  unit: z.enum(UNITS, 'Select a unit'),
  barcode: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z0-9-]*$/, 'Use letters, numbers or dashes'),
  description: optionalText(1000),
  costPrice: moneySchema,
  sellingPrice: moneySchema,
  taxRate: basisPointsSchema,
  reorderPoint: nonNegativeQuantity,
  reorderQuantity: nonNegativeQuantity,
};

export const createProductSchema = z.object({
  ...productFields,
  barcode: productFields.barcode.default(''),
  description: productFields.description.default(''),
  taxRate: productFields.taxRate.default(0),
  reorderPoint: productFields.reorderPoint.default(0),
  reorderQuantity: productFields.reorderQuantity.default(0),
  // Blank means "generate from the category code".
  sku: z.union([z.literal(''), skuSchema]).default(''),
});

// SKUs are fixed once created because stock records and documents refer to them.
export const updateProductSchema = z.object({ ...productFields, isActive: z.boolean() }).partial();

export const PRODUCT_SORT_FIELDS = ['name', 'sku', 'createdAt', 'sellingPrice'] as const;

export const listProductsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  categoryId: objectIdSchema.optional(),
  warehouseId: objectIdSchema.optional(),
  status: statusFilter,
  stock: z.enum(['low', 'out', 'in']).optional(),
  sort: sortParam(PRODUCT_SORT_FIELDS, 'name'),
});

export type CreateProductInput = z.input<typeof createProductSchema>;
export type UpdateProductInput = z.input<typeof updateProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

// Suppliers and customers

const partnerFields = {
  name: requiredText('a name', 150),
  contactName: optionalText(100),
  email: optionalEmail,
  phone: optionalText(40),
  address: optionalText(500),
  notes: optionalText(1000),
};

const partnerCreateFields = {
  // Blank means "generate the next SUP-/CUS- code".
  code: z.union([z.literal(''), codeSchema(2, 20)]).default(''),
  name: partnerFields.name,
  contactName: partnerFields.contactName.default(''),
  email: partnerFields.email.default(''),
  phone: partnerFields.phone.default(''),
  address: partnerFields.address.default(''),
  notes: partnerFields.notes.default(''),
};

const leadTimeDays = z.number().int().min(0).max(365).nullable();

export const createSupplierSchema = z.object({
  ...partnerCreateFields,
  leadTimeDays: leadTimeDays.default(null),
});

export const createCustomerSchema = z.object({
  ...partnerCreateFields,
  shippingAddress: optionalText(500).default(''),
});

// Codes are fixed once created.
export const updateSupplierSchema = z
  .object({ ...partnerFields, leadTimeDays, isActive: z.boolean() })
  .partial();

export const updateCustomerSchema = z
  .object({ ...partnerFields, shippingAddress: optionalText(500), isActive: z.boolean() })
  .partial();

/** Erasing is irreversible, so the customer's code must be typed back to confirm. */
export const eraseCustomerSchema = z.object({
  reason: requiredText('the reason for erasing', 500),
  confirmCode: z
    .string('Type the customer code to confirm')
    .trim()
    .min(1, 'Type the customer code to confirm')
    .max(20),
});

export const listPartnersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: statusFilter,
  sort: sortParam(['name', 'code', 'createdAt'] as const, 'name'),
});

export type CreateSupplierInput = z.input<typeof createSupplierSchema>;
export type CreateCustomerInput = z.input<typeof createCustomerSchema>;
export type UpdateSupplierInput = z.input<typeof updateSupplierSchema>;
export type UpdateCustomerInput = z.input<typeof updateCustomerSchema>;
export type ListPartnersQuery = z.infer<typeof listPartnersQuerySchema>;
export type EraseCustomerInput = z.input<typeof eraseCustomerSchema>;
