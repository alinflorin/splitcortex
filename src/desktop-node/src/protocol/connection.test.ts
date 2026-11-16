import { afterEach, describe, expect, it, vi } from 'vitest';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { ed25519 } from '@noble/curves/ed25519.js';
import { LogBuffer } from '../runtime/log';
import { GatewayConnection, type Body, type ConnectionState, type SocketLike } from './connection';
import { gatewayKeyId, signedMessage } from './handshake';
import { EnvelopeSchema, ReadySchema, ServerHelloSchema } from './gen/splitcortex/node/v1/node_pb';

class FakeSocket implements SocketLike {
  binaryType = '';
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: Uint8Array[] = [];
  closed = false;
  send(d: ArrayBuffer | Uint8Array) {
    this.sent.push(new Uint8Array(d as ArrayBuffer));
  }
  close() {
    this.closed = true;
  }
  receive(body: Parameters<typeof create<typeof EnvelopeSchema>>[1]) {
    const bytes = toBinary(EnvelopeSchema, create(EnvelopeSchema, body));
    this.onmessage?.({
      data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
  }
}

function setup(
  pinned: Uint8Array,
  extra: Partial<ConstructorParameters<typeof GatewayConnection>[0]> = {},
) {
  const nodeKey = ed25519.utils.randomSecretKey();
  const sock = new FakeSocket();
  const states: ConnectionState[] = [];
  const bodies: Body[] = [];
  const conn = new GatewayConnection({
    url: 'wss://gw/node',
    nodeId: 'node-1',
    privateKey: nodeKey,
    gatewayPublicKey: pinned,
    appVersion: '1',
    log: new LogBuffer(),
    onState: (s) => states.push(s),
    onBody: (b) => bodies.push(b),
    createSocket: () => sock,
    ...extra,
  });
  return { conn, sock, nodeKey, states, bodies };
}

const sentBody = (s: FakeSocket, i: number) => fromBinary(EnvelopeSchema, s.sent[i]!).body;

describe('GatewayConnection', () => {
  afterEach(() => vi.useRealTimers());

  it('does the mutual handshake against the pinned key, then forwards messages and answers pings', () => {
    const gw = ed25519.utils.randomSecretKey();
    const { conn, sock, nodeKey, states, bodies } = setup(ed25519.getPublicKey(gw));
    conn.start();
    sock.onopen!();
    const hello = sentBody(sock, 0);
    expect(hello?.case).toBe('clientHello');
    const nodeNonce = hello!.case === 'clientHello' ? hello.value.nonce : new Uint8Array();

    const serverNonce = new Uint8Array(32).fill(9);
    sock.receive({
      body: {
        case: 'serverHello',
        value: create(ServerHelloSchema, {
          nonce: serverNonce,
          signature: ed25519.sign(
            signedMessage('splitcortex-gateway-hello-v1', nodeNonce, 'node-1'),
            gw,
          ),
        }),
      },
    });
    const auth = sentBody(sock, 1);
    expect(auth?.case).toBe('clientAuth');
    if (auth?.case === 'clientAuth') {
      const msg = signedMessage('splitcortex-node-hello-v1', serverNonce, nodeNonce, 'node-1');
      expect(ed25519.verify(auth.value.signature, msg, ed25519.getPublicKey(nodeKey))).toBe(true);
    }

    sock.receive({ body: { case: 'ready', value: create(ReadySchema, { maxInFlight: 1 }) } });
    expect(states.at(-1)).toBe('connected');
    expect(bodies[0]?.case).toBe('ready');

    sock.receive({
      body: { case: 'ping', value: { $typeName: 'splitcortex.node.v1.Ping', timestampMs: 5n } },
    });
    expect(sentBody(sock, 2)?.case).toBe('gatewayKeys'); // which gateway keys this device trusts
    expect(sentBody(sock, 3)?.case).toBe('pong');
    conn.stop();
  });

  it('never authenticates to a server that is not the pinned gateway', () => {
    const gw = ed25519.utils.randomSecretKey();
    const impostor = ed25519.utils.randomSecretKey();
    const { conn, sock, states } = setup(ed25519.getPublicKey(gw));
    conn.start();
    sock.onopen!();
    const hello = sentBody(sock, 0);
    const nodeNonce = hello!.case === 'clientHello' ? hello.value.nonce : new Uint8Array();
    sock.receive({
      body: {
        case: 'serverHello',
        value: create(ServerHelloSchema, {
          nonce: new Uint8Array(32),
          signature: ed25519.sign(
            signedMessage('splitcortex-gateway-hello-v1', nodeNonce, 'node-1'),
            impostor,
          ),
        }),
      },
    });
    expect(sock.sent).toHaveLength(1); // only the hello: no ClientAuth was ever sent
    expect(sock.closed).toBe(true);
    expect(states.at(-1)).toBe('reconnecting');
    conn.stop();
  });

  describe('gateway key rotation', () => {
    /** Runs the handshake with `signer` and answers Ready; returns the node nonce the connection used. */
    function connect(
      sock: FakeSocket,
      signer: Uint8Array,
      ready: { nextGatewayKey?: Uint8Array; nextGatewayKeySignature?: Uint8Array } = {},
    ) {
      sock.onopen!();
      const hello = sentBody(sock, 0);
      const nodeNonce = hello!.case === 'clientHello' ? hello.value.nonce : new Uint8Array();
      sock.receive({
        body: {
          case: 'serverHello',
          value: create(ServerHelloSchema, {
            nonce: new Uint8Array(32),
            signature: ed25519.sign(
              signedMessage('splitcortex-gateway-hello-v1', nodeNonce, 'node-1'),
              signer,
            ),
          }),
        },
      });
      sock.receive({ body: { case: 'ready', value: create(ReadySchema, ready) } });
      return nodeNonce;
    }
    const announce = (current: Uint8Array, next: Uint8Array, nonce: Uint8Array) => ({
      nextGatewayKey: ed25519.getPublicKey(next),
      nextGatewayKeySignature: ed25519.sign(
        signedMessage('splitcortex-gateway-next-key-v1', nonce, ed25519.getPublicKey(next)),
        current,
      ),
    });

    it('learns the announced key, reports what it trusts, then switches when the gateway signs with it', () => {
      const oldKey = ed25519.utils.randomSecretKey();
      const newKey = ed25519.utils.randomSecretKey();
      const onGatewayKeys = vi.fn();
      const first = setup(ed25519.getPublicKey(oldKey), { onGatewayKeys });
      first.conn.start();
      // the announcement is signed over this connection's nonce, so it is built from the hello
      first.sock.onopen!();
      const hello = sentBody(first.sock, 0);
      const nonce = hello!.case === 'clientHello' ? hello.value.nonce : new Uint8Array();
      first.sock.receive({
        body: {
          case: 'serverHello',
          value: create(ServerHelloSchema, {
            nonce: new Uint8Array(32),
            signature: ed25519.sign(
              signedMessage('splitcortex-gateway-hello-v1', nonce, 'node-1'),
              oldKey,
            ),
          }),
        },
      });
      first.sock.receive({
        body: { case: 'ready', value: create(ReadySchema, announce(oldKey, newKey, nonce)) },
      });
      expect(onGatewayKeys).toHaveBeenLastCalledWith({
        current: ed25519.getPublicKey(oldKey),
        next: [ed25519.getPublicKey(newKey)],
      });
      const keys = sentBody(first.sock, 2);
      expect(keys?.case === 'gatewayKeys' && keys.value.keyIds).toEqual([
        gatewayKeyId(ed25519.getPublicKey(oldKey)),
        gatewayKeyId(ed25519.getPublicKey(newKey)),
      ]);
      first.conn.stop();

      // later the gateway signs with the new key: accepted, and it becomes the current one
      const onKeys2 = vi.fn();
      const second = setup(ed25519.getPublicKey(oldKey), {
        nextGatewayKeys: [ed25519.getPublicKey(newKey)],
        onGatewayKeys: onKeys2,
      });
      second.conn.start();
      connect(second.sock, newKey);
      expect(second.states.at(-1)).toBe('connected');
      expect(onKeys2).toHaveBeenLastCalledWith({ current: ed25519.getPublicKey(newKey), next: [] });
      second.conn.stop();
    });

    it('ignores an announcement that the trusted key did not sign, and refuses an unknown key', () => {
      const gw = ed25519.utils.randomSecretKey();
      const impostor = ed25519.utils.randomSecretKey();
      const onGatewayKeys = vi.fn();
      const { conn, sock } = setup(ed25519.getPublicKey(gw), { onGatewayKeys });
      conn.start();
      connect(sock, gw, announce(impostor, ed25519.utils.randomSecretKey(), new Uint8Array(32)));
      expect(onGatewayKeys).not.toHaveBeenCalled();
      conn.stop();

      const other = setup(ed25519.getPublicKey(gw), { onGatewayKeys });
      other.conn.start();
      connect(other.sock, impostor);
      expect(other.states.at(-1)).not.toBe('connected');
      other.conn.stop();
    });
  });
});
