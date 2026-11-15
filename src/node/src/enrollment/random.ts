import { getRandomBytes } from 'expo-crypto';

/** Cryptographically secure random bytes (native CSPRNG through expo-crypto). */
export const randomBytes = (n: number): Uint8Array => getRandomBytes(n);
