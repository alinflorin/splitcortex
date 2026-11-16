/** Cryptographically secure random bytes (WebCrypto). */
export const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));
