import { utf8Decode, utf8Encode } from '../encoding/utf8';

/**
 * Auth storage for supabase-js (ARCHITECTURE §5): the session is encrypted with a fresh AES key
 * on every write; the key lives in the Keychain (KeyStore) and only the ciphertext goes to
 * AsyncStorage (ValueStore). Unreadable or tampered data is discarded, so the user simply signs
 * in again rather than the app crashing. Dependencies are injected for testing.
 */

export type KeyStore = Readonly<{
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
}>;

export type ValueStore = Readonly<{
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}>;

export type Cipher = Readonly<{
  /** Encrypts with a newly generated key; returns the encoded key and the sealed data. */
  encrypt: (plaintext: Uint8Array) => Promise<{ key: string; sealed: string }>;
  /** Decrypts and authenticates; throws if the data or key do not match. */
  decrypt: (sealed: string, key: string) => Promise<Uint8Array>;
}>;

export type EncryptedStorageDeps = Readonly<{ keyStore: KeyStore; valueStore: ValueStore; cipher: Cipher }>;

export class EncryptedStorage {
  /**
   * Every operation runs after the previous one finishes. A write touches two stores (Keychain,
   * then AsyncStorage), so overlapping writes (e.g. two token refreshes) could otherwise leave one
   * write's key next to another's ciphertext, and the next read would discard the session.
   */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: EncryptedStorageDeps) {}

  getItem(key: string): Promise<string | null> {
    return this.serialised(() => this.read(key));
  }

  setItem(key: string, value: string): Promise<void> {
    return this.serialised(() => this.write(key, value));
  }

  removeItem(key: string): Promise<void> {
    return this.serialised(() => this.remove(key));
  }

  private serialised<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async read(key: string): Promise<string | null> {
    // Store read errors (e.g. Keychain unavailable) propagate: the data may still be valid.
    const stored = await this.deps.valueStore.getItem(key);
    if (stored === null) return null;
    const { keyName, sealed } = parseStored(key, stored);
    const encodedKey = await this.deps.keyStore.get(keyName);
    if (encodedKey === null) return null;
    try {
      return utf8Decode(await this.deps.cipher.decrypt(sealed, encodedKey));
    } catch {
      // Authentication failed: tampered data. Discard it.
      await this.remove(key);
      return null;
    }
  }

  /**
   * Crash-safe write: the new key goes into the Keychain slot the current value does not use,
   * then a single AsyncStorage write switches to it. A crash before that write leaves the old
   * key and ciphertext untouched.
   */
  private async write(key: string, value: string): Promise<void> {
    const stored = await this.deps.valueStore.getItem(key);
    const current = stored === null ? null : parseStored(key, stored);
    const slot: Slot = current?.slot === 'a' ? 'b' : 'a';
    const { key: encodedKey, sealed } = await this.deps.cipher.encrypt(utf8Encode(value));
    await this.deps.keyStore.set(slotKey(key, slot), encodedKey);
    await this.deps.valueStore.setItem(key, `${FORMAT}:${slot}:${sealed}`);
    // Committed. Drop the key the old value used (a previous slot or the legacy single key).
    if (current !== null) await this.deps.keyStore.remove(current.keyName);
  }

  private async remove(key: string): Promise<void> {
    await this.deps.valueStore.removeItem(key);
    await Promise.all([key, slotKey(key, 'a'), slotKey(key, 'b')].map((name) => this.deps.keyStore.remove(name)));
  }
}

type Slot = 'a' | 'b';

const FORMAT = 'v2';

function slotKey(key: string, slot: Slot): string {
  return `${key}.${slot}`;
}

/** `v2:<slot>:<sealed>`; anything else is the first format (key stored under the item name). */
function parseStored(key: string, stored: string): { slot: Slot | null; keyName: string; sealed: string } {
  const match = /^v2:([ab]):(.*)$/s.exec(stored);
  if (match === null) return { slot: null, keyName: key, sealed: stored };
  const slot: Slot = match[1] === 'a' ? 'a' : 'b';
  return { slot, keyName: slotKey(key, slot), sealed: match[2] ?? '' };
}
