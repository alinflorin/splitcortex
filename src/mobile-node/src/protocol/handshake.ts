import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { toB64 } from '../enrollment/crypto';

// Must match src/gateway/src/node_ws.rs byte for byte. Messages are `label` followed by `\n` + part for every part.
export const GATEWAY_HELLO = 'splitcortex-gateway-hello-v1';
export const NODE_HELLO = 'splitcortex-node-hello-v1';
export const NODE_REQUEST = 'splitcortex-node-request-v1';
export const NEXT_GATEWAY_KEY = 'splitcortex-gateway-next-key-v1';

const enc = new TextEncoder();

export function signedMessage(label: string, ...parts: (Uint8Array | string)[]): Uint8Array {
  const chunks: Uint8Array[] = [enc.encode(label)];
  for (const p of parts) chunks.push(enc.encode('\n'), typeof p === 'string' ? enc.encode(p) : p);
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** The gateway signs `node nonce` and the node id with its pinned key; the node checks it before revealing anything. */
export function verifyGatewayHello(
  gatewayPublicKey: Uint8Array,
  nodeNonce: Uint8Array,
  nodeId: string,
  signature: Uint8Array,
): boolean {
  try {
    return ed25519.verify(
      signature,
      signedMessage(GATEWAY_HELLO, nodeNonce, nodeId),
      gatewayPublicKey,
    );
  } catch {
    return false;
  }
}

export function signNodeHello(
  privateKey: Uint8Array,
  serverNonce: Uint8Array,
  nodeNonce: Uint8Array,
  nodeId: string,
): Uint8Array {
  return ed25519.sign(signedMessage(NODE_HELLO, serverNonce, nodeNonce, nodeId), privateKey);
}

/**
 * `Authorization` header for the control plane's device-authenticated routes (`GET /api/node/models/...`): an Ed25519
 * signature over method, path (no query, as received, including `/api`) and the current unix second.
 */
export function nodeAuthorization(
  nodeId: string,
  privateKey: Uint8Array,
  method: string,
  path: string,
  nowMs = Date.now(),
): string {
  const ts = Math.floor(nowMs / 1000);
  const sig = ed25519.sign(signedMessage(NODE_REQUEST, method, path, String(ts)), privateKey);
  return `Node ${nodeId}.${ts}.${toB64(sig)}`;
}

/**
 * During a gateway key rotation the gateway announces the key it will switch to, signed by its current key (which this
 * device trusts). The node nonce is part of the message, so an announcement cannot be replayed on another connection.
 */
export function verifyNextGatewayKey(
  currentKey: Uint8Array,
  nodeNonce: Uint8Array,
  nextKey: Uint8Array,
  signature: Uint8Array,
): boolean {
  try {
    return ed25519.verify(
      signature,
      signedMessage(NEXT_GATEWAY_KEY, nodeNonce, nextKey),
      currentKey,
    );
  } catch {
    return false;
  }
}

/** Identifies a gateway key: the first 8 bytes of its SHA-256 (what `GatewayKeys` reports; the gateway prints the same hex). */
export const gatewayKeyId = (publicKey: Uint8Array): Uint8Array => sha256(publicKey).slice(0, 8);
