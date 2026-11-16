//! Must match src/gateway/src/node_ws.rs byte for byte. Messages are `label` followed by `\n` + part for every part.

use crate::crypto::b64;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

pub const GATEWAY_HELLO: &str = "splitcortex-gateway-hello-v1";
pub const NODE_HELLO: &str = "splitcortex-node-hello-v1";
pub const NODE_REQUEST: &str = "splitcortex-node-request-v1";
pub const NEXT_GATEWAY_KEY: &str = "splitcortex-gateway-next-key-v1";

pub fn signed_message(label: &str, parts: &[&[u8]]) -> Vec<u8> {
    let mut out = label.as_bytes().to_vec();
    for p in parts {
        out.push(b'\n');
        out.extend_from_slice(p);
    }
    out
}

fn verify(key: &[u8], message: &[u8], signature: &[u8]) -> bool {
    let (Ok(key), Ok(sig)) = (
        <[u8; 32]>::try_from(key)
            .map_err(|_| ())
            .and_then(|k| VerifyingKey::from_bytes(&k).map_err(|_| ())),
        Signature::from_slice(signature),
    ) else {
        return false;
    };
    key.verify(message, &sig).is_ok()
}

/// The gateway signs `node nonce` and the node id with its pinned key; the node checks it before revealing anything.
pub fn verify_gateway_hello(
    gateway_key: &[u8],
    node_nonce: &[u8],
    node_id: &str,
    signature: &[u8],
) -> bool {
    verify(
        gateway_key,
        &signed_message(GATEWAY_HELLO, &[node_nonce, node_id.as_bytes()]),
        signature,
    )
}

pub fn sign_node_hello(
    key: &SigningKey,
    server_nonce: &[u8],
    node_nonce: &[u8],
    node_id: &str,
) -> Vec<u8> {
    key.sign(&signed_message(
        NODE_HELLO,
        &[server_nonce, node_nonce, node_id.as_bytes()],
    ))
    .to_bytes()
    .to_vec()
}

/// `Authorization` header for the control plane's device-authenticated routes: an Ed25519 signature over method, path
/// (no query, as received, including `/api`) and the current unix second.
pub fn node_authorization(node_id: &str, key: &SigningKey, method: &str, path: &str) -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    node_authorization_at(node_id, key, method, path, ts)
}

fn node_authorization_at(
    node_id: &str,
    key: &SigningKey,
    method: &str,
    path: &str,
    ts: u64,
) -> String {
    let ts_s = ts.to_string();
    let sig = key.sign(&signed_message(
        NODE_REQUEST,
        &[method.as_bytes(), path.as_bytes(), ts_s.as_bytes()],
    ));
    format!("Node {node_id}.{ts}.{}", b64(&sig.to_bytes()))
}

/// During a gateway key rotation the gateway announces the key it will switch to, signed by its current key (which this
/// device trusts). The node nonce is part of the message, so an announcement cannot be replayed on another connection.
pub fn verify_next_gateway_key(
    current: &[u8],
    node_nonce: &[u8],
    next: &[u8],
    signature: &[u8],
) -> bool {
    verify(
        current,
        &signed_message(NEXT_GATEWAY_KEY, &[node_nonce, next]),
        signature,
    )
}

/// Identifies a gateway key: the first 8 bytes of its SHA-256 (what `GatewayKeys` reports).
pub fn gateway_key_id(public_key: &[u8]) -> Vec<u8> {
    Sha256::digest(public_key)[..8].to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(seed: u8) -> SigningKey {
        SigningKey::from_bytes(&[seed; 32])
    }

    #[test]
    fn the_gateway_must_prove_the_pinned_key() {
        let gw = key(1);
        let sig = gw
            .sign(&signed_message(GATEWAY_HELLO, &[b"nonce", b"node-1"]))
            .to_bytes();
        let pk = gw.verifying_key().to_bytes();
        assert!(verify_gateway_hello(&pk, b"nonce", "node-1", &sig));
        assert!(!verify_gateway_hello(&pk, b"other", "node-1", &sig));
        assert!(!verify_gateway_hello(&pk, b"nonce", "node-2", &sig));
        assert!(!verify_gateway_hello(
            &key(2).verifying_key().to_bytes(),
            b"nonce",
            "node-1",
            &sig
        ));
        assert!(!verify_gateway_hello(&pk[..5], b"nonce", "node-1", &sig));
    }

    #[test]
    fn the_signed_message_layout() {
        assert_eq!(signed_message("L", &[b"a", b"bc"]), b"L\na\nbc");
        assert_eq!(signed_message("L", &[]), b"L");
    }

    #[test]
    fn the_authorization_header_verifies_with_the_device_key() {
        let k = key(3);
        let h = node_authorization_at("n1", &k, "GET", "/api/node/me", 1_700_000_000);
        let rest = h.strip_prefix("Node n1.1700000000.").unwrap();
        let sig = crate::crypto::unb64(rest).unwrap();
        assert!(verify(
            &k.verifying_key().to_bytes(),
            &signed_message(NODE_REQUEST, &[b"GET", b"/api/node/me", b"1700000000"]),
            &sig
        ));
    }
}
