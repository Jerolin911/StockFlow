import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { DEMO_USERS, seedDatabase } from './seed-data.js';

if (env.isProduction) {
  console.error('Refusing to seed a production database.');
  process.exit(1);
}

await connectDatabase(env.MONGODB_URI);
await seedDatabase();
await disconnectDatabase();

console.log('Seeded demo users:');
for (const user of DEMO_USERS) console.log(`  ${user.role.padEnd(20)} ${user.email}`);
console.log('Password: see DEMO_PASSWORD in apps/api/scripts/seed-data.ts or SEED_PASSWORD.');
