import {
  createHash,
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  hkdfSync,
  randomBytes,
  randomInt,
  verify as edVerify,
} from 'node:crypto';
import { cpace } from '@cipherman/pake-js';

/** Crockford base32 without I, L, O, U (no ambiguous characters). */
export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LOOKUP_LENGTH = 4;
const SECRET_LENGTH = 6;

const randomChars = (n: number) =>
  Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

export function generateCode() {
  return { lookupId: randomChars(LOOKUP_LENGTH), secret: randomChars(SECRET_LENGTH) };
}

export const formatCode = (lookupId: string, secret: string) => `${lookupId}-${secret}`;

/** Normalises what a person typed (case, dash, spaces, O/I/L look-alikes). Returns null when it cannot be a code. */
export function parseCode(input: string): { lookupId: string; secret: string } | null {
  const c = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (c.length !== LOOKUP_LENGTH + SECRET_LENGTH) return null;
  if ([...c].some((ch) => !ALPHABET.includes(ch))) return null;
  return { lookupId: c.slice(0, LOOKUP_LENGTH), secret: c.slice(LOOKUP_LENGTH) };
}

export const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64url');
export const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

/** Short fingerprint of a public key for the admin to compare: `XXXX-XXXX-XXXX` (60 bits of SHA-256). */
export function fingerprint(publicKey: Uint8Array): string {
  const h = createHash('sha256').update(publicKey).digest();
  let bits = 0n;
  for (let i = 0; i < 8; i++) bits = (bits << 8n) | BigInt(h[i]!);
  bits >>= 4n; // 60 bits
  let out = '';
  for (let i = 11; i >= 0; i--) out += ALPHABET[Number((bits >> BigInt(i * 5)) & 31n)];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

const enc = new TextEncoder();
const CHANNEL = enc.encode('splitcortex-enroll-v1');
export const POP_LABEL = enc.encode('splitcortex-enroll-v1');

/** PAKE password: the secret half of the code only. */
const prs = (secret: string) => enc.encode(`splitcortex-enroll-v1:${secret}`);

/** Server side (responder) of CPace: takes the device share and returns our share plus the 64-byte ISK. */
export function serverPake(secret: string, sid: Uint8Array, deviceShare: Uint8Array) {
  const me = cpace.ristretto255.init({ PRS: prs(secret), sid, CI: CHANNEL });
  const isk = cpace.ristretto255.deriveIskInitiatorResponder({
    ephemeralSecret: me.ephemeralSecret,
    ownShare: me.share,
    peerShare: deviceShare,
    ownAD: enc.encode('server'),
    peerAD: enc.encode('device'),
    sid,
    role: 'responder',
  });
  return { share: me.share, isk };
}

const key = (isk: Uint8Array, sid: Uint8Array, label: string) =>
  Buffer.from(hkdfSync('sha256', isk, sid, `splitcortex-enroll-v1 ${label}`, 32));

/** ChaCha20-Poly1305; wire format `nonce(12) || ciphertext || tag(16)`. `label` is `request` or `response`. */
export function seal(isk: Uint8Array, sid: Uint8Array, label: string, plain: Uint8Array) {
  const nonce = randomBytes(12);
  const c = createCipheriv('chacha20-poly1305', key(isk, sid, label), nonce, { authTagLength: 16 });
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return new Uint8Array(Buffer.concat([nonce, ct, c.getAuthTag()]));
}

/** Returns null when the key is wrong or the message was altered. */
export function open(isk: Uint8Array, sid: Uint8Array, label: string, sealed: Uint8Array) {
  if (sealed.length < 12 + 16) return null;
  const buf = Buffer.from(sealed);
  try {
    const d = createDecipheriv('chacha20-poly1305', key(isk, sid, label), buf.subarray(0, 12), {
      authTagLength: 16,
    });
    d.setAuthTag(buf.subarray(buf.length - 16));
    return new Uint8Array(Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]));
  } catch {
    return null;
  }
}

// DER prefix of an Ed25519 SubjectPublicKeyInfo; the rest is the 32 raw bytes.
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');

/** Verifies the proof of possession: signature over `POP_LABEL || sid` by the device key. */
export function verifyProofOfPossession(
  publicKey: Uint8Array,
  sid: Uint8Array,
  signature: Uint8Array,
): boolean {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI, publicKey]),
      format: 'der',
      type: 'spki',
    });
    return edVerify(null, Buffer.concat([POP_LABEL, sid]), key, signature);
  } catch {
    return false;
  }
}
