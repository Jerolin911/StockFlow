import { Types, type ClientSession } from 'mongoose';
import type { HistoryEntryDto } from '@stockflow/shared';
import { AppError } from '../../lib/errors.js';
import type { AuthContext } from '../../types/express.js';
import { customers, suppliers } from '../partners/partners.js';
import { Product } from '../products/product.model.js';
import { Warehouse } from '../warehouses/warehouse.model.js';

export type Actor = AuthContext['user'];

export const snapshot = (actor: Actor) => ({ _id: new Types.ObjectId(actor.id), name: actor.name });

export const historyEntry = (actor: Actor, action: string, note = '') => ({
  action,
  at: new Date(),
  by: snapshot(actor),
  note,
});

interface StoredHistory {
  action: string;
  at: Date;
  by: { _id: Types.ObjectId; name?: string | null };
  note?: string | null;
}

export const historyDto = (entries: StoredHistory[]): HistoryEntryDto[] =>
  entries.map((h) => ({
    action: h.action,
    at: h.at.toISOString(),
    by: { id: h.by._id.toString(), name: h.by.name ?? '' },
    note: h.note ?? '',
  }));

export const userRef = (u: { _id: Types.ObjectId; name?: string | null } | null | undefined) =>
  u ? { id: u._id.toString(), name: u.name ?? '' } : null;

/** Dates without a time are stored at 00:00 UTC. */
export const dateFromIso = (value: string) => new Date(`${value}T00:00:00.000Z`);
export const isoDate = (value: Date | null | undefined) =>
  value ? value.toISOString().slice(0, 10) : null;
export const todayIso = () => new Date().toISOString().slice(0, 10);

export const validation = (path: string, message: string) =>
  new AppError(400, 'VALIDATION_ERROR', message, [{ path, message }]);

export async function requireActiveWarehouse(id: string, session?: ClientSession) {
  const warehouse = await Warehouse.findById(id)
    .session(session ?? null)
    .lean();
  if (!warehouse) throw validation('warehouseId', 'Warehouse not found');
  if (!warehouse.isActive) throw validation('warehouseId', 'This warehouse is deactivated');
  return warehouse;
}

export async function requireActiveSupplier(id: string, session?: ClientSession) {
  const supplier = await suppliers.Model.findById(id)
    .session(session ?? null)
    .lean<{
      _id: Types.ObjectId;
      code: string;
      name: string;
      isActive: boolean;
      leadTimeDays?: number | null;
    }>();
  if (!supplier) throw validation('supplierId', 'Supplier not found');
  if (!supplier.isActive) throw validation('supplierId', 'This supplier is inactive');
  return supplier;
}

export async function requireActiveCustomer(id: string, session?: ClientSession) {
  const customer = await customers.Model.findById(id)
    .session(session ?? null)
    .lean<{
      _id: Types.ObjectId;
      code: string;
      name: string;
      isActive: boolean;
      address?: string | null;
      shippingAddress?: string | null;
    }>();
  if (!customer) throw validation('customerId', 'Customer not found');
  if (!customer.isActive) throw validation('customerId', 'This customer is inactive');
  return customer;
}

/** Loads products for document lines; every product must exist and be active. */
export async function loadActiveProducts(productIds: string[], session?: ClientSession) {
  const products = await Product.find({ _id: { $in: productIds } })
    .session(session ?? null)
    .lean();
  const byId = new Map(products.map((p) => [p._id.toString(), p]));
  const issues: { path: string; message: string }[] = [];
  productIds.forEach((id, index) => {
    const product = byId.get(id);
    if (!product) issues.push({ path: `lines.${index}.productId`, message: 'Product not found' });
    else if (!product.isActive) {
      issues.push({ path: `lines.${index}.productId`, message: `${product.sku} is inactive` });
    }
  });
  if (issues.length > 0) throw new AppError(400, 'VALIDATION_ERROR', issues[0]!.message, issues);
  return (id: string) => byId.get(id)!;
}

export type WarehouseLookup = Map<string, { code: string; name: string }>;

export async function warehouseLookup(ids: Types.ObjectId[]): Promise<WarehouseLookup> {
  const warehouses = await Warehouse.find({ _id: { $in: ids } }, { code: 1, name: 1 }).lean();
  return new Map(warehouses.map((w) => [w._id.toString(), { code: w.code, name: w.name }]));
}

export const warehouseRef = (lookup: WarehouseLookup, id: Types.ObjectId) => ({
  id: id.toString(),
  ...(lookup.get(id.toString()) ?? { code: '', name: '' }),
});
