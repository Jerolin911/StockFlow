import bcrypt from 'bcrypt';
import { env } from '../../config/env.js';

let dummyHash: Promise<string> | undefined;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, env.BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Spends the same time as a real check so response timing doesn't reveal unknown emails. */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= bcrypt.hash('stockflow-timing-equaliser', env.BCRYPT_ROUNDS);
  await bcrypt.compare(password, await dummyHash);
}
