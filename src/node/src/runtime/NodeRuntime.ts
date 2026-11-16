import { create } from '@bufbuild/protobuf';
import Constants from 'expo-constants';
import { fromB64 } from '../enrollment/crypto';
import { getOrCreateIdentity } from '../enrollment/identity';
import { loadEnrollment } from '../enrollment/store';
import type { Engine } from '../engine/types';
import {
  nodeService,
  UNKNOWN_TELEMETRY,
  type DeviceTelemetry,
  type ServiceControl,
} from '../native/nodeService';
import { ModelManager, NO_MODEL, type ModelStatus } from '../models/manager';
import { GatewayConnection, type Body, type ConnectionState } from '../protocol/connection';
import {
  InferenceChunkSchema,
  InferenceDoneSchema,
  InferenceErrorSchema,
  ModelPhase,
  ModelStateSchema,
  TelemetrySchema,
  type InferenceRequest,
} from '../protocol/gen/splitcortex/node/v1/node_pb';
import { LogBuffer } from './log';

export interface RuntimeState {
  /** The service is switched on (it may still be waiting for the network). */
  running: boolean;
  connection: ConnectionState;
  model: ModelStatus;
  inFlight: number;
  requestsServed: number;
  tokensServed: number;
  tokensPerSec: number;
  /** Why it cannot run (not enrolled, waiting for approval, no gateway pinned). */
  blocked: 'not-enrolled' | 'not-approved' | 'no-gateway' | null;
}

const INITIAL: RuntimeState = {
  running: false,
  connection: 'idle',
  model: NO_MODEL,
  inFlight: 0,
  requestsServed: 0,
  tokensServed: 0,
  tokensPerSec: 0,
  blocked: null,
};

const PHASE: Record<ModelStatus['phase'], ModelPhase> = {
  none: ModelPhase.NONE,
  downloading: ModelPhase.DOWNLOADING,
  loading: ModelPhase.LOADING,
  ready: ModelPhase.READY,
  failed: ModelPhase.FAILED,
};

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
  private generation = 0; // guards async start() against a stop()/restart() that happened meanwhile

  constructor(
    private readonly engine: Engine,
    private readonly service: ServiceControl = nodeService,
    private readonly readTelemetry: () => Promise<DeviceTelemetry> = () => nodeService.telemetry(),
  ) {}

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

    const gatewayKey = fromB64(enrollment.gateway.publicKey);
    this.models = new ModelManager({
      engine: this.engine,
      log: this.log,
      baseUrl: enrollment.enrollmentUrl,
      nodeId: enrollment.nodeId,
      privateKey: identity.privateKey,
      onStatus: (model) => {
        this.set({ model });
        this.reportModel(model);
      },
    });
    this.conn = new GatewayConnection({
      url: enrollment.gateway.url,
      nodeId: enrollment.nodeId,
      privateKey: identity.privateKey,
      gatewayPublicKey: gatewayKey,
      appVersion: Constants.expoConfig?.version ?? '0',
      log: this.log,
      onState: (connection) => {
        if (connection !== this.state.connection) this.log.info(`Connection: ${connection}`);
        this.set({ connection });
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
    this.telemetry = setInterval(() => void this.sendTelemetry(), 10_000);
  }

  private block(blocked: NonNullable<RuntimeState['blocked']>, message: string) {
    this.log.warn(message);
    this.set({ running: false, blocked });
  }

  async stop() {
    this.generation++;
    this.conn?.stop();
    this.models?.stop();
    if (this.telemetry) clearInterval(this.telemetry);
    this.telemetry = null;
    this.active.forEach((c) => c.abort());
    this.active.clear();
    await this.engine.unload();
    await this.service.stop().catch(() => undefined);
    this.conn = null;
    this.models = null;
    this.set({ ...INITIAL, blocked: null });
    this.log.info('Stopped');
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
        break;
      case 'modelAssignment': {
        const a = b.value;
        void this.models?.apply({
          modelId: a.modelId,
          name: a.name,
          fileName: a.fileName,
          sizeBytes: Number(a.sizeBytes),
          sha256: a.sha256,
        });
        break;
      }
      case 'inferenceRequest':
        void this.serve(b.value);
        break;
      case 'cancel':
        this.active.get(b.value.requestId)?.abort();
        break;
      default:
        break;
    }
  }

  private reportModel(m: ModelStatus) {
    this.conn?.send({
      case: 'modelState',
      value: create(ModelStateSchema, {
        modelId: m.modelId,
        phase: PHASE[m.phase],
        progressBytes: BigInt(Math.round(m.progressBytes)),
        error: m.error ?? '',
      }),
    });
  }

  private async serve(req: InferenceRequest) {
    const id = req.requestId;
    const send = (body: Body) => this.conn?.send(body);
    const fail = (code: string, message: string) =>
      send({
        case: 'inferenceError',
        value: create(InferenceErrorSchema, { requestId: id, code, message }),
      });
    if (this.state.inFlight > 0) return fail('busy', 'The node is already generating');
    if (req.modelId !== this.state.model.modelId || this.state.model.phase !== 'ready') {
      return fail('model_not_ready', 'The requested model is not loaded');
    }
    const ctl = new AbortController();
    this.active.set(id, ctl);
    this.set({ inFlight: 1 });
    const started = Date.now();
    let pieces = 0;
    try {
      const result = await this.engine.generate(
        {
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          maxTokens: req.maxTokens,
          temperature: req.temperature,
          topP: req.topP,
        },
        (text) => {
          pieces += 1;
          send({
            case: 'inferenceChunk',
            value: create(InferenceChunkSchema, { requestId: id, text }),
          });
        },
        ctl.signal,
      );
      if (!ctl.signal.aborted) {
        send({
          case: 'inferenceDone',
          value: create(InferenceDoneSchema, {
            requestId: id,
            completionTokens: pieces,
            finishReason: result.finishReason,
          }),
        });
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
    }
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
        tokensPerSec: this.state.tokensPerSec,
      }),
    });
  }
}
