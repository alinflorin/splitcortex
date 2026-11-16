import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { fromB64 } from '../enrollment/crypto';
import { nodeAuthorization, signedMessage, signNodeHello, verifyGatewayHello } from './handshake';

const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe('handshake messages', () => {
  it('joins the label and parts with newlines (the gateway builds the same bytes)', () => {
    const m = signedMessage('label', new Uint8Array([1, 2]), 'node-id');
    expect(dec(m)).toBe('label\n\u0001\u0002\nnode-id');
  });

  it('verifies only the gateway key that was pinned', () => {
    const gw = ed25519.utils.randomSecretKey();
    const other = ed25519.utils.randomSecretKey();
    const nonce = new Uint8Array(32).fill(7);
    const sig = ed25519.sign(signedMessage('splitcortex-gateway-hello-v1', nonce, 'n1'), gw);
    expect(verifyGatewayHello(ed25519.getPublicKey(gw), nonce, 'n1', sig)).toBe(true);
    expect(verifyGatewayHello(ed25519.getPublicKey(other), nonce, 'n1', sig)).toBe(false);
    expect(verifyGatewayHello(ed25519.getPublicKey(gw), nonce, 'n2', sig)).toBe(false);
    expect(verifyGatewayHello(ed25519.getPublicKey(gw), nonce, 'n1', new Uint8Array(3))).toBe(
      false,
    );
  });

  it('signs the node hello over both nonces and the node id', () => {
    const key = ed25519.utils.randomSecretKey();
    const s = new Uint8Array(32).fill(1);
    const n = new Uint8Array(32).fill(2);
    const sig = signNodeHello(key, s, n, 'n1');
    expect(
      ed25519.verify(
        sig,
        signedMessage('splitcortex-node-hello-v1', s, n, 'n1'),
        ed25519.getPublicKey(key),
      ),
    ).toBe(true);
    expect(
      ed25519.verify(
        sig,
        signedMessage('splitcortex-node-hello-v1', n, s, 'n1'),
        ed25519.getPublicKey(key),
      ),
    ).toBe(false);
  });
});

describe('control plane request authorization', () => {
  it('signs method, path and the unix second, as plugins/node-auth.ts verifies it', () => {
    const key = ed25519.utils.randomSecretKey();
    const header = nodeAuthorization('node-1', key, 'GET', '/api/node/models', 1_700_000_000_500);
    const [, rest] = header.split('Node ');
    const [id, ts, sig] = rest!.split('.');
    expect(id).toBe('node-1');
    expect(ts).toBe('1700000000');
    const msg = new TextEncoder().encode(
      'splitcortex-node-request-v1\nGET\n/api/node/models\n1700000000',
    );
    expect(ed25519.verify(fromB64(sig!), msg, ed25519.getPublicKey(key))).toBe(true);
  });
});
