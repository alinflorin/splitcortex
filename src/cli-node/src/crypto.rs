//! Device side of the enrollment protocol. Must match src/control-plane/src/enrollment/crypto.ts (and the web node's
//! copy, src/web-node/src/enrollment/crypto.ts) byte for byte: CPace ristretto255/SHA-512 (draft-20, as
//! `@cipherman/pake-js` implements it), HKDF-SHA256, ChaCha20-Poly1305, Ed25519.

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Nonce};
use curve25519_dalek::ristretto::{CompressedRistretto, RistrettoPoint};
use curve25519_dalek::scalar::Scalar;
use curve25519_dalek::traits::IsIdentity;
use ed25519_dalek::{Signer, SigningKey};
use hkdf::Hkdf;
use rand::Rng;
use sha2::{Digest, Sha256, Sha512};

/// Crockford base32 without I, L, O, U.
pub const ALPHABET: &str = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CHANNEL: &[u8] = b"splitcortex-enroll-v1";
pub const POP_LABEL: &[u8] = b"splitcortex-enroll-v1";

pub fn b64(b: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(b)
}

pub fn unb64(s: &str) -> Option<Vec<u8>> {
    URL_SAFE_NO_PAD.decode(s.trim_end_matches('=')).ok()
}

/// Normalises what a person typed (case, dash, spaces, O/I/L look-alikes). `None` when it cannot be a code.
pub fn parse_code(input: &str) -> Option<(String, String)> {
    let c: String = input
        .to_uppercase()
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .map(|c| match c {
            'O' => '0',
            'I' | 'L' => '1',
            c => c,
        })
        .collect();
    if c.chars().count() != 10 || !c.chars().all(|ch| ALPHABET.contains(ch)) {
        return None;
    }
    Some((c[..4].to_string(), c[4..].to_string()))
}

/// Short fingerprint of a public key: `XXXX-XXXX-XXXX` (60 bits of SHA-256), shown to the admin to compare.
pub fn fingerprint(public_key: &[u8]) -> String {
    let h = Sha256::digest(public_key);
    let mut bits: u64 = 0;
    for b in &h[..8] {
        bits = (bits << 8) | *b as u64;
    }
    bits >>= 4;
    let alphabet = ALPHABET.as_bytes();
    let out: String = (0..12)
        .rev()
        .map(|i| alphabet[((bits >> (i * 5)) & 31) as usize] as char)
        .collect();
    format!("{}-{}-{}", &out[..4], &out[4..8], &out[8..12])
}

// ---- CPace (ristretto255, SHA-512) ----

const DSI: &[u8] = b"CPaceRistretto255";
const DSI_ISK: &[u8] = b"CPaceRistretto255_ISK";
const HASH_BLOCK_BYTES: usize = 128;

fn leb128(mut n: usize) -> Vec<u8> {
    let mut out = Vec::new();
    loop {
        let mut byte = (n & 0x7f) as u8;
        n >>= 7;
        if n != 0 {
            byte |= 0x80;
        }
        out.push(byte);
        if n == 0 {
            return out;
        }
    }
}

/// Every part prefixed with its length as LEB128.
fn lv_cat(parts: &[&[u8]]) -> Vec<u8> {
    let mut out = Vec::new();
    for p in parts {
        out.extend(leb128(p.len()));
        out.extend_from_slice(p);
    }
    out
}

fn generator(prs: &[u8], ci: &[u8], sid: &[u8]) -> RistrettoPoint {
    let prepend_dsi = leb128(DSI.len()).len() + DSI.len();
    let prepend_prs = leb128(prs.len()).len() + prs.len();
    let zpad = HASH_BLOCK_BYTES.saturating_sub(1 + prepend_prs + prepend_dsi);
    let gen_str = lv_cat(&[DSI, prs, &vec![0u8; zpad], ci, sid]);
    let h: [u8; 64] = Sha512::digest(gen_str).into();
    RistrettoPoint::from_uniform_bytes(&h)
}

/// The device's first CPace message (the device is the initiator).
pub struct Pake {
    scalar: Scalar,
    pub share: [u8; 32],
    sid: Vec<u8>,
}

pub fn start_pake(secret: &str, sid: &[u8]) -> Pake {
    // 48 random bytes read little-endian and reduced mod the group order (the same sampling as the JS side).
    let mut wide = [0u8; 64];
    rand::rng().fill_bytes(&mut wide[..48]);
    start_pake_with(secret, sid, Scalar::from_bytes_mod_order_wide(&wide))
}

fn start_pake_with(secret: &str, sid: &[u8], scalar: Scalar) -> Pake {
    let prs = format!("splitcortex-enroll-v1:{secret}");
    let g = generator(prs.as_bytes(), CHANNEL, sid);
    Pake {
        scalar,
        share: (g * scalar).compress().to_bytes(),
        sid: sid.to_vec(),
    }
}

impl Pake {
    /// The 64-byte ISK from the server's share; `None` when the share is not a valid point or the result is neutral.
    pub fn finish(&self, server_share: &[u8]) -> Option<[u8; 64]> {
        let peer = CompressedRistretto::from_slice(server_share)
            .ok()?
            .decompress()?;
        let k = peer * self.scalar;
        if k.is_identity() {
            return None;
        }
        let k = k.compress().to_bytes();
        let prefix = lv_cat(&[DSI_ISK, &self.sid, &k]);
        let transcript = [
            lv_cat(&[&self.share, b"device"]),
            lv_cat(&[server_share, b"server"]),
        ]
        .concat();
        Some(Sha512::digest([prefix, transcript].concat()).into())
    }
}

fn key(isk: &[u8], sid: &[u8], label: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    Hkdf::<Sha256>::new(Some(sid), isk)
        .expand(
            format!("splitcortex-enroll-v1 {label}").as_bytes(),
            &mut out,
        )
        .expect("32 bytes is a valid HKDF length");
    out
}

/// ChaCha20-Poly1305; wire format `nonce(12) || ciphertext || tag(16)`.
pub fn seal(isk: &[u8], sid: &[u8], label: &str, plain: &[u8]) -> Vec<u8> {
    let mut nonce = [0u8; 12];
    rand::rng().fill_bytes(&mut nonce);
    let ct = ChaCha20Poly1305::new(&key(isk, sid, label).into())
        .encrypt(&Nonce::from(nonce), plain)
        .expect("encryption cannot fail");
    [nonce.to_vec(), ct].concat()
}

/// `None` when the key is wrong or the message was altered (e.g. a server that does not know the code).
pub fn open(isk: &[u8], sid: &[u8], label: &str, sealed: &[u8]) -> Option<Vec<u8>> {
    if sealed.len() < 12 + 16 {
        return None;
    }
    ChaCha20Poly1305::new(&key(isk, sid, label).into())
        .decrypt(&Nonce::try_from(&sealed[..12]).ok()?, &sealed[12..])
        .ok()
}

/// Proof of possession sent at enrollment: signature over `POP_LABEL || sid`.
pub fn proof_of_possession(key: &SigningKey, sid: &[u8]) -> Vec<u8> {
    key.sign(&[POP_LABEL, sid].concat()).to_bytes().to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_normalised() {
        assert_eq!(
            parse_code("k7m2-qx9h4t"),
            Some(("K7M2".into(), "QX9H4T".into()))
        );
        // O, I and L are read as 0, 1 and 1
        assert_eq!(
            parse_code("O0IL-000000"),
            Some(("0011".into(), "000000".into()))
        );
        assert_eq!(parse_code("K7M2-QX9H4"), None);
        assert_eq!(parse_code("K7M2-QX9H4U"), None);
    }

    #[test]
    fn the_fingerprint_has_the_shape_the_server_computes() {
        let f = fingerprint(&[7u8; 32]);
        assert_eq!(f.len(), 14);
        assert!(f.chars().all(|c| c == '-' || ALPHABET.contains(c)));
    }

    /// Both sides derive the same key, a wrong code does not, and a sealed message only opens with the right key.
    #[test]
    fn pake_and_seal_round_trip_with_a_server_side_peer() {
        let sid = [9u8; 16];
        let dev = start_pake("QX9H4T", &sid);
        // the server (responder) side, written out the way the control plane does it
        let prs = b"splitcortex-enroll-v1:QX9H4T";
        let g = generator(prs, CHANNEL, &sid);
        let ys = Scalar::from(12345u64);
        let server_share = (g * ys).compress().to_bytes();
        let isk = dev.finish(&server_share).unwrap();

        let k = (CompressedRistretto::from_slice(&dev.share)
            .unwrap()
            .decompress()
            .unwrap()
            * ys)
            .compress()
            .to_bytes();
        let transcript = [
            lv_cat(&[&dev.share, b"device"]),
            lv_cat(&[&server_share, b"server"]),
        ]
        .concat();
        let server_isk: [u8; 64] =
            Sha512::digest([lv_cat(&[DSI_ISK, &sid, &k]), transcript].concat()).into();
        assert_eq!(isk, server_isk);

        let sealed = seal(&isk, &sid, "request", b"hello");
        assert_eq!(
            open(&server_isk, &sid, "request", &sealed).unwrap(),
            b"hello"
        );
        assert!(open(&server_isk, &sid, "response", &sealed).is_none());
        let mut bad = sealed.clone();
        bad[14] ^= 1;
        assert!(open(&isk, &sid, "request", &bad).is_none());
    }

    fn unhex(s: &str) -> Vec<u8> {
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
            .collect()
    }

    /// Values produced by `@cipherman/pake-js` (what the control plane and the web side run) for fixed inputs: the
    /// device share and the derived key must match byte for byte, or enrollment against the real server fails.
    #[test]
    fn cpace_matches_the_javascript_implementation() {
        let sid: Vec<u8> = (0..16).collect();
        let scalar = Scalar::from_canonical_bytes(
            unhex("1623303d4a5764717e8b98a5b2bfccd9e6f3000d1a2734414e5b6875828f9c00")
                .try_into()
                .unwrap(),
        )
        .unwrap();
        let dev = start_pake_with("QX9H4T", &sid, scalar);
        assert_eq!(
            dev.share.to_vec(),
            unhex("18b4336088b38070084c2825dce554745c9fdca9b27d6b60f2dbdbe75505fc1e")
        );
        let isk = dev
            .finish(&unhex(
                "5a06ce008c64aabe88024972a8c13ba3fec90dc6995437786bcd09eb4aed7811",
            ))
            .unwrap();
        assert_eq!(
            isk.to_vec(),
            unhex(
                "ffa830f1b842a8b6afcd0b55d01ecc3f94648fe975296b0190cbd11e6491a0272e0332158386dcfe10ec74eb58f8070a60c1d8f8117de72fb4d6fd77438ee1bb"
            )
        );
    }

    #[test]
    fn a_bad_server_share_is_refused() {
        let dev = start_pake("QX9H4T", &[1u8; 16]);
        assert!(dev.finish(&[0u8; 32]).is_none()); // the neutral element
        assert!(dev.finish(&[0xffu8; 32]).is_none()); // not a point
        assert!(dev.finish(&[1u8; 5]).is_none());
    }
}
