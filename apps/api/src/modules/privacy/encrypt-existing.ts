import type { Types } from 'mongoose';
import { env } from '../../config/env.js';
import type { Keyring } from '../../lib/keyring.js';
import { inTransaction } from '../../lib/transaction.js';
import { customers, type CustomerRecord } from '../partners/partners.js';
import { SalesOrder, Shipment } from '../sales/models.js';
import {
  CUSTOMER_PERSONAL_FIELDS,
  sealCustomerData,
  sealDocumentAddress,
} from './customer-data.js';
import { CustomerKey, createCustomerKey, loadCustomerKeys } from './customer-keys.js';
import { isSealed } from './field-crypto.js';

const needsSealing = (value: unknown): value is string =>
  typeof value === 'string' && value !== '' && !isSealed(value);

/**
 * Encrypts customer data stored before encryption existed: gives every customer a data key,
 * seals their plaintext personal fields (adding the email's blind index) and seals the
 * delivery addresses on their sales orders and shipments. Values already sealed are left
 * alone, so the migration can be rerun, or resumed after an interruption, safely. Each record
 * is rewritten in its own transaction, conditional on the plaintext it read, so it can run
 * while the API is serving requests.
 */
export async function encryptExistingCustomerData(keyring: Keyring = env.DATA_ENCRYPTION_KEYS) {
  const Customer = customers.Model;
  const counts = { keysCreated: 0, customers: 0, salesOrders: 0, shipments: 0 };

  for await (const { _id } of Customer.find({}, { _id: 1 }).lean().cursor()) {
    await inTransaction(async (session) => {
      const row = await Customer.findById(_id).session(session).lean<CustomerRecord>();
      if (!row || row.erasedAt) return;
      const keyDoc = await CustomerKey.findById(_id).session(session).lean();
      if (keyDoc?.shreddedAt) return;
      let dataKey: Buffer;
      if (keyDoc) {
        dataKey = (await loadCustomerKeys([_id], session, keyring)).get(_id.toString())!;
      } else {
        dataKey = await createCustomerKey(_id, session, keyring);
        counts.keysCreated++;
      }
      const plain = Object.fromEntries(
        CUSTOMER_PERSONAL_FIELDS.filter((f) => needsSealing(row[f])).map((f) => [f, row[f]]),
      );
      if (Object.keys(plain).length === 0) return;
      await Customer.updateOne(
        { _id, ...plain },
        { $set: sealCustomerData(_id, dataKey, plain) },
        { session },
      );
      counts.customers++;
    });
  }

  for (const [Model, counter] of [
    [SalesOrder, 'salesOrders'],
    [Shipment, 'shipments'],
  ] as const) {
    const plaintext = { shippingAddress: { $nin: ['', null], $not: /^enc:v1:/ } };
    for await (const doc of (Model as typeof SalesOrder)
      .find(plaintext, { 'customer._id': 1, shippingAddress: 1 })
      .lean<{ _id: Types.ObjectId; customer: { _id: Types.ObjectId }; shippingAddress: string }>()
      .cursor()) {
      const dataKey = (await loadCustomerKeys([doc.customer._id], undefined, keyring)).get(
        doc.customer._id.toString(),
      );
      // An erased customer's address can't be sealed any more; it must not stay readable.
      const sealed = dataKey
        ? sealDocumentAddress(doc.customer._id, dataKey, doc.shippingAddress)
        : '';
      const result = await (Model as typeof SalesOrder).updateOne(
        { _id: doc._id, shippingAddress: doc.shippingAddress },
        { $set: { shippingAddress: sealed } },
      );
      counts[counter] += result.modifiedCount;
    }
  }

  return counts;
}
