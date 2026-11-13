import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for single string values. A sealed value is `enc:v1:` + base64url of
 * iv (12 bytes) | ciphertext | tag (16 bytes). The additional authenticated data names the
 * owner and the field (`<customerId>:email`), so a value copied onto another record or into
 * another field fails to open instead of decrypting under the wrong label.
 *
 * Empty strings stay empty: an unset field carries no personal data, and keeping it empty
 * lets forms and DTOs treat "not given" the same way before and after erasure.
 */
const PREFIX = 'enc:v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export const isSealed = (value: string) => value.startsWith(PREFIX);

export function sealValue(key: Buffer, aad: string, plaintext: string): string {
  if (plaintext === '') return '';
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64url');
}

export class DecryptionError extends Error {
  constructor(aad: string, reason: string) {
    super(`Could not decrypt ${aad}: ${reason}`);
    this.name = 'DecryptionError';
  }
}

/** Opens a sealed value. Plaintext where ciphertext is expected is an error, not a pass-through. */
export function openValue(key: Buffer, aad: string, value: string): string {
  if (value === '') return '';
  if (!isSealed(value)) throw new DecryptionError(aad, 'the stored value is not encrypted');
  const raw = Buffer.from(value.slice(PREFIX.length), 'base64url');
  if (raw.length < IV_BYTES + TAG_BYTES) throw new DecryptionError(aad, 'the value is truncated');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
  try {
    return Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new DecryptionError(aad, 'the key or label does not match');
  }
}

/** Raw-bytes variant for wrapping data keys. */
export function sealBytes(key: Buffer, aad: string, bytes: Buffer): string {
  return sealValue(key, aad, bytes.toString('base64'));
}

export function openBytes(key: Buffer, aad: string, value: string): Buffer {
  return Buffer.from(openValue(key, aad, value), 'base64');
}

/** Normalises an email the way search does: trimmed, lower case. */
export const normaliseEmail = (email: string) => email.trim().toLowerCase();

/**
 * Keyed hash of an email, stored next to the ciphertext so an exact-match search can find
 * the customer without decrypting every record. Without the key the hash can't be computed,
 * so it can't be reversed by hashing guessed addresses.
 */
export function blindIndex(key: Buffer, email: string): string | null {
  const normalised = normaliseEmail(email);
  if (normalised === '') return null;
  return createHmac('sha256', key).update(`email:${normalised}`).digest('base64url');
}
