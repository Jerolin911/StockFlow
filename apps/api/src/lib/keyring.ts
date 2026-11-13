/**
 * Master keys (key-encryption keys) for customer personal data, parsed from the environment.
 * DATA_ENCRYPTION_KEYS is a comma-separated list of `id:base64key`; the first entry is the
 * active key that wraps new customer keys, the rest stay readable until every customer key
 * has been re-wrapped (`npm run privacy:rotate-key`).
 */
export interface Keyring {
  activeId: string;
  keys: ReadonlyMap<string, Buffer>;
}

const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;
const KEY_BYTES = 32;

/** Decodes a base64 (or base64url) value that must be exactly 32 bytes. */
export function parseKey(value: string, name: string): Buffer {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) throw new Error(`${name} must be base64`);
  const key = Buffer.from(trimmed, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`${name} must decode to ${KEY_BYTES} bytes (got ${key.length})`);
  }
  return key;
}

export function parseKeyring(value: string): Keyring {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) throw new Error('DATA_ENCRYPTION_KEYS needs at least one key');
  const keys = new Map<string, Buffer>();
  for (const entry of entries) {
    const separator = entry.indexOf(':');
    const id = separator === -1 ? '' : entry.slice(0, separator);
    if (!KEY_ID.test(id)) {
      throw new Error('DATA_ENCRYPTION_KEYS entries are id:base64key, with ids of A-Z a-z 0-9 _ -');
    }
    if (keys.has(id)) throw new Error(`DATA_ENCRYPTION_KEYS has the key id "${id}" twice`);
    keys.set(id, parseKey(entry.slice(separator + 1), `DATA_ENCRYPTION_KEYS key "${id}"`));
  }
  return { activeId: entries[0]!.slice(0, entries[0]!.indexOf(':')), keys };
}
