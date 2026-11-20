import type { Embedder, TunableEngine } from '../engine/types';
import { NodeRuntime } from './NodeRuntime';

let mockOnBody: ((b: { case?: string; value?: unknown }) => void) | undefined;
const mockSent: { case?: string; value?: Record<string, unknown> }[] = [];
let mockEnrollment: unknown = null;
let mockOnline = true;
let mockOnState: ((s: string) => void) | undefined;
let mockOnStatus: ((m: unknown) => void) | undefined;

jest.mock('../enrollment/store', () => ({
  loadEnrollment: async () => mockEnrollment,
  saveEnrollment: jest.fn(async () => undefined),
}));
jest.mock('../enrollment/identity', () => ({
  getOrCreateIdentity: async () => ({
    privateKey: new Uint8Array(32),
    publicKey: new Uint8Array(32),
    publicKeyB64: '',
  }),
}));
jest.mock('../models/manager', () => ({
  NO_MODEL: { phase: 'none', modelId: '', name: '', progressBytes: 0, sizeBytes: 0 },
  ModelManager: class {
    constructor(o: { onStatus: typeof mockOnStatus }) {
      mockOnStatus = o.onStatus;
    }
    apply = jest.fn(async () => undefined);
    stop = jest.fn();
  },
}));
jest.mock('../protocol/connection', () => ({
  GatewayConnection: class {
    constructor(o: { onBody: typeof mockOnBody; onState: typeof mockOnState }) {
      mockOnBody = o.onBody;
      mockOnState = o.onState;
    }
    reconnectNow = jest.fn();
    start = jest.fn();
    stop = jest.fn();
    send = (b: { case?: string; value?: Record<string, unknown> }) => {
      if (!mockOnline) return false;
      mockSent.push(b);
      return true;
    };
  },
}));

const engine: TunableEngine = {
  modalities: ['image'],
  loaded: true,
  backend: 'gpu',
  maxContextTokens: 4096,
  capabilities: () => ({ gpuAvailable: true, emulator: false, totalMemoryMb: 8000 }),
  benchmark: async () => 0,
  setPrefs: jest.fn(async () => undefined),
  load: jest.fn(),
  unload: jest.fn(async () => undefined),
  generate: jest.fn(),
};
const approved = {
  nodeId: 'n1',
  fingerprint: 'x',
  approved: true,
  enrollmentUrl: 'https://app.test/api',
  gateway: { publicKey: 'AAAA', url: 'wss://gw.test/node' },
  enrolledAt: '',
};

function setup(embedder?: Embedder) {
  mockSent.length = 0;
  mockOnline = true;
  const service = {
    start: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
    setKeepScreenOn: jest.fn(async () => undefined),
  };
  const telemetry = jest.fn(async () => ({
    cpuPercent: 42.5,
    memoryUsedMb: 1234.4,
    batteryPercent: 80,
    charging: true,
    temperatureC: 31.5,
  }));
  const settings = async () => ({
    startAtBoot: true,
    connectOnStart: true,
    compute: 'gpu' as const,
    maxContextTokens: 0,
    keepScreenOn: true,
    enableMtp: true,
  });
  return {
    rt: new NodeRuntime(engine, service, telemetry, settings, embedder),
    service,
    telemetry,
  };
}

describe('NodeRuntime', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('starts the background service with the connection and stops it again', async () => {
    mockEnrollment = approved;
    const { rt, service } = setup();
    await rt.start();
    expect(rt.getSnapshot()).toMatchObject({ running: true, blocked: null });
    expect(service.start).toHaveBeenCalledTimes(1);
    await rt.stop();
    expect(service.stop).toHaveBeenCalled();
    expect(rt.getSnapshot().running).toBe(false);
  });

  it('does not start anything when the device is not enrolled, not approved or has no gateway', async () => {
    for (const [e, why] of [
      [null, 'not-enrolled'],
      [{ ...approved, approved: false }, 'not-approved'],
      [{ ...approved, gateway: null }, 'no-gateway'],
    ] as const) {
      mockEnrollment = e;
      const { rt, service } = setup();
      await rt.start();
      expect(rt.getSnapshot()).toMatchObject({ running: false, blocked: why });
      expect(service.start).not.toHaveBeenCalled();
    }
  });

  it('applies its own compute settings, then the admin override on top, and reports what it runs on', async () => {
    mockEnrollment = approved;
    const { rt } = setup();
    jest.mocked(engine.setPrefs).mockClear();
    await rt.start();
    expect(engine.setPrefs).toHaveBeenCalledWith('local', {
      backend: 'gpu',
      maxContextTokens: undefined,
      enableMtp: true,
    });
    mockOnBody?.({
      case: 'nodeConfig',
      value: { backend: 'cpu', maxContextTokens: 2048, enableMtp: 'off' },
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(engine.setPrefs).toHaveBeenCalledWith('admin', {
      backend: 'cpu',
      maxContextTokens: 2048,
      enableMtp: false,
    });
    // an empty config clears the override
    mockOnBody?.({ case: 'nodeConfig', value: { backend: '', maxContextTokens: 0 } });
    await jest.advanceTimersByTimeAsync(0);
    expect(engine.setPrefs).toHaveBeenLastCalledWith('admin', {
      backend: undefined,
      maxContextTokens: undefined,
      enableMtp: undefined,
    });
    expect(rt.getSnapshot()).toMatchObject({ backend: 'gpu', maxContextTokens: 4096 });
    const t = mockSent.filter((m) => m.case === 'telemetry').at(-1);
    expect(t?.value).toMatchObject({ backend: 'gpu', maxContextTokens: 4096 });
    await rt.stop();
  });

  it("keeps the screen on by the app's setting unless the admin overrides it", async () => {
    mockEnrollment = approved;
    const { rt, service } = setup();
    await rt.start();
    expect(service.setKeepScreenOn).toHaveBeenLastCalledWith(true);
    mockOnBody?.({ case: 'nodeConfig', value: { keepScreenOn: 'off' } });
    await jest.advanceTimersByTimeAsync(0);
    expect(service.setKeepScreenOn).toHaveBeenLastCalledWith(false);
    mockOnBody?.({ case: 'nodeConfig', value: { keepScreenOn: '' } }); // override removed
    await jest.advanceTimersByTimeAsync(0);
    expect(service.setKeepScreenOn).toHaveBeenLastCalledWith(true);
    rt.setLocalScreen(false);
    expect(service.setKeepScreenOn).toHaveBeenLastCalledWith(false);
    await rt.stop();
    expect(service.setKeepScreenOn).toHaveBeenLastCalledWith(false);
  });

  it('reports cpu, memory, battery and temperature every 10 seconds', async () => {
    mockEnrollment = approved;
    const { rt, telemetry } = setup();
    await rt.start();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(telemetry).toHaveBeenCalled();
    const t = mockSent.find((m) => m.case === 'telemetry');
    expect(t?.value).toMatchObject({
      cpuPercent: 42.5,
      memoryUsedMb: 1234,
      batteryPercent: 80,
      charging: true,
      temperatureC: 31.5,
    });
    await rt.stop();
  });

  describe('requests across a dropped connection', () => {
    const ready = { phase: 'ready', modelId: 'm1', name: 'm', progressBytes: 0, sizeBytes: 0 };
    const request = {
      requestId: 'r1',
      modelId: 'm1',
      messages: [],
      maxTokens: 0,
      temperature: 0,
      topP: 0,
    };
    const frames = () =>
      mockSent.filter((m) => m.case === 'inferenceChunk' || m.case === 'inferenceDone');

    it('keeps generating offline and resends what the gateway missed after a resume', async () => {
      mockEnrollment = approved;
      const { rt } = setup();
      await rt.start();
      mockOnStatus?.(ready);
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      engine.generate = jest.fn(async (_req, onToken) => {
        onToken('a');
        mockOnline = false; // the socket drops after the first piece
        onToken('b');
        await gate;
        onToken('c');
        return { finishReason: 'stop' };
      }) as unknown as TunableEngine['generate'];
      mockOnBody?.({ case: 'inferenceRequest', value: request });
      await jest.advanceTimersByTimeAsync(0);
      expect(frames().map((m) => m.value?.seq)).toEqual([1]);
      release();
      await jest.advanceTimersByTimeAsync(0);
      mockOnline = true;
      mockSent.length = 0;

      // reconnect: the node lists the request, the gateway says it has seq 1
      mockOnBody?.({ case: 'ready', value: {} });
      expect(mockSent.find((m) => m.case === 'resume')?.value).toMatchObject({
        requestIds: ['r1'],
      });
      mockOnBody?.({
        case: 'resumeAck',
        value: { entries: [{ requestId: 'r1', receivedSeq: 1 }] },
      });
      expect(frames().map((m) => [m.case, m.value?.seq])).toEqual([
        ['inferenceChunk', 2],
        ['inferenceChunk', 3],
        ['inferenceDone', 4],
      ]);
      await rt.stop();
    });

    it('forgets requests the gateway no longer tracks', async () => {
      mockEnrollment = approved;
      const { rt } = setup();
      await rt.start();
      mockOnStatus?.(ready);
      engine.generate = jest.fn(async (_req, onToken) => {
        onToken('a');
        return { finishReason: 'stop' };
      }) as unknown as TunableEngine['generate'];
      mockOnBody?.({ case: 'inferenceRequest', value: request });
      await jest.advanceTimersByTimeAsync(0);
      mockOnBody?.({ case: 'ready', value: {} });
      mockOnBody?.({ case: 'resumeAck', value: { entries: [] } }); // not listed: dropped
      mockSent.length = 0;
      mockOnBody?.({ case: 'ready', value: {} });
      expect(mockSent.find((m) => m.case === 'resume')?.value).toMatchObject({ requestIds: [] });
      await rt.stop();
    });

    it('gives a running request up when the gateway stays unreachable', async () => {
      mockEnrollment = approved;
      const { rt } = setup();
      await rt.start();
      mockOnStatus?.(ready);
      let aborted = false;
      engine.generate = jest.fn(
        (_req, _on, signal: AbortSignal) =>
          new Promise((resolve) =>
            signal.addEventListener('abort', () => {
              aborted = true;
              resolve({ finishReason: 'stop' });
            }),
          ),
      ) as unknown as TunableEngine['generate'];
      mockOnBody?.({ case: 'inferenceRequest', value: request });
      await jest.advanceTimersByTimeAsync(0);
      mockOnState?.('reconnecting');
      await jest.advanceTimersByTimeAsync(30_000);
      expect(aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(11_000);
      expect(aborted).toBe(true);
      await rt.stop();
    });
  });

  describe('remote restart', () => {
    const ready = { phase: 'ready', modelId: 'm1', name: 'm', progressBytes: 0, sizeBytes: 0 };
    const request = {
      requestId: 'r1',
      modelId: 'm1',
      messages: [],
      maxTokens: 0,
      temperature: 0,
      topP: 0,
    };
    const errors = () =>
      mockSent.filter((m) => m.case === 'inferenceError').map((m) => m.value?.code);
    /** A generation that only ends when released or aborted. */
    function hang() {
      let release!: () => void;
      let aborted = false;
      engine.generate = jest.fn(
        (_req, _on, signal: AbortSignal) =>
          new Promise((resolve) => {
            release = () => resolve({ finishReason: 'stop' });
            signal.addEventListener('abort', () => {
              aborted = true;
              resolve({ finishReason: 'stop' });
            });
          }),
      ) as unknown as TunableEngine['generate'];
      return { release: () => release(), wasAborted: () => aborted };
    }

    it('restarts at once when nothing is running, keeping the background service on', async () => {
      mockEnrollment = approved;
      const { rt, service } = setup();
      await rt.start();
      jest.mocked(engine.unload).mockClear();
      mockOnBody?.({ case: 'restart', value: { graceSeconds: 30 } });
      await jest.advanceTimersByTimeAsync(0);
      expect(engine.unload).toHaveBeenCalled();
      expect(service.stop).not.toHaveBeenCalled();
      expect(service.start).toHaveBeenCalledTimes(2);
      expect(rt.getSnapshot()).toMatchObject({ running: true, restarting: false });
      await rt.stop();
    });

    it('refuses new requests while it waits, lets the running one finish, then restarts', async () => {
      mockEnrollment = approved;
      const { rt, service } = setup();
      await rt.start();
      mockOnStatus?.(ready);
      const gen = hang();
      mockOnBody?.({ case: 'inferenceRequest', value: request });
      await jest.advanceTimersByTimeAsync(0);
      mockOnBody?.({ case: 'restart', value: { graceSeconds: 30 } });
      await jest.advanceTimersByTimeAsync(0);
      expect(rt.getSnapshot().restarting).toBe(true);
      mockOnBody?.({ case: 'inferenceRequest', value: { ...request, requestId: 'r2' } });
      mockOnBody?.({
        case: 'embeddingRequest',
        value: { requestId: 'r3', modelId: 'm1', inputs: ['a'] },
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(errors()).toEqual(['restarting', 'restarting']);
      // still serving r1: no restart before it ends
      await jest.advanceTimersByTimeAsync(10_000);
      expect(service.start).toHaveBeenCalledTimes(1);
      expect(gen.wasAborted()).toBe(false);
      gen.release();
      await jest.advanceTimersByTimeAsync(0);
      expect(mockSent.some((m) => m.case === 'inferenceDone')).toBe(true);
      expect(service.start).toHaveBeenCalledTimes(2);
      expect(rt.getSnapshot()).toMatchObject({ running: true, restarting: false });
      await rt.stop();
    });

    it('cancels what is still running when the grace period is over', async () => {
      mockEnrollment = approved;
      const { rt, service } = setup();
      await rt.start();
      mockOnStatus?.(ready);
      const gen = hang();
      mockOnBody?.({ case: 'inferenceRequest', value: request });
      await jest.advanceTimersByTimeAsync(0);
      mockOnBody?.({ case: 'restart', value: { graceSeconds: 5 } });
      await jest.advanceTimersByTimeAsync(4_900);
      expect(gen.wasAborted()).toBe(false);
      expect(service.start).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(200);
      expect(gen.wasAborted()).toBe(true);
      expect(service.start).toHaveBeenCalledTimes(2);
      expect(rt.getSnapshot()).toMatchObject({ running: true, restarting: false, inFlight: 0 });
      await rt.stop();
    });

    it('ignores a second restart while one is pending', async () => {
      mockEnrollment = approved;
      const { rt, service } = setup();
      await rt.start();
      mockOnStatus?.(ready);
      const gen = hang();
      mockOnBody?.({ case: 'inferenceRequest', value: request });
      await jest.advanceTimersByTimeAsync(0);
      mockOnBody?.({ case: 'restart', value: { graceSeconds: 30 } });
      mockOnBody?.({ case: 'restart', value: { graceSeconds: 30 } });
      gen.release();
      await jest.advanceTimersByTimeAsync(0);
      expect(service.start).toHaveBeenCalledTimes(2);
      await rt.stop();
    });
  });

  describe('embeddings', () => {
    const emb = (over: Partial<Embedder> = {}): Embedder & { texts: string[][] } => {
      const texts: string[][] = [];
      return {
        texts,
        loaded: true,
        dimension: 4,
        load: jest.fn(async () => undefined),
        unload: jest.fn(async () => undefined),
        embed: jest.fn(async (t: string[]) => {
          texts.push(t);
          return t.map(() => [3, 4, 0, 0]);
        }),
        ...over,
      };
    };
    const ready = (kind?: string) => ({
      phase: 'ready',
      modelId: 'e1',
      name: 'e',
      progressBytes: 0,
      sizeBytes: 0,
      kind,
      embeddingDimension: kind === 'embedding' ? 4 : undefined,
    });
    const sent = (c: string) => mockSent.filter((m) => m.case === c);

    it('answers with one result, in order, prefixed and shortened', async () => {
      mockEnrollment = approved;
      const e = emb();
      const { rt } = setup(e);
      await rt.start();
      mockOnStatus?.(ready('embedding'));
      expect(sent('modelState').at(-1)?.value).toMatchObject({
        embeddingDimension: 4,
        modalities: [],
      });
      mockOnBody?.({
        case: 'embeddingRequest',
        value: {
          requestId: 'r1',
          modelId: 'e1',
          inputs: [' a ', 'b'],
          task: 'query',
          dimensions: 2,
        },
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(e.texts[0]).toEqual([
        'task: search result | query: a',
        'task: search result | query: b',
      ]);
      const res = sent('embeddingResult')[0]?.value as unknown as {
        seq: number;
        promptTokens: number;
        embeddings: { values: number[] }[];
      };
      expect(res.seq).toBe(1);
      expect(res.promptTokens).toBe(0);
      expect(res.embeddings).toHaveLength(2);
      expect(res.embeddings[0]!.values).toEqual([0.6, 0.8]);
      await rt.stop();
    });

    it('reports an engine failure and a bad input as an error with seq 1', async () => {
      mockEnrollment = approved;
      const e = emb({
        embed: jest.fn(async () => {
          throw new Error('boom');
        }),
      });
      const { rt } = setup(e);
      await rt.start();
      mockOnStatus?.(ready('embedding'));
      mockOnBody?.({
        case: 'embeddingRequest',
        value: { requestId: 'r1', modelId: 'e1', inputs: ['a'], task: '' },
      });
      mockOnBody?.({
        case: 'embeddingRequest',
        value: { requestId: 'r2', modelId: 'e1', inputs: [], task: '' },
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(sent('inferenceError').map((m) => [m.value?.code, m.value?.seq])).toEqual([
        ['engine_error', 1],
        ['bad_request', 1],
      ]);
      await rt.stop();
    });

    it('rejects an embedding request on a chat model and a chat request on an embedding model', async () => {
      mockEnrollment = approved;
      const { rt } = setup(emb());
      await rt.start();
      mockOnStatus?.(ready('chat'));
      mockOnBody?.({
        case: 'embeddingRequest',
        value: { requestId: 'r1', modelId: 'e1', inputs: ['a'] },
      });
      await jest.advanceTimersByTimeAsync(0);
      mockOnStatus?.(ready('embedding'));
      mockOnBody?.({
        case: 'inferenceRequest',
        value: {
          requestId: 'r2',
          modelId: 'e1',
          messages: [],
          maxTokens: 0,
          temperature: 0,
          topP: 0,
        },
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(sent('inferenceError').map((m) => m.value?.code)).toEqual([
        'wrong_model_kind',
        'wrong_model_kind',
      ]);
      await rt.stop();
    });

    it('frees the embedder on stop', async () => {
      mockEnrollment = approved;
      const e = emb();
      const { rt } = setup(e);
      await rt.start();
      await rt.stop();
      expect(e.unload).toHaveBeenCalled();
    });
  });
});
