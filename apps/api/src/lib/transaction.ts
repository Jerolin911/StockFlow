import mongoose, { type ClientSession } from 'mongoose';
import { isDuplicateKeyError } from './errors.js';

const RETRYABLE_KEYS = [['_id'], ['productId', 'warehouseId']];

/**
 * Two transactions upserting the same counter or stock level at the same moment can both
 * try to insert it; the loser fails on the unique index. Re-running sees the inserted row.
 */
function isRetryableInsertRace(error: unknown): boolean {
  if (!isDuplicateKeyError(error)) return false;
  const keys = Object.keys(error.keyPattern ?? {}).sort();
  return RETRYABLE_KEYS.some(
    (k) => k.length === keys.length && k.every((key, i) => key === keys[i]),
  );
}

/**
 * Runs `fn` in a MongoDB transaction. The driver retries transient errors such as write
 * conflicts between concurrent stock updates; insert races are retried here.
 */
export async function inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      let result!: T;
      await mongoose.connection.transaction(async (session) => {
        result = await fn(session);
      });
      return result;
    } catch (error) {
      if (attempt < 5 && isRetryableInsertRace(error)) continue;
      throw error;
    }
  }
}
