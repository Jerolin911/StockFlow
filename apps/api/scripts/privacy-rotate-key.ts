import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { rewrapCustomerKeys } from '../src/modules/privacy/customer-keys.js';

// Re-wraps customer data keys under the first (active) key in DATA_ENCRYPTION_KEYS. Put the
// new master key first, keep the old one after it, run this, then remove the old one once
// nothing remains under it.
await connectDatabase(env.MONGODB_URI);
const { rewrapped, remaining } = await rewrapCustomerKeys();
await disconnectDatabase();

const active = env.DATA_ENCRYPTION_KEYS.activeId;
console.log(`Re-wrapped ${rewrapped} customer data keys under master key "${active}".`);
if (remaining > 0) {
  console.error(`${remaining} keys are still under another master key. Run this again.`);
  process.exit(1);
}
console.log('No keys remain under older master keys; they can be removed from the list.');
