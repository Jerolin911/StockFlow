import { Types, type Model } from 'mongoose';
import { OPEN_SALES_ORDER_STATUSES, type eraseCustomerSchema } from '@stockflow/shared';
import type { z } from 'zod';
import { AppError, invalidState, notFound } from '../../lib/errors.js';
import { inTransaction } from '../../lib/transaction.js';
import { CustomerReturn } from '../returns/models.js';
import { SalesOrder, Shipment } from '../sales/models.js';
import { CUSTOMER_PERSONAL_FIELDS } from './customer-data.js';
import { shredCustomerKey } from './customer-keys.js';

type EraseInput = z.output<typeof eraseCustomerSchema>;

/** Shipments still on their way: the address is needed until they're delivered. */
const UNDELIVERED_SHIPMENT_STATUSES = ['picking', 'picked', 'packed', 'dispatched', 'in_transit'];
const OPEN_CUSTOMER_RETURN_STATUSES = ['requested', 'approved', 'received'];

/**
 * Erases a customer's personal data at their request (crypto-shredding). Destroys the
 * customer's data key, which makes every encrypted copy unreadable at once: the customer
 * record and the delivery addresses on past orders and shipments, including copies in
 * backups. The record is also blanked and deactivated. Orders, shipments, returns and the
 * stock ledger stay intact; they keep the business name and code, which aren't personal data.
 *
 * Refused while the customer has work in progress that still needs the address.
 */
export async function eraseCustomer<
  TRecord extends { _id: Types.ObjectId; code: string; erasedAt?: Date | null },
>(
  CustomerModel: Model<TRecord>,
  id: string,
  input: EraseInput,
  by: { _id: Types.ObjectId; name: string },
): Promise<void> {
  await inTransaction(async (session) => {
    const customer = await CustomerModel.findById(id).session(session).lean();
    if (!customer) throw notFound('Customer');
    if (customer.erasedAt) throw invalidState("This customer's personal data is already erased");
    if (input.confirmCode.toUpperCase() !== customer.code.toUpperCase()) {
      throw new AppError(400, 'VALIDATION_ERROR', 'The code does not match this customer', [
        { path: 'confirmCode', message: `Type ${customer.code} to confirm` },
      ]);
    }

    const customerId = new Types.ObjectId(id);
    const [orders, shipments, returns] = await Promise.all([
      SalesOrder.countDocuments({
        'customer._id': customerId,
        status: { $in: OPEN_SALES_ORDER_STATUSES },
      }).session(session),
      Shipment.countDocuments({
        'customer._id': customerId,
        status: { $in: UNDELIVERED_SHIPMENT_STATUSES },
      }).session(session),
      CustomerReturn.countDocuments({
        'customer._id': customerId,
        status: { $in: OPEN_CUSTOMER_RETURN_STATUSES },
      }).session(session),
    ]);
    const open = [
      orders && `${orders} open sales order${orders === 1 ? '' : 's'}`,
      shipments && `${shipments} undelivered shipment${shipments === 1 ? '' : 's'}`,
      returns && `${returns} open return${returns === 1 ? '' : 's'}`,
    ].filter(Boolean);
    if (open.length > 0) {
      throw invalidState(
        `This customer has ${open.join(', ')}. Finish or cancel them before erasing.`,
      );
    }

    // Drafts can't be confirmed for an erased customer, and their address would be unreadable.
    // Blanking it also makes a confirmation racing this erasure conflict on the order, so one
    // of the two retries and sees the other: no open order is left for an erased customer.
    await SalesOrder.updateMany(
      { 'customer._id': customerId, status: 'draft' },
      { $set: { shippingAddress: '' } },
      { session },
    );

    const erasedAt = await shredCustomerKey(customerId, by, input.reason, session);
    if (!erasedAt) throw invalidState("This customer's personal data is already erased");
    const blank = Object.fromEntries(CUSTOMER_PERSONAL_FIELDS.map((f) => [f, '']));
    await CustomerModel.updateOne(
      { _id: customerId },
      {
        $set: {
          ...blank,
          emailIndex: null,
          isActive: false,
          erasedAt,
          erasedBy: by,
          erasureReason: input.reason,
        },
      },
      { session },
    );
  });
}
