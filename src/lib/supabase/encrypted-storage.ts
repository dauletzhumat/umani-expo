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
  constructor(private readonly deps: EncryptedStorageDeps) {}

  async getItem(key: string): Promise<string | null> {
    const [encodedKey, sealed] = await Promise.all([this.deps.keyStore.get(key), this.deps.valueStore.getItem(key)]);
    if (encodedKey === null || sealed === null) return null;
    try {
      return utf8Decode(await this.deps.cipher.decrypt(sealed, encodedKey));
    } catch {
      await this.removeItem(key);
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    const { key: encodedKey, sealed } = await this.deps.cipher.encrypt(utf8Encode(value));
    await this.deps.keyStore.set(key, encodedKey);
    await this.deps.valueStore.setItem(key, sealed);
  }

  async removeItem(key: string): Promise<void> {
    await Promise.all([this.deps.valueStore.removeItem(key), this.deps.keyStore.remove(key)]);
  }
}
