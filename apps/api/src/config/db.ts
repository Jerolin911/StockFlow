import mongoose from 'mongoose';

mongoose.set('strictQuery', true);

export async function connectDatabase(uri: string, dbName?: string): Promise<void> {
  await mongoose.connect(uri, { ...(dbName ? { dbName } : {}), serverSelectionTimeoutMS: 10_000 });
  // Build indexes before serving requests so unique constraints are enforced from the first write.
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

export async function pingDatabase(): Promise<boolean> {
  const db = mongoose.connection.db;
  if (mongoose.connection.readyState !== 1 || !db) return false;
  try {
    await db.admin().ping();
    return true;
  } catch {
    return false;
  }
}
