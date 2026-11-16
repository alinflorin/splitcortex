import { ed25519 } from '@noble/curves/ed25519.js';
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
 * The browser's own Ed25519 key pair, generated on first use and kept in this origin's localStorage. The private key
 * never leaves the browser. Like the phone app's key it is software-held (readable by script on this origin and by
 * anyone with the browser profile), not a hardware key: clearing the site's data forgets it and the device must be
 * enrolled again (the old node then stays in the pool until an admin removes it).
 */
export async function getOrCreateIdentity(): Promise<Identity> {
  let stored = localStorage.getItem(KEY);
  if (!stored || !/^[0-9a-f]{64}$/.test(stored)) {
    stored = hex(randomBytes(32));
    localStorage.setItem(KEY, stored);
  }
  const privateKey = unhex(stored);
  const publicKey = ed25519.getPublicKey(privateKey);
  return { privateKey, publicKey, publicKeyB64: toB64(publicKey) };
}

/** Forgets the key (a new enrollment will then register a new key). */
export const resetIdentity = async () => localStorage.removeItem(KEY);
