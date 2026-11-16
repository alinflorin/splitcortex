import { ed25519 } from '@noble/curves/ed25519.js';
import { toB64 } from './crypto';
import { randomBytes } from './random';
import { tauriApi, inTauri } from '../native/ipc';

const KEY = 'device-key';
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));

export interface Identity {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  /** Base64url of the raw 32-byte public key, as registered with the platform. */
  publicKeyB64: string;
}

/**
 * Where the key lives: a file only the current user can read in the app's data directory (written by the native side,
 * mode 0600 on Unix), never the webview's storage. In a plain browser (`pnpm dev`, tests) it is localStorage.
 */
const store = {
  get: async (): Promise<string | null> =>
    inTauri() ? tauriApi.secretGet(KEY) : localStorage.getItem(`sc-${KEY}`),
  set: async (v: string) =>
    inTauri() ? tauriApi.secretSet(KEY, v) : localStorage.setItem(`sc-${KEY}`, v),
  delete: async () =>
    inTauri() ? tauriApi.secretDelete(KEY) : localStorage.removeItem(`sc-${KEY}`),
};

/**
 * This device's own Ed25519 key pair, generated on first use. The private key never leaves the device. Like the phone
 * app's key it is software-held (readable by anyone with the user's account on this computer), not a hardware key:
 * deleting the app's data forgets it and the device must be enrolled again (the old node then stays in the pool until
 * an admin removes it).
 */
export async function getOrCreateIdentity(): Promise<Identity> {
  let stored = await store.get();
  if (!stored || !/^[0-9a-f]{64}$/.test(stored)) {
    stored = hex(randomBytes(32));
    await store.set(stored);
  }
  const privateKey = unhex(stored);
  const publicKey = ed25519.getPublicKey(privateKey);
  return { privateKey, publicKey, publicKeyB64: toB64(publicKey) };
}

/** Forgets the key (a new enrollment will then register a new key). */
export const resetIdentity = () => store.delete();
