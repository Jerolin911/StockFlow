/** Starts the API on an ephemeral in-memory replica set with demo users, for Playwright. */
import { randomBytes } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: process.env.E2E_API_PORT ?? '4100',
  MONGODB_URI: replSet.getUri('stockflow_e2e'),
  JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
  BCRYPT_ROUNDS: '4',
  LOGIN_RATE_LIMIT: '1000',
  LOG_LEVEL: 'error',
});

const { connectDatabase } = await import('../src/config/db.js');
const { env } = await import('../src/config/env.js');
const { createApp } = await import('../src/app.js');
const { seedDatabase } = await import('./seed-data.js');

await connectDatabase(env.MONGODB_URI);
await seedDatabase();

const server = createApp().listen(env.PORT, () => {
  console.log(`E2E API listening on port ${env.PORT}`);
});

const stop = () => {
  server.close();
  void replSet.stop().finally(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
