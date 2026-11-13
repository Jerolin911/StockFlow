import type { Types } from 'mongoose';
import { env } from '../../config/env.js';
import type { CustomerKeys } from './customer-keys.js';
import { blindIndex, openValue, sealValue } from './field-crypto.js';

/**
 * Customer fields that hold personal data and are stored encrypted with the customer's data
 * key. The business name and code stay readable: they identify the customer on documents,
 * reports and notifications, and history must keep reading correctly after an erasure.
 */
export const CUSTOMER_PERSONAL_FIELDS = [
  'contactName',
  'email',
  'phone',
  'address',
  'shippingAddress',
  'notes',
] as const;

export type CustomerPersonalField = (typeof CUSTOMER_PERSONAL_FIELDS)[number];
export type CustomerPersonalData = Record<CustomerPersonalField, string>;

const fieldLabel = (customerId: string, field: string) => `${customerId}:${field}`;
/** Delivery addresses copied onto sales orders and shipments. */
const documentLabel = (customerId: string) => `${customerId}:document.shippingAddress`;

const idOf = (id: Types.ObjectId | string) => id.toString();

/**
 * Encrypts the personal fields present in `input` (others are left out, for PATCH). When the
 * email is given, the result also carries its blind index for exact-match search.
 */
export function sealCustomerData(
  customerId: Types.ObjectId | string,
  dataKey: Buffer,
  input: Partial<Record<CustomerPersonalField, unknown>>,
  indexKey: Buffer = env.BLIND_INDEX_KEY,
): Partial<CustomerPersonalData> & { emailIndex?: string | null } {
  const id = idOf(customerId);
  const sealed: Partial<CustomerPersonalData> & { emailIndex?: string | null } = {};
  for (const field of CUSTOMER_PERSONAL_FIELDS) {
    const value = input[field];
    if (typeof value === 'string') sealed[field] = sealValue(dataKey, fieldLabel(id, field), value);
  }
  if (typeof input.email === 'string') sealed.emailIndex = blindIndex(indexKey, input.email);
  return sealed;
}

/** Decrypts a stored customer's personal fields; all empty once the customer is erased. */
export function openCustomerData(
  customerId: Types.ObjectId | string,
  dataKey: Buffer | null,
  row: Partial<Record<CustomerPersonalField, string | null>>,
): CustomerPersonalData {
  const id = idOf(customerId);
  const open = {} as CustomerPersonalData;
  for (const field of CUSTOMER_PERSONAL_FIELDS) {
    open[field] = dataKey ? openValue(dataKey, fieldLabel(id, field), row[field] ?? '') : '';
  }
  return open;
}

export const sealDocumentAddress = (
  customerId: Types.ObjectId | string,
  dataKey: Buffer,
  address: string,
) => sealValue(dataKey, documentLabel(idOf(customerId)), address);

/**
 * The delivery address on a sales order or shipment. Once the customer is erased the address
 * can't be read any more and `customerErased` says why it's blank.
 */
export function openDocumentAddress(
  keys: CustomerKeys,
  customerId: Types.ObjectId | string,
  stored: string | null | undefined,
): { shippingAddress: string; customerErased: boolean } {
  const id = idOf(customerId);
  const dataKey = keys.get(id);
  if (dataKey === undefined) throw new Error(`Customer ${id}'s data key was not loaded`);
  if (dataKey === null) return { shippingAddress: '', customerErased: true };
  return {
    shippingAddress: openValue(dataKey, documentLabel(id), stored ?? ''),
    customerErased: false,
  };
}
