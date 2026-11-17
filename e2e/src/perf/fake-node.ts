import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { cpace } from '@cipherman/pake-js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from 'node:crypto';
import {
  ClientAuthSchema,
  ClientHelloSchema,
  EnvelopeSchema,
  InferenceChunkSchema,
  InferenceDoneSchema,
  ModelPhase,
  ModelStateSchema,
  PongSchema,
  ResumeSchema,
  TelemetrySchema,
  type Envelope,
  type InferenceRequest,
} from './gen/splitcortex/node/v1/node_pb.ts';

// A simulated node: enrolls through the control plane and serves over the real wss + protobuf protocol, but its
// "engine" is a timer that emits N pieces at a fixed interval. It never downloads the model. The crypto and the
// handshake are copies of the web node's (src/web-node/src/enrollment/crypto.ts, protocol/handshake.ts), so a fix
// in the protocol has to be made here too.

const enc = new TextEncoder();
const CHANNEL = enc.encode('splitcortex-enroll-v1');
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

function signedMessage(label: string, ...parts: (Uint8Array | string)[]): Uint8Array {
  const chunks: Uint8Array[] = [enc.encode(label)];
  for (const p of parts) chunks.push(enc.encode('\n'), typeof p === 'string' ? enc.encode(p) : p);
  return Buffer.concat(chunks);
}

const key = (isk: Uint8Array, sid: Uint8Array, label: string) =>
  hkdf(sha256, isk, sid, enc.encode(`splitcortex-enroll-v1 ${label}`), 32);

async function post(baseUrl: string, path: string, body: object): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

export interface Enrolled {
  nodeId: string;
  privateKey: Uint8Array;
  gatewayKey: Uint8Array;
  gatewayUrl: string;
}

/** Enrolls a new device with `code` (`XXXX-XXXXXX`) against the control plane at `apiUrl` (ends in `/api`). */
export async function enrollDevice(apiUrl: string, code: string, name: string): Promise<Enrolled> {
  const c = code.toUpperCase().replace(/[\s-]/g, '');
  const lookupId = c.slice(0, 4);
  const secret = c.slice(4);
  const privateKey = randomBytes(32);
  const publicKey = ed25519.getPublicKey(privateKey);
  const sid = randomBytes(16);
  const me = cpace.ristretto255.init({
    PRS: enc.encode(`splitcortex-enroll-v1:${secret}`),
    sid,
    CI: CHANNEL,
  });
  const started = await post(apiUrl, '/enroll/start', {
    lookupId,
    sid: b64(sid),
    share: b64(me.share),
  });
  const isk = cpace.ristretto255.deriveIskInitiatorResponder({
    ephemeralSecret: me.ephemeralSecret,
    ownShare: me.share,
    peerShare: unb64(started.share as string),
    ownAD: enc.encode('device'),
    peerAD: enc.encode('server'),
    sid,
    role: 'initiator',
  });
  const pop = ed25519.sign(Buffer.concat([CHANNEL, sid]), privateKey);
  const request = { publicKey: b64(publicKey), signature: b64(pop), name, platform: 'perf-sim' };
  const nonce = randomBytes(12);
  const ct = chacha20poly1305(key(isk, sid, 'request'), nonce).encrypt(
    enc.encode(JSON.stringify(request)),
  );
  const completed = await post(apiUrl, '/enroll/complete', {
    lookupId,
    sealed: b64(Buffer.concat([nonce, ct])),
  });
  const sealed = unb64(completed.sealed as string);
  const plain = chacha20poly1305(key(isk, sid, 'response'), sealed.subarray(0, 12)).decrypt(
    sealed.subarray(12),
  );
  const r = JSON.parse(new TextDecoder().decode(plain)) as {
    nodeId: string;
    gateway: { publicKey: string; url: string } | null;
  };
  if (!r.gateway) throw new Error('The platform has no gateway identity configured');
  return {
    nodeId: r.nodeId,
    privateKey,
    gatewayKey: unb64(r.gateway.publicKey),
    gatewayUrl: r.gateway.url,
  };
}

export interface SimOptions {
  /** Pause between two pieces, ms (a phone does ~5-30 tokens/s: 30-200 ms). */
  tokenIntervalMs: number;
  /** Time before the first piece (prompt processing), ms. */
  firstTokenDelayMs: number;
  /** Pieces per answer when the request sets no max_tokens. */
  defaultTokens: number;
}
export const DEFAULT_SIM: SimOptions = {
  tokenIntervalMs: 20,
  firstTokenDelayMs: 50,
  defaultTokens: 32,
};

type Body = NonNullable<Envelope['body']>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SimNode {
  connected: Promise<void>;
  /** Requests served to the end, and the pieces they carried (the numbers the metering must agree with). */
  served = 0;
  pieces = 0;
  private ws: WebSocket;
  private nonce = randomBytes(32);
  private stage: 'hello' | 'auth' | 'open' = 'hello';
  private modelId = '';
  private cancelled = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private onUp!: () => void;
  private onFail!: (e: Error) => void;
  /** Called when the socket closes (dropped by the gateway, killed, or stopped). */
  onClose: () => void = () => {};

  constructor(
    private readonly e: Enrolled,
    private readonly sim: SimOptions = DEFAULT_SIM,
  ) {
    this.connected = new Promise((res, rej) => {
      this.onUp = res;
      this.onFail = rej;
    });
    this.connected.catch(() => {});
    this.ws = new WebSocket(e.gatewayUrl);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = () =>
      this.raw({
        case: 'clientHello',
        value: create(ClientHelloSchema, {
          protocolVersion: 1,
          nodeId: e.nodeId,
          nonce: this.nonce,
          appVersion: 'perf-sim',
        }),
      });
    this.ws.onmessage = (m) => this.onMessage(new Uint8Array(m.data as ArrayBuffer));
    this.ws.onerror = () => this.onFail(new Error('node socket error'));
    this.ws.onclose = () => {
      this.onFail(new Error('node socket closed'));
      if (this.timer) clearInterval(this.timer);
      this.onClose();
    };
  }

  /** Drops the connection without a goodbye (a phone losing the network). */
  kill() {
    this.ws.close();
  }

  private raw(body: Body) {
    if (this.ws.readyState === WebSocket.OPEN)
      this.ws.send(toBinary(EnvelopeSchema, create(EnvelopeSchema, { body })));
  }

  private onMessage(data: Uint8Array) {
    const body = fromBinary(EnvelopeSchema, data).body;
    if (!body) return;
    if (this.stage === 'hello') {
      if (body.case !== 'serverHello') return this.fail('unexpected handshake message');
      const ok = ed25519.verify(
        body.value.signature,
        signedMessage('splitcortex-gateway-hello-v1', this.nonce, this.e.nodeId),
        this.e.gatewayKey,
      );
      if (!ok) return this.fail('gateway key mismatch');
      this.stage = 'auth';
      const sig = ed25519.sign(
        signedMessage('splitcortex-node-hello-v1', body.value.nonce, this.nonce, this.e.nodeId),
        this.e.privateKey,
      );
      this.raw({ case: 'clientAuth', value: create(ClientAuthSchema, { signature: sig }) });
      return;
    }
    if (this.stage === 'auth') {
      if (body.case !== 'ready') return this.fail('gateway did not accept the device');
      this.stage = 'open';
      this.raw({ case: 'resume', value: create(ResumeSchema, { requestIds: [] }) });
      this.onUp();
      this.telemetry();
      this.timer = setInterval(() => this.telemetry(), 10_000);
      return;
    }
    switch (body.case) {
      case 'ping':
        this.raw({
          case: 'pong',
          value: create(PongSchema, { timestampMs: body.value.timestampMs }),
        });
        break;
      case 'modelAssignment':
        this.modelId = body.value.modelId;
        if (this.modelId) this.modelState(ModelPhase.READY);
        break;
      case 'inferenceRequest':
        void this.serve(body.value);
        break;
      case 'cancel':
        this.cancelled.add(body.value.requestId);
        break;
      default:
        break;
    }
  }

  private modelState(phase: ModelPhase) {
    this.raw({
      case: 'modelState',
      value: create(ModelStateSchema, { modelId: this.modelId, phase }),
    });
  }

  private telemetry() {
    this.raw({
      case: 'telemetry',
      value: create(TelemetrySchema, {
        cpuPercent: 10,
        memoryUsedMb: 300,
        batteryPercent: -1,
        temperatureC: -100,
        tokensPerSec: 1000 / this.sim.tokenIntervalMs,
        backend: 'cpu',
        maxContextTokens: 4096,
      }),
    });
  }

  private fail(reason: string) {
    this.onFail(new Error(reason));
    this.ws.close();
  }

  private async serve(req: InferenceRequest) {
    const id = req.requestId;
    const total = req.maxTokens > 0 ? req.maxTokens : this.sim.defaultTokens;
    let seq = 0;
    await sleep(this.sim.firstTokenDelayMs);
    let sent = 0;
    for (; sent < total; sent++) {
      if (this.cancelled.delete(id) || this.ws.readyState !== WebSocket.OPEN) return;
      this.raw({
        case: 'inferenceChunk',
        value: create(InferenceChunkSchema, { requestId: id, text: 'tok ', seq: ++seq }),
      });
      await sleep(this.sim.tokenIntervalMs);
    }
    const promptTokens = req.messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0);
    this.raw({
      case: 'inferenceDone',
      value: create(InferenceDoneSchema, {
        requestId: id,
        promptTokens,
        completionTokens: sent,
        finishReason: 'length',
        seq: ++seq,
      }),
    });
    this.served += 1;
    this.pieces += sent;
  }
}
