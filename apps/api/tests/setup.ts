import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, inject } from 'vitest';

process.env.MONGODB_URI = inject('mongoUri');

beforeAll(async () => {
  const { connectDatabase } = await import('../src/config/db.js');
  await connectDatabase(inject('mongoUri'), `test_${randomUUID().slice(0, 8)}`);
});

beforeEach(async () => {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
