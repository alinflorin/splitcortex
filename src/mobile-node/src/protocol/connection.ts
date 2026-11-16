import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { randomBytes } from '../enrollment/random';
import type { LogBuffer } from '../runtime/log';
import { gatewayKeyId, signNodeHello, verifyGatewayHello, verifyNextGatewayKey } from './handshake';
import {
  ClientAuthSchema,
  ClientHelloSchema,
  EnvelopeSchema,
  GatewayKeysSchema,
  PongSchema,
  type Envelope,
} from './gen/splitcortex/node/v1/node_pb';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting';
export type Body = NonNullable<Envelope['body']>;

export const PROTOCOL_VERSION = 1;
const IDLE_LIMIT_MS = 60_000;
const BACKOFF_MAX_MS = 30_000;

/** The subset of the WebSocket API used (so tests can inject a fake). */
export interface SocketLike {
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: ArrayBuffer | Uint8Array): void;
  close(): void;
}

export interface ConnectionOptions {
  url: string;
  nodeId: string;
  privateKey: Uint8Array;
  /** The gateway key pinned at enrollment. The gateway must prove it before the node reveals anything. */
  gatewayPublicKey: Uint8Array;
  /** Keys announced for a gateway key rotation (trusted too, see `onGatewayKeys`). */
  nextGatewayKeys?: Uint8Array[];
  /**
   * The trusted keys changed: the gateway proved a next key (and `current` moved to it), or announced a new next key.
   * Persist them so a restart keeps trusting them.
   */
  onGatewayKeys?: (keys: { current: Uint8Array; next: Uint8Array[] }) => void;
  appVersion: string;
  log: LogBuffer;
  onState: (s: ConnectionState) => void;
  onBody: (b: Body) => void;
  createSocket?: (url: string) => SocketLike;
}

type Stage = 'hello' | 'auth' | 'open';

/**
 * The node's outbound, persistent connection to the gateway: wss + protobuf, mutual proof of possession (see
 * `proto/.../node.proto`), reconnect with backoff, idle watchdog. It never accepts inbound connections.
 */
export class GatewayConnection {
  private ws: SocketLike | null = null;
  private stopped = true;
  private attempt = 0;
  private stage: Stage = 'hello';
  private nonce: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private retry: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private lastSeen = 0;
  private current: Uint8Array;
  private next: Uint8Array[];
  private verifiedWith: Uint8Array | null = null;

  constructor(private readonly o: ConnectionOptions) {
    this.current = o.gatewayPublicKey;
    this.next = o.nextGatewayKeys ?? [];
  }

  /** Reconnect now instead of waiting for the backoff (the app came back to the foreground, the network changed). */
  reconnectNow() {
    if (this.stopped || !this.retry) return;
    clearTimeout(this.retry);
    this.retry = null;
    this.attempt = 0;
    this.open();
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.open();
  }

  stop() {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.watchdog) clearInterval(this.watchdog);
    this.retry = this.watchdog = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = ws.onerror = ws.onmessage = ws.onopen = null;
      ws.close();
    }
    this.o.onState('idle');
  }

  send(body: Body) {
    if (this.stage !== 'open' || !this.ws) return false;
    this.ws.send(toBinary(EnvelopeSchema, create(EnvelopeSchema, { body })));
    return true;
  }

  private open() {
    this.o.onState(this.attempt === 0 ? 'connecting' : 'reconnecting');
    this.stage = 'hello';
    const ws = this.o.createSocket
      ? this.o.createSocket(this.o.url)
      : (new WebSocket(this.o.url) as SocketLike);
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      this.nonce = new Uint8Array(randomBytes(32));
      this.raw({
        case: 'clientHello',
        value: create(ClientHelloSchema, {
          protocolVersion: PROTOCOL_VERSION,
          nodeId: this.o.nodeId,
          nonce: this.nonce,
          appVersion: this.o.appVersion,
        }),
      });
    };
    ws.onmessage = (e) => this.onMessage(e.data);
    ws.onclose = ws.onerror = () => this.closed(ws);
  }

  private raw(body: Body) {
    this.ws?.send(toBinary(EnvelopeSchema, create(EnvelopeSchema, { body })));
  }

  private onMessage(data: unknown) {
    if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) return;
    let env: Envelope;
    try {
      env = fromBinary(EnvelopeSchema, new Uint8Array(data as ArrayBuffer));
    } catch {
      return this.fail('The gateway sent an invalid frame');
    }
    this.lastSeen = Date.now();
    const body = env.body;
    if (!body) return;
    if (this.stage === 'hello') {
      if (body.case !== 'serverHello') return this.fail('Unexpected handshake message');
      const { nonce, signature } = body.value;
      this.verifiedWith =
        [this.current, ...this.next].find((k) =>
          verifyGatewayHello(k, this.nonce, this.o.nodeId, signature),
        ) ?? null;
      if (!this.verifiedWith) {
        // Not the gateway this device pinned at enrollment: never authenticate to it.
        return this.fail(
          'The server does not match the key pinned at enrollment; refusing to connect',
          true,
        );
      }
      this.stage = 'auth';
      this.raw({
        case: 'clientAuth',
        value: create(ClientAuthSchema, {
          signature: signNodeHello(this.o.privateKey, nonce, this.nonce, this.o.nodeId),
        }),
      });
      return;
    }
    if (this.stage === 'auth') {
      if (body.case !== 'ready') return this.fail('The gateway did not accept this device');
      this.stage = 'open';
      this.attempt = 0;
      this.acceptKeys(body.value);
      this.o.onState('connected');
      this.lastSeen = Date.now();
      this.watchdog = setInterval(() => {
        if (Date.now() - this.lastSeen > IDLE_LIMIT_MS) this.fail('The gateway went silent');
      }, 10_000);
      this.send({
        case: 'gatewayKeys',
        value: create(GatewayKeysSchema, {
          keyIds: [this.current, ...this.next].map(gatewayKeyId),
        }),
      });
      this.o.onBody(body);
      return;
    }
    if (body.case === 'ping') {
      this.send({
        case: 'pong',
        value: create(PongSchema, { timestampMs: body.value.timestampMs }),
      });
      return;
    }
    this.o.onBody(body);
  }

  /** Key rotation: switch to the key the gateway just proved, and learn the next one it announces. */
  private acceptKeys(ready: { nextGatewayKey: Uint8Array; nextGatewayKeySignature: Uint8Array }) {
    const proven = this.verifiedWith;
    if (!proven) return;
    const same = (a: Uint8Array, b: Uint8Array) =>
      a.length === b.length && a.every((v, i) => v === b[i]);
    let changed = false;
    if (!same(proven, this.current)) {
      // The gateway now signs with what it announced earlier: that is the current key from here on, the old one is retired.
      this.current = proven;
      this.next = [];
      changed = true;
    }
    const announced = ready.nextGatewayKey;
    if (
      announced.length === 32 &&
      !same(announced, this.current) &&
      !this.next.some((k) => same(k, announced)) &&
      verifyNextGatewayKey(proven, this.nonce, announced, ready.nextGatewayKeySignature)
    ) {
      this.next = [announced];
      changed = true;
    }
    if (changed) {
      this.o.log.info('Gateway key rotation: trusted keys updated');
      this.o.onGatewayKeys?.({ current: this.current, next: this.next });
    }
  }

  private fail(reason: string, permanentish = false) {
    this.o.log.warn(reason);
    if (permanentish) this.attempt = Math.max(this.attempt, 5); // back off hard, it will not fix itself quickly
    const ws = this.ws;
    if (ws) this.closed(ws);
  }

  private closed(ws: SocketLike) {
    if (ws !== this.ws) return;
    ws.onclose = ws.onerror = ws.onmessage = ws.onopen = null;
    try {
      ws.close();
    } catch {
      /* already closed */
    }
    this.ws = null;
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    if (this.stopped) return;
    const delay = Math.min(BACKOFF_MAX_MS, 1000 * 2 ** this.attempt) * (0.7 + Math.random() * 0.6);
    this.attempt += 1;
    this.o.onState('reconnecting');
    this.o.log.info(`Disconnected, retrying in ${Math.round(delay / 1000)} s`);
    this.retry = setTimeout(() => this.open(), delay);
  }
}
