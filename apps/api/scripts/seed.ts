import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { DEMO_PASSWORD, DEMO_USERS, seedDatabase } from './seed-data.js';

// Seeding wipes the database. In production it needs an explicit confirmation, which the
// `seed` service in docker-compose.yml provides for the demo stack.
if (env.isProduction && process.env.SEED_CONFIRM !== 'reset') {
  console.error(
    'Refusing to seed: this would erase the database. Set SEED_CONFIRM=reset to proceed.',
  );
  process.exit(1);
}

await connectDatabase(env.MONGODB_URI);
await seedDatabase();
await disconnectDatabase();

console.log('Reset the database and loaded the demo data: 3 warehouses, products, stock,');
console.log('suppliers, customers, purchase and sales orders, transfers, counts and returns.');
console.log('\nSign in with any of these accounts:');
for (const user of DEMO_USERS) console.log(`  ${user.role.padEnd(20)} ${user.email}`);
console.log(`Password (all accounts): ${DEMO_PASSWORD}`);
