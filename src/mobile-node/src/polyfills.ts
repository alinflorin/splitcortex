import { getRandomValues } from 'expo-crypto';

// @noble and pake-js read `globalThis.crypto.getRandomValues`, which Hermes may not provide.
const g = globalThis as { crypto?: { getRandomValues?: unknown } };
if (typeof g.crypto?.getRandomValues !== 'function') {
  g.crypto = { ...g.crypto, getRandomValues };
}
