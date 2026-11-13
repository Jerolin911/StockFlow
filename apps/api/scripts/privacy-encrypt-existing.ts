import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { encryptExistingCustomerData } from '../src/modules/privacy/encrypt-existing.js';

// Encrypts customer data written before field encryption existed. Safe to rerun.
await connectDatabase(env.MONGODB_URI);
const counts = await encryptExistingCustomerData();
await disconnectDatabase();

console.log(`Created ${counts.keysCreated} customer data keys.`);
console.log(
  `Encrypted ${counts.customers} customers, ${counts.salesOrders} sales order and ` +
    `${counts.shipments} shipment addresses.`,
);
