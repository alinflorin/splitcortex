import { cpace } from '@cipherman/pake-js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

// Device side of the enrollment protocol. Must match src/control-plane/src/enrollment/crypto.ts byte for byte.

/** Crockford base32 without I, L, O, U. */
export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const enc = new TextEncoder();
const CHANNEL = enc.encode('splitcortex-enroll-v1');
export const POP_LABEL = enc.encode('splitcortex-enroll-v1');

/** Normalises what a person typed (case, dash, spaces, O/I/L look-alikes). Null when it cannot be a code. */
export function parseCode(input: string): { lookupId: string; secret: string } | null {
  const c = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (c.length !== 10 || [...c].some((ch) => !ALPHABET.includes(ch))) return null;
  return { lookupId: c.slice(0, 4), secret: c.slice(4) };
}

/** Shows typed input as `XXXX-XXXXXX` while typing. */
export function formatCodeInput(input: string): string {
  const c = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, 10);
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

export const toB64 = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export function fromB64(s: string): Uint8Array {
  const std = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(std + '='.repeat((4 - (std.length % 4)) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

/** Short fingerprint of a public key: `XXXX-XXXX-XXXX` (60 bits of SHA-256), shown to the admin to compare. */
export function fingerprint(publicKey: Uint8Array): string {
  const h = sha256(publicKey);
  let bits = 0n;
  for (let i = 0; i < 8; i++) bits = (bits << 8n) | BigInt(h[i]!);
  bits >>= 4n;
  let out = '';
  for (let i = 11; i >= 0; i--) out += ALPHABET[Number((bits >> BigInt(i * 5)) & 31n)];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

/** First CPace message (device = initiator); `finish` derives the 64-byte ISK from the server's share. */
export function startPake(secret: string, sid: Uint8Array) {
  const me = cpace.ristretto255.init({
    PRS: enc.encode(`splitcortex-enroll-v1:${secret}`),
    sid,
    CI: CHANNEL,
  });
  return {
    share: me.share,
    finish: (serverShare: Uint8Array) =>
      cpace.ristretto255.deriveIskInitiatorResponder({
        ephemeralSecret: me.ephemeralSecret,
        ownShare: me.share,
        peerShare: serverShare,
        ownAD: enc.encode('device'),
        peerAD: enc.encode('server'),
        sid,
        role: 'initiator',
      }),
  };
}

const key = (isk: Uint8Array, sid: Uint8Array, label: string) =>
  hkdf(sha256, isk, sid, enc.encode(`splitcortex-enroll-v1 ${label}`), 32);

/** ChaCha20-Poly1305; wire format `nonce(12) || ciphertext || tag(16)`. */
export function seal(
  isk: Uint8Array,
  sid: Uint8Array,
  label: string,
  plain: Uint8Array,
  nonce: Uint8Array,
): Uint8Array {
  const ct = chacha20poly1305(key(isk, sid, label), nonce).encrypt(plain);
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce);
  out.set(ct, nonce.length);
  return out;
}

/** Null when the key is wrong or the message was altered (e.g. a server that does not know the code). */
export function open(
  isk: Uint8Array,
  sid: Uint8Array,
  label: string,
  sealed: Uint8Array,
): Uint8Array | null {
  if (sealed.length < 12 + 16) return null;
  try {
    return chacha20poly1305(key(isk, sid, label), sealed.subarray(0, 12)).decrypt(
      sealed.subarray(12),
    );
  } catch {
    return null;
  }
}

/** Proof of possession sent at enrollment: signature over `POP_LABEL || sid`. */
export function proofOfPossession(privateKey: Uint8Array, sid: Uint8Array): Uint8Array {
  const msg = new Uint8Array(POP_LABEL.length + sid.length);
  msg.set(POP_LABEL);
  msg.set(sid, POP_LABEL.length);
  return ed25519.sign(msg, privateKey);
}
