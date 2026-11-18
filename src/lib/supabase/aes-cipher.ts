import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import type { Cipher, KeyStore } from './encrypted-storage';

/** AES-GCM (authenticated) via expo-crypto's native implementation. A new key per write. */
export const aesGcmCipher: Cipher = {
  async encrypt(plaintext) {
    const key = await AESEncryptionKey.generate();
    const sealed = await aesEncryptAsync(plaintext, key);
    return { key: await key.encoded('hex'), sealed: await sealed.combined('base64') };
  },
  async decrypt(sealed, key) {
    const encryptionKey = await AESEncryptionKey.import(key, 'hex');
    return aesDecryptAsync(AESSealedData.fromCombined(sealed), encryptionKey, { output: 'bytes' });
  },
};

/** Keys stay on this device and are readable only while it is unlocked. */
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const keychainKeyStore: KeyStore = {
  get: (key) => SecureStore.getItemAsync(key, SECURE_OPTIONS),
  set: (key, value) => SecureStore.setItemAsync(key, value, SECURE_OPTIONS),
  remove: (key) => SecureStore.deleteItemAsync(key, SECURE_OPTIONS),
};
