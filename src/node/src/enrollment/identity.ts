import { ed25519 } from '@noble/curves/ed25519.js';
import * as SecureStore from 'expo-secure-store';
import { toB64 } from './crypto';
import { randomBytes } from './random';

const KEY = 'sc-device-key';
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));

export interface Identity {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  /** Base64url of the raw 32-byte public key, as registered with the platform. */
  publicKeyB64: string;
}

/**
 * The device's own Ed25519 key pair, generated on first use and kept in the platform secure store (Android
 * Keystore-backed encryption, iOS Keychain). The private key never leaves the device. It is not a hardware-resident
 * non-exportable key (no Ed25519 in the Expo-accessible keystore APIs), see CLAUDE.md.
 */
export async function getOrCreateIdentity(): Promise<Identity> {
  let stored = await SecureStore.getItemAsync(KEY);
  if (!stored) {
    stored = hex(randomBytes(32));
    await SecureStore.setItemAsync(KEY, stored);
  }
  const privateKey = unhex(stored);
  const publicKey = ed25519.getPublicKey(privateKey);
  return { privateKey, publicKey, publicKeyB64: toB64(publicKey) };
}

/** Forgets the key (a new enrollment will then register a new key). */
export const resetIdentity = () => SecureStore.deleteItemAsync(KEY);
