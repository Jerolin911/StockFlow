import { randomBytes } from 'node:crypto';
import { Schema, model, type ClientSession, type Types } from 'mongoose';
import { env } from '../../config/env.js';
import type { Keyring } from '../../lib/keyring.js';
import { userSnapshotSchema } from '../common/schemas.js';
import { openBytes, sealBytes } from './field-crypto.js';

/**
 * One data key per customer (envelope encryption). The key is 32 random bytes, stored only
 * wrapped by a master key from DATA_ENCRYPTION_KEYS; `kekId` says which one. Erasing the
 * customer wipes the wrapped key (crypto-shredding): every copy of their personal data,
 * including the addresses on past orders and shipments, becomes unreadable while the
 * documents themselves, and the stock ledger, stay as they were.
 *
 * The document keeps the customer's `_id`, so there is at most one key per customer.
 */
const customerKeySchema = new Schema(
  {
    _id: { type: Schema.Types.ObjectId, required: true },
    kekId: { type: String, default: null },
    wrappedKey: { type: String, default: null },
    shreddedAt: { type: Date, default: null },
    shreddedBy: { type: userSnapshotSchema, default: null },
    shredReason: { type: String, default: '' },
  },
  { timestamps: true },
);

export const CustomerKey = model('CustomerKey', customerKeySchema);

const wrapLabel = (customerId: string) => `customer-key:${customerId}`;

function wrap(customerId: string, dataKey: Buffer, keyring: Keyring) {
  const kek = keyring.keys.get(keyring.activeId)!;
  return { kekId: keyring.activeId, wrappedKey: sealBytes(kek, wrapLabel(customerId), dataKey) };
}

function unwrap(customerId: string, kekId: string, wrappedKey: string, keyring: Keyring) {
  const kek = keyring.keys.get(kekId);
  if (!kek) {
    throw new Error(
      `Customer ${customerId}'s data key is wrapped by master key "${kekId}", which is not in DATA_ENCRYPTION_KEYS`,
    );
  }
  return openBytes(kek, wrapLabel(customerId), wrappedKey);
}

/** Creates and stores a new data key for a customer that's about to be inserted. */
export async function createCustomerKey(
  customerId: Types.ObjectId,
  session: ClientSession,
  keyring: Keyring = env.DATA_ENCRYPTION_KEYS,
): Promise<Buffer> {
  const dataKey = randomBytes(32);
  await CustomerKey.create(
    [{ _id: customerId, ...wrap(customerId.toString(), dataKey, keyring) }],
    {
      session,
    },
  );
  return dataKey;
}

/** Data keys for a set of customers. `null` means the key was shredded (customer erased). */
export type CustomerKeys = ReadonlyMap<string, Buffer | null>;

/**
 * Loads and unwraps the data keys for the given customers in one query. Keys are not cached,
 * so an erasure takes effect on the next request on every API instance.
 */
export async function loadCustomerKeys(
  customerIds: (Types.ObjectId | string)[],
  session?: ClientSession,
  keyring: Keyring = env.DATA_ENCRYPTION_KEYS,
): Promise<CustomerKeys> {
  const ids = [...new Set(customerIds.map(String))];
  if (ids.length === 0) return new Map();
  const docs = await CustomerKey.find({ _id: { $in: ids } })
    .session(session ?? null)
    .lean();
  const keys = new Map<string, Buffer | null>();
  for (const doc of docs) {
    const id = doc._id.toString();
    keys.set(
      id,
      doc.shreddedAt || !doc.wrappedKey || !doc.kekId
        ? null
        : unwrap(id, doc.kekId, doc.wrappedKey, keyring),
    );
  }
  const missing = ids.find((id) => !keys.has(id));
  if (missing) throw new Error(`Customer ${missing} has no data key`);
  return keys;
}

/**
 * Destroys a customer's data key, keeping a tombstone of who did it and why. Conditional on
 * the key not being shredded already, so two concurrent erasures can't both succeed.
 */
export async function shredCustomerKey(
  customerId: Types.ObjectId,
  by: { _id: Types.ObjectId; name: string },
  reason: string,
  session: ClientSession,
): Promise<Date | null> {
  const shreddedAt = new Date();
  const result = await CustomerKey.updateOne(
    { _id: customerId, shreddedAt: null },
    {
      $set: { kekId: null, wrappedKey: null, shreddedAt, shreddedBy: by, shredReason: reason },
    },
    { session },
  );
  return result.modifiedCount === 1 ? shreddedAt : null;
}

/**
 * Re-wraps every live data key under the active master key, after a new key was put first in
 * DATA_ENCRYPTION_KEYS. Only the 32-byte data keys are re-encrypted, never the data itself.
 * Each key is swapped with a conditional update on its old wrapping, so a concurrent erasure
 * or a second run is never overwritten. Once it reports nothing left, the old master key can
 * be removed from the list.
 */
export async function rewrapCustomerKeys(keyring: Keyring = env.DATA_ENCRYPTION_KEYS) {
  const stale = CustomerKey.find({ shreddedAt: null, kekId: { $ne: keyring.activeId } }).cursor();
  let rewrapped = 0;
  for await (const doc of stale) {
    const id = doc._id.toString();
    const dataKey = unwrap(id, doc.kekId!, doc.wrappedKey!, keyring);
    const result = await CustomerKey.updateOne(
      { _id: doc._id, shreddedAt: null, kekId: doc.kekId, wrappedKey: doc.wrappedKey },
      { $set: wrap(id, dataKey, keyring) },
    );
    rewrapped += result.modifiedCount;
  }
  const remaining = await CustomerKey.countDocuments({
    shreddedAt: null,
    kekId: { $ne: keyring.activeId },
  });
  return { rewrapped, remaining };
}
