import { describe, expect, it } from '@jest/globals';
import * as fc from 'fast-check';

import { utf8Decode, utf8Encode } from '../encoding/utf8';
import { EncryptedStorage, type Cipher, type KeyStore, type ValueStore } from './encrypted-storage';

/** In-memory fakes for the two stores and a reversible, key-checking fake cipher. */
type FakeOptions = Readonly<{ keyDelay?: () => number; valueDelay?: () => number }>;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function makeDeps(options: FakeOptions = {}) {
  const keys = new Map<string, string>();
  const values = new Map<string, string>();
  const keyDelay = options.keyDelay ?? (() => 0);
  const valueDelay = options.valueDelay ?? (() => 0);
  let counter = 0;
  let keyReadsFail = false;
  const keyStore: KeyStore = {
    get: async (k) => {
      if (keyReadsFail) throw new Error('keychain unavailable');
      return keys.get(k) ?? null;
    },
    set: async (k, v) => {
      await sleep(keyDelay());
      keys.set(k, v);
    },
    remove: async (k) => {
      await sleep(keyDelay());
      keys.delete(k);
    },
  };
  const valueStore: ValueStore = {
    getItem: async (k) => values.get(k) ?? null,
    setItem: async (k, v) => {
      await sleep(valueDelay());
      values.set(k, v);
    },
    removeItem: async (k) => {
      await sleep(valueDelay());
      values.delete(k);
    },
  };
  const cipher: Cipher = {
    encrypt: async (plaintext) => {
      counter += 1;
      const key = `key-${counter}`;
      // obfuscate bytes (shift by 1) so the plaintext is not visible in the stored string
      return { key, sealed: `${key}|${Array.from(plaintext, (b) => b + 1).join('.')}` };
    },
    decrypt: async (sealed, key) => {
      const [sealedKey, body] = sealed.split('|');
      if (sealedKey !== key || body === undefined || body === '') throw new Error('authentication failed');
      return Uint8Array.from(body.split('.'), (b) => Number(b) - 1);
    },
  };
  return {
    keys,
    values,
    failKeyReads: () => {
      keyReadsFail = true;
    },
    storage: new EncryptedStorage({ keyStore, valueStore, cipher }),
  };
}

describe('EncryptedStorage (supabase-js auth storage)', () => {
  it('round-trips a session, including non-ASCII metadata', async () => {
    const { storage } = makeDeps();
    const session = JSON.stringify({ access_token: 'a.b.c', user: { user_metadata: { full_name: 'Айгерім Сәрсенова' } } });
    await storage.setItem('sb-auth-token', session);
    expect(await storage.getItem('sb-auth-token')).toBe(session);
  });

  it('never stores the plaintext and keeps the key out of the value store', async () => {
    const { storage, keys, values } = makeDeps();
    await storage.setItem('sb-auth-token', 'secret-session');
    expect([...values.values()].join()).not.toContain('secret-session');
    expect(keys.has('sb-auth-token')).toBe(true);
    expect(values.has('sb-auth-token')).toBe(true);
  });

  it('uses a fresh key for every write', async () => {
    const { storage, keys } = makeDeps();
    await storage.setItem('k', 'one');
    const first = keys.get('k');
    await storage.setItem('k', 'two');
    expect(keys.get('k')).not.toBe(first);
    expect(await storage.getItem('k')).toBe('two');
  });

  it('returns null for missing items and when either half is missing', async () => {
    const { storage, keys, values } = makeDeps();
    expect(await storage.getItem('missing')).toBeNull();
    await storage.setItem('k', 'v');
    keys.delete('k');
    expect(await storage.getItem('k')).toBeNull();
    await storage.setItem('k2', 'v');
    values.delete('k2');
    expect(await storage.getItem('k2')).toBeNull();
  });

  it('drops tampered or undecryptable data instead of throwing (user signs in again)', async () => {
    const { storage, keys, values } = makeDeps();
    await storage.setItem('k', 'v');
    values.set('k', 'forged|66.67');
    expect(await storage.getItem('k')).toBeNull();
    expect(keys.has('k')).toBe(false);
    expect(values.has('k')).toBe(false);
  });

  it('keeps key and ciphertext paired when writes overlap (concurrent token refreshes)', async () => {
    // First keychain write is slow, second fast; AsyncStorage the other way round. Unserialised,
    // this leaves key #1 next to ciphertext #2 and the next read discards the session.
    const keyDelays = [20, 0];
    const valueDelays = [0, 20];
    const { storage } = makeDeps({ keyDelay: () => keyDelays.shift() ?? 0, valueDelay: () => valueDelays.shift() ?? 0 });
    await Promise.all([storage.setItem('k', 'first'), storage.setItem('k', 'second')]);
    expect(await storage.getItem('k')).toBe('second');
  });

  it('applies overlapping operations in call order (property)', async () => {
    type Op = { kind: 'set'; value: string } | { kind: 'remove' };
    const op = fc.oneof(
      fc.record({ kind: fc.constant('set' as const), value: fc.string({ minLength: 1, maxLength: 8 }) }),
      fc.record({ kind: fc.constant('remove' as const) }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 6 }), fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 24, maxLength: 24 }), async (ops: Op[], delays) => {
        let i = 0;
        const next = () => delays[i++ % delays.length] ?? 0;
        const { storage } = makeDeps({ keyDelay: next, valueDelay: next });
        await Promise.all(ops.map((o) => (o.kind === 'set' ? storage.setItem('k', o.value) : storage.removeItem('k'))));
        const last = ops[ops.length - 1];
        expect(await storage.getItem('k')).toBe(last?.kind === 'set' ? last.value : null);
      }),
      { numRuns: 50 },
    );
  });

  it('propagates Keychain read errors instead of deleting the session', async () => {
    const { storage, keys, values, failKeyReads } = makeDeps();
    await storage.setItem('k', 'v');
    failKeyReads();
    await expect(storage.getItem('k')).rejects.toThrow('keychain unavailable');
    expect(keys.has('k') && values.has('k')).toBe(true);
  });

  it('removes both halves', async () => {
    const { storage, keys, values } = makeDeps();
    await storage.setItem('k', 'v');
    await storage.removeItem('k');
    expect(keys.has('k') || values.has('k')).toBe(false);
  });
});

describe('utf8Encode / utf8Decode', () => {
  it('match Node TextEncoder/TextDecoder for any string', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        const encoded = utf8Encode(text);
        expect(Array.from(encoded)).toEqual(Array.from(new TextEncoder().encode(text)));
        expect(utf8Decode(encoded)).toBe(new TextDecoder().decode(encoded));
      }),
    );
  });

  it('decodes arbitrary bytes exactly like TextDecoder (malformed input → U+FFFD)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        expect(utf8Decode(bytes)).toBe(new TextDecoder().decode(bytes));
      }),
    );
  });

  it('round-trips Kazakh, Russian and emoji text', () => {
    for (const text of ['Қазақша', 'Русский', '₸ 12 500', '💰']) {
      expect(utf8Decode(utf8Encode(text))).toBe(text);
    }
  });
});
