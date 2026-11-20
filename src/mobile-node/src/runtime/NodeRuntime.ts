import { create } from '@bufbuild/protobuf';
import { AppState } from 'react-native';
import Constants from 'expo-constants';
import { fromB64, toB64 } from '../enrollment/crypto';
import { getOrCreateIdentity } from '../enrollment/identity';
import { loadEnrollment, saveEnrollment } from '../enrollment/store';
import { toChatMessage } from '../engine/messages';
import { embedAll, EmbeddingRequestError } from '../engine/embedding';
import { LiteRtEmbedder } from '../engine/litertEmbedder';
import type { ComputePrefs, Embedder, TunableEngine } from '../engine/types';
import {
  nodeService,
  UNKNOWN_TELEMETRY,
  type DeviceTelemetry,
  type ServiceControl,
} from '../native/nodeService';
import { ModelManager, NO_MODEL, type ModelStatus } from '../models/manager';
import { GatewayConnection, type Body, type ConnectionState } from '../protocol/connection';
import {
  EmbeddingResultSchema,
  EmbeddingSchema,
  InferenceChunkSchema,
  InferenceDoneSchema,
  InferenceErrorSchema,
  ModelPhase,
  ModelStateSchema,
  type NodeConfig,
  ResumeSchema,
  type ResumeAck,
  TelemetrySchema,
  type EmbeddingRequest,
  type InferenceRequest,
  type Restart,
} from '../protocol/gen/splitcortex/node/v1/node_pb';
import { LogBuffer } from './log';
import { computePrefs, loadSettings, type NodeSettings } from './settings';

export interface RuntimeState {
  /** The service is switched on (it may still be waiting for the network). */
  running: boolean;
  connection: ConnectionState;
  model: ModelStatus;
  inFlight: number;
  /** A restart was asked for: new requests are refused while the running ones finish. */
  restarting: boolean;
  requestsServed: number;
  tokensServed: number;
  tokensPerSec: number;
  /** What the engine runs on and its context window (null / 0 while no model is loaded). */
  backend: 'cpu' | 'gpu' | null;
  maxContextTokens: number;
  /** Why it cannot run (not enrolled, waiting for approval, no gateway pinned). */
  blocked: 'not-enrolled' | 'not-approved' | 'no-gateway' | null;
}

const INITIAL: RuntimeState = {
  running: false,
  connection: 'idle',
  model: NO_MODEL,
  inFlight: 0,
  restarting: false,
  requestsServed: 0,
  tokensServed: 0,
  tokensPerSec: 0,
  backend: null,
  maxContextTokens: 0,
  blocked: null,
};

const PHASE: Record<ModelStatus['phase'], ModelPhase> = {
  none: ModelPhase.NONE,
  downloading: ModelPhase.DOWNLOADING,
  loading: ModelPhase.LOADING,
  ready: ModelPhase.READY,
  failed: ModelPhase.FAILED,
};

/** The grace period of a `Restart`: what the gateway asks for, at most 1 h (a request never runs longer). */
const restartGrace = (r: Restart) => Math.min(Math.max(r.graceSeconds, 0), 3600);

/**
 * A request the gateway may need to hear again after a dropped connection: everything sent for it carries a sequence
 * number and is kept until the request is long finished, so a reconnect can resend what the gateway missed.
 */
interface Outbox {
  seq: number;
  frames: { seq: number; body: Body }[];
  finishedAt: number | null;
}
/** More than this many frames per request are not retained (a resume of such a request cannot be completed). */
const OUTBOX_FRAMES = 20_000;
/** A finished request stays resumable this long. */
const OUTBOX_KEEP_MS = 60_000;
/** If the gateway has been unreachable this long, running requests are given up (the gateway fails them after 20 s). */
const OFFLINE_ABORT_MS = 40_000;

/**
 * The node's service: owns the gateway connection, the model on disk and the engine, and serves inference requests
 * one at a time. UI reads it with `useSyncExternalStore` (`subscribe`/`getSnapshot`). Start/stop/restart are
 * idempotent. Requests and answers are never logged, only counts.
 */
export class NodeRuntime {
  readonly log = new LogBuffer();
  private state = INITIAL;
  private listeners = new Set<() => void>();
  private conn: GatewayConnection | null = null;
  private models: ModelManager | null = null;
  private telemetry: ReturnType<typeof setInterval> | null = null;
  private active = new Map<string, AbortController>();
  private outbox = new Map<string, Outbox>();
  private offlineTimer: ReturnType<typeof setTimeout> | null = null;
  private screen: { local: boolean; admin: boolean | undefined } = {
    local: false,
    admin: undefined,
  };
  private appStateSub: { remove(): void } | null = null;
  /** Waiting for the running requests to finish before a restart (resolved by `settle`). */
  private drained: (() => void) | null = null;
  private embedChain: Promise<void> = Promise.resolve();
  private generation = 0; // guards async start() against a stop()/restart() that happened meanwhile

  constructor(
    private readonly engine: TunableEngine,
    private readonly service: ServiceControl = nodeService,
    private readonly readTelemetry: () => Promise<DeviceTelemetry> = () => nodeService.telemetry(),
    private readonly readSettings: () => Promise<NodeSettings> = loadSettings,
    private readonly embedder: Embedder = new LiteRtEmbedder(),
  ) {
    engine.onLog = (m) => this.log.info(m);
  }

  getSnapshot = () => this.state;
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
  private set(patch: Partial<RuntimeState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  async start() {
    if (this.state.running) return;
    await this.boot();
  }

  private async boot() {
    const gen = ++this.generation;
    this.set({ running: true, blocked: null });
    const enrollment = await loadEnrollment();
    if (gen !== this.generation) return;
    if (!enrollment) return this.block('not-enrolled', 'Not enrolled: nothing to start');
    if (!enrollment.approved)
      return this.block('not-approved', 'Waiting for an admin to approve this device');
    if (!enrollment.gateway)
      return this.block('no-gateway', 'The platform has not given this device a gateway yet');
    const identity = await getOrCreateIdentity();
    if (gen !== this.generation) return;
    const settings = await this.readSettings();
    await this.engine.setPrefs('local', computePrefs(settings));
    this.setLocalScreen(settings.keepScreenOn);
    if (gen !== this.generation) return;

    let pinned = enrollment.gateway;
    this.models = new ModelManager({
      engine: this.engine,
      embedder: this.embedder,
      log: this.log,
      baseUrl: enrollment.enrollmentUrl,
      nodeId: enrollment.nodeId,
      privateKey: identity.privateKey,
      onStatus: (model) => {
        this.set({ model });
        this.reportModel(model);
        if (model.phase === 'ready') this.reportCompute();
      },
    });
    this.conn = new GatewayConnection({
      url: enrollment.gateway.url,
      nodeId: enrollment.nodeId,
      privateKey: identity.privateKey,
      gatewayPublicKey: fromB64(pinned.publicKey),
      nextGatewayKeys: (pinned.nextKeys ?? []).map(fromB64),
      onGatewayKeys: (k) => {
        // Gateway key rotation: remember what the gateway proved (the old key is retired once it is replaced).
        pinned = { ...pinned, publicKey: toB64(k.current), nextKeys: k.next.map(toB64) };
        void saveEnrollment({ ...enrollment, gateway: pinned });
      },
      appVersion: Constants.expoConfig?.version ?? '0',
      log: this.log,
      onState: (connection) => {
        if (connection !== this.state.connection) this.log.info(`Connection: ${connection}`);
        this.set({ connection });
        this.watchOffline(connection);
      },
      onBody: (b) => this.onBody(b),
    });
    this.log.info('Starting');
    // Keeps the process (and this connection) alive in the background. Best effort: serving works without it while the app is open.
    this.service
      .start()
      .catch((e) =>
        this.log.warn(
          `Background service did not start: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    this.conn.start();
    // Coming back to the foreground is a good moment to retry at once instead of waiting out the backoff.
    this.appStateSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        this.conn?.reconnectNow();
        this.applyScreen();
      }
    });
    this.telemetry = setInterval(() => void this.sendTelemetry(), 10_000);
  }

  private block(blocked: NonNullable<RuntimeState['blocked']>, message: string) {
    this.log.warn(message);
    this.set({ running: false, blocked });
  }

  async stop() {
    await this.teardown(true);
    this.set({ ...INITIAL, blocked: null });
    this.log.info('Stopped');
  }

  /** Closes the connection, drops running work and frees both engines; the background service only when asked. */
  private async teardown(stopService: boolean) {
    this.generation++;
    this.conn?.stop();
    this.models?.stop();
    if (this.telemetry) clearInterval(this.telemetry);
    this.telemetry = null;
    this.appStateSub?.remove();
    this.appStateSub = null;
    void this.service.setKeepScreenOn?.(false);
    if (this.offlineTimer) clearTimeout(this.offlineTimer);
    this.offlineTimer = null;
    this.active.forEach((c) => c.abort());
    this.active.clear();
    this.outbox.clear();
    await this.engine.unload();
    await this.embedder.unload();
    if (stopService) await this.service.stop().catch(() => undefined);
    this.conn = null;
    this.models = null;
  }

  /**
   * "Restart" asked from the web app. On a phone there is no process restart without extra native code, so this is an
   * app-level restart: stop taking requests (they get `restarting`), let the running ones finish for up to
   * `graceSeconds` (then cancel them), close the socket, free the engines, then start again from scratch (reload the
   * model, reconnect, resume). The foreground service and `running` stay on throughout, so the headless task lives on.
   */
  private async remoteRestart(graceSeconds: number) {
    if (this.state.restarting || !this.state.running) return;
    this.log.info(`Restart requested by an admin (grace ${graceSeconds} s)`);
    this.set({ restarting: true });
    const gen = this.generation;
    if (this.active.size > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.log.warn('Restart: grace period over, cancelling the running requests');
          resolve();
        }, graceSeconds * 1000);
        this.drained = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.drained = null;
    }
    // A stop() or a local restart happened while waiting: nothing left to restart.
    if (gen !== this.generation) return;
    await this.teardown(false);
    this.set({
      ...INITIAL,
      running: true,
      restarting: true,
      requestsServed: this.state.requestsServed,
      tokensServed: this.state.tokensServed,
    });
    await this.boot();
    this.set({ restarting: false });
    this.log.info('Restarted');
  }

  /** A request finished: wakes a pending restart once nothing is left running. */
  private settle() {
    if (this.active.size === 0) this.drained?.();
  }

  async restart() {
    this.log.info('Restarting');
    await this.stop();
    await this.start();
  }

  private onBody(b: Body) {
    switch (b.case) {
      case 'ready':
        this.log.info('Connected to the gateway');
        // List the requests this node still holds: the gateway tells which it still tracks and what it missed.
        this.conn?.send({
          case: 'resume',
          value: create(ResumeSchema, { requestIds: [...this.outbox.keys()] }),
        });
        break;
      case 'resumeAck':
        this.resend(b.value);
        break;
      case 'modelAssignment': {
        const a = b.value;
        void this.models?.apply({
          modelId: a.modelId,
          name: a.name,
          fileName: a.fileName,
          sizeBytes: Number(a.sizeBytes),
          sha256: a.sha256,
          kind: a.kind,
        });
        break;
      }
      case 'nodeConfig':
        void this.applyAdminConfig(b.value);
        break;
      case 'inferenceRequest':
        void this.serve(b.value);
        break;
      case 'embeddingRequest':
        void this.serveEmbedding(b.value);
        break;
      case 'restart':
        void this.remoteRestart(restartGrace(b.value));
        break;
      case 'cancel':
        this.active.get(b.value.requestId)?.abort();
        this.outbox.delete(b.value.requestId);
        break;
      default:
        break;
    }
  }

  /** Sends a numbered frame for a request and keeps it so a reconnect can resend it. */
  private emit(id: string, make: (seq: number) => Body) {
    const box = this.outbox.get(id);
    if (!box) return; // cancelled or given up
    const seq = ++box.seq;
    const body = make(seq);
    if (box.frames.length < OUTBOX_FRAMES) box.frames.push({ seq, body });
    this.conn?.send(body); // false while disconnected: it is resent on resume
  }

  /** The gateway's answer to `Resume`: resend what it missed. Requests it did not list are no longer wanted. */
  private resend(ack: ResumeAck) {
    const wanted = new Map(ack.entries.map((e) => [e.requestId, e.receivedSeq]));
    for (const [id, box] of this.outbox) {
      const received = wanted.get(id);
      if (received === undefined) {
        this.active.get(id)?.abort();
        this.outbox.delete(id);
        continue;
      }
      const missed = box.frames.filter((f) => f.seq > received);
      this.log.info(`Resumed a request: resending ${missed.length} message(s)`);
      for (const f of missed) this.conn?.send(f.body);
    }
  }

  /** No connection for too long while generating: the gateway gave the requests up, so stop wasting the battery. */
  private watchOffline(state: ConnectionState) {
    if (state === 'connected') {
      if (this.offlineTimer) clearTimeout(this.offlineTimer);
      this.offlineTimer = null;
    } else if (!this.offlineTimer && this.active.size > 0) {
      this.offlineTimer = setTimeout(() => {
        this.offlineTimer = null;
        this.log.warn('The gateway stayed unreachable: giving up the running request');
        this.active.forEach((c) => c.abort());
        this.outbox.clear();
      }, OFFLINE_ABORT_MS);
    }
  }

  /** The app's own compute settings changed (settings screen). The admin override, if any, still wins. */
  setLocalCompute(prefs: ComputePrefs) {
    void this.engine
      .setPrefs('local', prefs)
      .then(() => this.reportCompute())
      .catch((e) =>
        this.log.error(`Engine reload failed: ${e instanceof Error ? e.message : String(e)}`),
      );
  }

  /** The app's own "keep the screen on" setting changed. The admin override, if any, wins. */
  setLocalScreen(on: boolean) {
    this.screen.local = on;
    this.applyScreen();
  }

  private applyScreen() {
    const on = this.screen.admin ?? this.screen.local;
    void this.service.setKeepScreenOn?.(on);
  }

  /** Overrides from the web app (through the gateway): empty fields mean "no override". */
  private async applyAdminConfig(c: NodeConfig) {
    this.screen.admin =
      c.keepScreenOn === 'on' ? true : c.keepScreenOn === 'off' ? false : undefined;
    this.applyScreen();
    const backend = c.backend === 'cpu' || c.backend === 'gpu' ? c.backend : undefined;
    const maxContextTokens = c.maxContextTokens > 0 ? c.maxContextTokens : undefined;
    const enableMtp = c.enableMtp === 'on' ? true : c.enableMtp === 'off' ? false : undefined;
    this.log.info(
      `Admin settings: backend ${backend ?? 'not set'}, context ${maxContextTokens ?? 'not set'}, screen ${c.keepScreenOn || 'not set'}, MTP ${c.enableMtp || 'not set'}`,
    );
    try {
      await this.engine.setPrefs('admin', { backend, maxContextTokens, enableMtp });
    } catch (e) {
      this.log.error(`Engine reload failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.reportCompute();
  }

  /** Publishes what the engine runs on (UI state, and the gateway through telemetry right away: it routes by context size). */
  private reportCompute() {
    this.set({ backend: this.engine.backend, maxContextTokens: this.engine.maxContextTokens });
    void this.sendTelemetry();
  }

  private reportModel(m: ModelStatus) {
    this.conn?.send({
      case: 'modelState',
      value: create(ModelStateSchema, {
        modelId: m.modelId,
        phase: PHASE[m.phase],
        progressBytes: BigInt(Math.round(m.progressBytes)),
        error: m.error ?? '',
        // What the loaded model accepts besides text; the gateway routes media only to nodes that list it.
        modalities:
          m.phase === 'ready' && m.kind !== 'embedding' ? [...this.engine.modalities] : [],
        embeddingDimension:
          m.phase === 'ready' && m.kind === 'embedding' ? (m.embeddingDimension ?? 0) : 0,
      }),
    });
  }

  private async serve(req: InferenceRequest) {
    const id = req.requestId;
    this.outbox.set(id, { seq: 0, frames: [], finishedAt: null });
    const fail = (code: string, message: string) =>
      this.emit(id, (seq) => ({
        case: 'inferenceError',
        value: create(InferenceErrorSchema, { requestId: id, code, message, seq }),
      }));
    if (this.state.restarting)
      return this.finishBox(id, () => fail('restarting', 'The node is restarting'));
    if (this.state.model.kind === 'embedding')
      return this.finishBox(id, () =>
        fail('wrong_model_kind', 'This node serves an embedding model, not a chat model'),
      );
    if (this.state.inFlight > 0)
      return this.finishBox(id, () => fail('busy', 'The node is already generating'));
    if (req.modelId !== this.state.model.modelId || this.state.model.phase !== 'ready') {
      return this.finishBox(id, () => fail('model_not_ready', 'The requested model is not loaded'));
    }
    const ctl = new AbortController();
    this.active.set(id, ctl);
    this.set({ inFlight: 1 });
    const started = Date.now();
    let pieces = 0;
    try {
      const result = await this.engine.generate(
        {
          messages: req.messages.map(toChatMessage),
          maxTokens: req.maxTokens,
          temperature: req.temperature,
          topP: req.topP,
        },
        (text) => {
          pieces += 1;
          this.emit(id, (seq) => ({
            case: 'inferenceChunk',
            value: create(InferenceChunkSchema, { requestId: id, text, seq }),
          }));
        },
        ctl.signal,
      );
      if (!ctl.signal.aborted) {
        this.emit(id, (seq) => ({
          case: 'inferenceDone',
          value: create(InferenceDoneSchema, {
            requestId: id,
            completionTokens: pieces,
            finishReason: result.finishReason,
            seq,
          }),
        }));
      }
      const secs = Math.max((Date.now() - started) / 1000, 0.001);
      this.set({
        requestsServed: this.state.requestsServed + 1,
        tokensServed: this.state.tokensServed + pieces,
        tokensPerSec: pieces > 0 ? pieces / secs : this.state.tokensPerSec,
      });
      this.log.info(
        `Request served: ${pieces} tokens in ${secs.toFixed(1)} s${ctl.signal.aborted ? ' (cancelled)' : ''}`,
      );
    } catch (e) {
      this.log.error(`Request failed: ${e instanceof Error ? e.message : String(e)}`);
      fail('engine_error', 'The engine failed to answer');
    } finally {
      this.active.delete(id);
      this.set({ inFlight: 0 });
      this.finishBox(id);
      this.settle();
    }
  }

  /** Answers an embedding request with one `EmbeddingResult` (or one error), one request at a time. */
  private serveEmbedding(req: EmbeddingRequest): Promise<void> {
    const id = req.requestId;
    this.outbox.set(id, { seq: 0, frames: [], finishedAt: null });
    const fail = (code: string, message: string) =>
      this.finishBox(id, () =>
        this.emit(id, (seq) => ({
          case: 'inferenceError',
          value: create(InferenceErrorSchema, { requestId: id, code, message, seq }),
        })),
      );
    if (this.state.restarting) {
      fail('restarting', 'The node is restarting');
      return Promise.resolve();
    }
    const model = this.state.model;
    if (model.phase === 'ready' && model.kind !== 'embedding') {
      fail('wrong_model_kind', 'This node serves a chat model, not an embedding model');
      return Promise.resolve();
    }
    if (req.modelId !== model.modelId || model.phase !== 'ready' || !this.embedder.loaded) {
      fail('model_not_ready', 'The requested model is not loaded');
      return Promise.resolve();
    }
    const ctl = new AbortController();
    this.active.set(id, ctl);
    // The engine embeds one batch at a time; later requests queue behind it.
    const run = async () => {
      try {
        if (ctl.signal.aborted) return;
        const vectors = await embedAll(this.embedder, {
          inputs: req.inputs,
          task: req.task,
          dimensions: req.dimensions,
        });
        if (ctl.signal.aborted) return;
        this.emit(id, (seq) => ({
          case: 'embeddingResult',
          value: create(EmbeddingResultSchema, {
            requestId: id,
            embeddings: vectors.map((values) => create(EmbeddingSchema, { values })),
            promptTokens: 0, // the engine does not say; the gateway estimates
            seq,
          }),
        }));
        this.set({ requestsServed: this.state.requestsServed + 1 });
        this.log.info(`Embedding request served: ${vectors.length} input(s)`);
        this.finishBox(id);
      } catch (e) {
        if (e instanceof EmbeddingRequestError) fail(e.code, e.message);
        else {
          this.log.error(`Embedding failed: ${e instanceof Error ? e.message : String(e)}`);
          fail('engine_error', 'The engine failed to embed');
        }
      } finally {
        this.active.delete(id);
        this.settle();
      }
    };
    const next = this.embedChain.then(run);
    this.embedChain = next;
    return next;
  }

  /** The request is over: keep its frames a little while (a reconnect may still need them), then forget them. */
  private finishBox(id: string, last?: () => void) {
    last?.();
    const box = this.outbox.get(id);
    if (!box) return;
    box.finishedAt = Date.now();
    const t = setTimeout(() => this.outbox.delete(id), OUTBOX_KEEP_MS) as unknown as {
      unref?: () => void;
    };
    t.unref?.();
  }

  private async sendTelemetry() {
    const d = await this.readTelemetry().catch(() => UNKNOWN_TELEMETRY);
    this.conn?.send({
      case: 'telemetry',
      value: create(TelemetrySchema, {
        cpuPercent: d.cpuPercent,
        memoryUsedMb: Math.max(0, Math.round(d.memoryUsedMb)),
        batteryPercent: Math.round(d.batteryPercent),
        charging: d.charging,
        temperatureC: d.temperatureC,
        tokensPerSec: this.state.model.kind === 'embedding' ? 0 : this.state.tokensPerSec,
        backend: this.engine.backend ?? '',
        maxContextTokens: this.engine.maxContextTokens,
      }),
    });
  }
}
