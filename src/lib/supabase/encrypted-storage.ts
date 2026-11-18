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
    const [encodedKey, sealed] = await Promise.all([this.deps.keyStore.get(key), this.deps.valueStore.getItem(key)]);
    if (encodedKey === null || sealed === null) return null;
    try {
      return utf8Decode(await this.deps.cipher.decrypt(sealed, encodedKey));
    } catch {
      // Authentication failed: tampered data or a half-finished write. Discard it.
      await this.remove(key);
      return null;
    }
  }

  private async write(key: string, value: string): Promise<void> {
    const { key: encodedKey, sealed } = await this.deps.cipher.encrypt(utf8Encode(value));
    await this.deps.keyStore.set(key, encodedKey);
    await this.deps.valueStore.setItem(key, sealed);
  }

  private async remove(key: string): Promise<void> {
    await Promise.all([this.deps.valueStore.removeItem(key), this.deps.keyStore.remove(key)]);
  }
}
