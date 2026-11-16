import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { ed25519 } from '@noble/curves/ed25519.js';
import { LogBuffer } from '../runtime/log';
import { GatewayConnection, type Body, type ConnectionState, type SocketLike } from './connection';
import { signedMessage } from './handshake';
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

function setup(pinned: Uint8Array) {
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
  });
  return { conn, sock, nodeKey, states, bodies };
}

const sentBody = (s: FakeSocket, i: number) => fromBinary(EnvelopeSchema, s.sent[i]!).body;

describe('GatewayConnection', () => {
  afterEach(() => jest.useRealTimers());

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
    expect(sentBody(sock, 2)?.case).toBe('pong');
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
});
