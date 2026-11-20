import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Embedder, TunableEngine } from '../engine/types';
import type { Host } from './host';
import { NodeRuntime } from './NodeRuntime';

let mockOnBody: ((b: { case?: string; value?: unknown }) => void) | undefined;
const mockSent: { case?: string; value?: Record<string, unknown> }[] = [];
let mockEnrollment: unknown = null;
let mockOnline = true;
let mockOnState: ((s: string) => void) | undefined;
let mockOnStatus: ((m: unknown) => void) | undefined;

vi.mock('../enrollment/store', () => ({
  loadEnrollment: async () => mockEnrollment,
  saveEnrollment: vi.fn(async () => undefined),
}));
vi.mock('../enrollment/identity', () => ({
  getOrCreateIdentity: async () => ({
    privateKey: new Uint8Array(32),
    publicKey: new Uint8Array(32),
    publicKeyB64: '',
  }),
}));
vi.mock('../models/manager', () => ({
  NO_MODEL: { phase: 'none', modelId: '', name: '', progressBytes: 0, sizeBytes: 0 },
  ModelManager: class {
    constructor(o: { onStatus: typeof mockOnStatus }) {
      mockOnStatus = o.onStatus;
    }
    apply = vi.fn(async () => undefined);
    stop = vi.fn();
  },
}));
vi.mock('../protocol/connection', () => ({
  GatewayConnection: class {
    constructor(o: { onBody: typeof mockOnBody; onState: typeof mockOnState }) {
      mockOnBody = o.onBody;
      mockOnState = o.onState;
    }
    reconnectNow = vi.fn();
    start = vi.fn();
    stop = vi.fn();
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
  capabilities: async () => ({ gpuAvailable: true, emulator: false, totalMemoryMb: 8000 }),
  benchmark: async () => 0,
  setPrefs: vi.fn(async () => undefined),
  load: vi.fn(),
  unload: vi.fn(async () => undefined),
  generate: vi.fn(),
};
const approved = {
  nodeId: 'n1',
  fingerprint: 'x',
  approved: true,
  enrollmentUrl: 'https://app.test/api',
  gateway: { publicKey: 'AAAA', url: 'wss://gw.test/node' },
  enrolledAt: '',
};

function setup() {
  mockSent.length = 0;
  mockOnline = true;
  const host = {
    setKeepAwake: vi.fn(async () => undefined),
    onForeground: vi.fn(() => () => undefined),
    restartApp: vi.fn(),
    telemetry: vi.fn(async () => ({
      cpuPercent: 42.5,
      memoryUsedMb: 1234.4,
      batteryPercent: 80,
      charging: true,
      temperatureC: 31.5,
    })),
  } satisfies Host;
  const settings = async () => ({
    connectOnStart: true,
    compute: 'gpu' as const,
    maxContextTokens: 0,
    keepScreenOn: true,
  });
  const files = {} as never;
  const embedder: Embedder = {
    loaded: true,
    dimension: 3,
    load: vi.fn(),
    unload: vi.fn(),
    embed: vi.fn(async (texts: string[]) => ({
      vectors: texts.map(() => [3, 4, 0]),
      promptTokens: 5,
    })),
  };
  return { rt: new NodeRuntime(engine, host, settings, () => files, embedder), host, embedder };
}

describe('NodeRuntime', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts the background service with the connection and stops it again', async () => {
    mockEnrollment = approved;
    const { rt, host } = setup();
    await rt.start();
    expect(rt.getSnapshot()).toMatchObject({ running: true, blocked: null });
    expect(host.onForeground).toHaveBeenCalledTimes(1);
    await rt.stop();
    expect(host.setKeepAwake).toHaveBeenLastCalledWith(false);
    expect(rt.getSnapshot().running).toBe(false);
  });

  it('does not start anything when the device is not enrolled, not approved or has no gateway', async () => {
    for (const [e, why] of [
      [null, 'not-enrolled'],
      [{ ...approved, approved: false }, 'not-approved'],
      [{ ...approved, gateway: null }, 'no-gateway'],
    ] as const) {
      mockEnrollment = e;
      const { rt, host } = setup();
      await rt.start();
      expect(rt.getSnapshot()).toMatchObject({ running: false, blocked: why });
      expect(host.onForeground).not.toHaveBeenCalled();
    }
  });

  it('applies its own compute settings, then the admin override on top, and reports what it runs on', async () => {
    mockEnrollment = approved;
    const { rt } = setup();
    vi.mocked(engine.setPrefs).mockClear();
    await rt.start();
    expect(engine.setPrefs).toHaveBeenCalledWith('local', {
      backend: 'gpu',
      maxContextTokens: undefined,
    });
    mockOnBody?.({
      case: 'nodeConfig',
      value: { backend: 'cpu', maxContextTokens: 2048 },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.setPrefs).toHaveBeenCalledWith('admin', {
      backend: 'cpu',
      maxContextTokens: 2048,
    });
    // an empty config clears the override
    mockOnBody?.({ case: 'nodeConfig', value: { backend: '', maxContextTokens: 0 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.setPrefs).toHaveBeenLastCalledWith('admin', {
      backend: undefined,
      maxContextTokens: undefined,
    });
    expect(rt.getSnapshot()).toMatchObject({ backend: 'gpu', maxContextTokens: 4096 });
    const t = mockSent.filter((m) => m.case === 'telemetry').at(-1);
    expect(t?.value).toMatchObject({ backend: 'gpu', maxContextTokens: 4096 });
    await rt.stop();
  });

  it("keeps the screen on by this page's setting unless the admin overrides it", async () => {
    mockEnrollment = approved;
    const { rt, host } = setup();
    await rt.start();
    expect(host.setKeepAwake).toHaveBeenLastCalledWith(true);
    mockOnBody?.({ case: 'nodeConfig', value: { keepScreenOn: 'off' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(host.setKeepAwake).toHaveBeenLastCalledWith(false);
    mockOnBody?.({ case: 'nodeConfig', value: { keepScreenOn: '' } }); // override removed
    await vi.advanceTimersByTimeAsync(0);
    expect(host.setKeepAwake).toHaveBeenLastCalledWith(true);
    rt.setLocalScreen(false);
    expect(host.setKeepAwake).toHaveBeenLastCalledWith(false);
    await rt.stop();
    expect(host.setKeepAwake).toHaveBeenLastCalledWith(false);
  });

  it('reports cpu, memory, battery and temperature every 10 seconds', async () => {
    mockEnrollment = approved;
    const { rt, host } = setup();
    await rt.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(host.telemetry).toHaveBeenCalled();
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

  describe('multimodal input', () => {
    const ready = { phase: 'ready', modelId: 'm1', name: 'm', progressBytes: 0, sizeBytes: 0 };

    it('tells the gateway what the loaded model accepts besides text', async () => {
      mockEnrollment = approved;
      const { rt } = setup();
      await rt.start();
      mockOnStatus?.(ready);
      const ms = mockSent.filter((m) => m.case === 'modelState').at(-1);
      expect(ms?.value).toMatchObject({ modalities: ['image'] });
      mockOnStatus?.({ ...ready, phase: 'loading' });
      expect(mockSent.filter((m) => m.case === 'modelState').at(-1)?.value).toMatchObject({
        modalities: [],
      });
      await rt.stop();
    });

    it('hands the engine a message with media as typed parts', async () => {
      mockEnrollment = approved;
      const { rt } = setup();
      await rt.start();
      mockOnStatus?.(ready);
      const gen = vi.fn(async (..._args: unknown[]) => ({ finishReason: 'stop' as const }));
      engine.generate = gen as unknown as TunableEngine['generate'];
      const png = new Uint8Array([1, 2]);
      mockOnBody?.({
        case: 'inferenceRequest',
        value: {
          requestId: 'r9',
          modelId: 'm1',
          messages: [
            { role: 'user', content: 'hello', parts: [] },
            {
              role: 'user',
              content: 'look',
              parts: [
                { part: { case: 'text', value: 'look' } },
                { part: { case: 'image', value: { mimeType: 'image/png', data: png } } },
              ],
            },
          ],
          maxTokens: 0,
          temperature: 0,
          topP: 0,
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(gen.mock.calls[0]?.[0]).toMatchObject({
        messages: [
          { role: 'user', content: 'hello' },
          {
            role: 'user',
            content: 'look',
            parts: [
              { type: 'text', text: 'look' },
              { type: 'image', mimeType: 'image/png', data: png },
            ],
          },
        ],
      });
      await rt.stop();
    });
  });

  describe('embeddings', () => {
    const ready = {
      phase: 'ready',
      modelId: 'e1',
      name: 'e',
      progressBytes: 0,
      sizeBytes: 0,
      kind: 'embedding',
      embeddingDimension: 3,
    };
    const req = {
      requestId: 'q1',
      modelId: 'e1',
      inputs: ['a', 'b'],
      task: 'document',
      dimensions: 2,
    };
    const answers = () =>
      mockSent.filter((m) => m.case === 'embeddingResult' || m.case === 'inferenceError');

    it('reports the dimension and no modalities, then answers with one result in order', async () => {
      mockEnrollment = approved;
      const { rt, embedder } = setup();
      await rt.start();
      mockOnStatus?.(ready);
      expect(mockSent.filter((m) => m.case === 'modelState').at(-1)?.value).toMatchObject({
        embeddingDimension: 3,
        modalities: [],
      });
      mockOnBody?.({ case: 'embeddingRequest', value: req });
      await vi.advanceTimersByTimeAsync(0);
      expect(embedder.embed).toHaveBeenCalledWith([
        'title: none | text: a',
        'title: none | text: b',
      ]);
      const r = answers();
      expect(r).toHaveLength(1);
      expect(r[0]?.case).toBe('embeddingResult');
      const v = r[0]?.value as {
        promptTokens: number;
        seq: number;
        embeddings: { values: number[] }[];
      };
      expect(v).toMatchObject({ promptTokens: 5, seq: 1 });
      expect(v.embeddings).toHaveLength(2);
      expect(v.embeddings[0]?.values[0]).toBeCloseTo(0.6);
      await rt.stop();
    });

    it('rejects embedding requests on a chat model and chat requests on an embedding model', async () => {
      mockEnrollment = approved;
      const { rt } = setup();
      await rt.start();
      mockOnStatus?.({ phase: 'ready', modelId: 'e1', name: 'e', progressBytes: 0, sizeBytes: 0 });
      mockOnBody?.({ case: 'embeddingRequest', value: req });
      await vi.advanceTimersByTimeAsync(0);
      expect(answers()[0]?.value).toMatchObject({ code: 'wrong_model_kind', seq: 1 });
      mockSent.length = 0;
      mockOnStatus?.(ready);
      mockOnBody?.({
        case: 'inferenceRequest',
        value: {
          requestId: 'c1',
          modelId: 'e1',
          messages: [],
          maxTokens: 0,
          temperature: 0,
          topP: 0,
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(answers()[0]?.value).toMatchObject({ code: 'wrong_model_kind' });
      await rt.stop();
    });

    it('answers a bad task with bad_request and an engine failure with engine_error', async () => {
      mockEnrollment = approved;
      const { rt, embedder } = setup();
      await rt.start();
      mockOnStatus?.(ready);
      mockOnBody?.({ case: 'embeddingRequest', value: { ...req, task: 'weird' } });
      await vi.advanceTimersByTimeAsync(0);
      expect(answers()[0]?.value).toMatchObject({ code: 'bad_request' });
      vi.mocked(embedder.embed).mockRejectedValueOnce(new Error('GPU lost'));
      mockOnBody?.({ case: 'embeddingRequest', value: { ...req, requestId: 'q2' } });
      await vi.advanceTimersByTimeAsync(0);
      expect(answers().at(-1)?.value).toMatchObject({ code: 'engine_error', requestId: 'q2' });
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
    const errors = () => mockSent.filter((m) => m.case === 'inferenceError');
    const hang = (onAbort?: () => void) =>
      vi.fn(
        (_req, _on, signal: AbortSignal) =>
          new Promise((resolve) =>
            signal.addEventListener('abort', () => {
              onAbort?.();
              resolve({ finishReason: 'stop' });
            }),
          ),
      ) as unknown as TunableEngine['generate'];

    it('restarts at once when idle, refusing nothing and closing the connection', async () => {
      mockEnrollment = approved;
      const { rt, host } = setup();
      await rt.start();
      mockOnBody?.({ case: 'restart', value: { graceSeconds: 30 } });
      await vi.advanceTimersByTimeAsync(0);
      expect(host.restartApp).toHaveBeenCalledTimes(1);
      expect(rt.getSnapshot().connection).toBe('idle');
    });

    it('refuses new requests with "restarting" and waits for the running one to finish', async () => {
      mockEnrollment = approved;
      const { rt, host } = setup();
      await rt.start();
      mockOnStatus?.(ready);
      let finish!: () => void;
      engine.generate = vi.fn(
        (_req, onToken) =>
          new Promise((resolve) => {
            onToken('a');
            finish = () => resolve({ finishReason: 'stop' });
          }),
      ) as unknown as TunableEngine['generate'];
      mockOnBody?.({ case: 'inferenceRequest', value: request });
      await vi.advanceTimersByTimeAsync(0);
      mockOnBody?.({ case: 'restart', value: { graceSeconds: 30 } });
      await vi.advanceTimersByTimeAsync(0);
      expect(rt.getSnapshot().restarting).toBe(true);
      mockOnBody?.({ case: 'inferenceRequest', value: { ...request, requestId: 'r2' } });
      await vi.advanceTimersByTimeAsync(0);
      expect(errors().at(-1)?.value).toMatchObject({ requestId: 'r2', code: 'restarting' });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(host.restartApp).not.toHaveBeenCalled(); // still within the grace period
      finish();
      await vi.advanceTimersByTimeAsync(0);
      expect(mockSent.some((m) => m.case === 'inferenceDone')).toBe(true); // it finished, not cancelled
      expect(host.restartApp).toHaveBeenCalledTimes(1);
    });

    it('cancels what is still running when the grace period ends, then restarts', async () => {
      mockEnrollment = approved;
      const { rt, host } = setup();
      await rt.start();
      mockOnStatus?.(ready);
      let aborted = false;
      engine.generate = hang(() => (aborted = true));
      mockOnBody?.({ case: 'inferenceRequest', value: request });
      await vi.advanceTimersByTimeAsync(0);
      mockOnBody?.({ case: 'restart', value: { graceSeconds: 5 } });
      await vi.advanceTimersByTimeAsync(4_900);
      expect(aborted).toBe(false);
      expect(host.restartApp).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(200);
      expect(aborted).toBe(true);
      expect(host.restartApp).toHaveBeenCalledTimes(1);
    });
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
      engine.generate = vi.fn(async (_req, onToken) => {
        onToken('a');
        mockOnline = false; // the socket drops after the first piece
        onToken('b');
        await gate;
        onToken('c');
        return { finishReason: 'stop' };
      }) as unknown as TunableEngine['generate'];
      mockOnBody?.({ case: 'inferenceRequest', value: request });
      await vi.advanceTimersByTimeAsync(0);
      expect(frames().map((m) => m.value?.seq)).toEqual([1]);
      release();
      await vi.advanceTimersByTimeAsync(0);
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
      engine.generate = vi.fn(async (_req, onToken) => {
        onToken('a');
        return { finishReason: 'stop' };
      }) as unknown as TunableEngine['generate'];
      mockOnBody?.({ case: 'inferenceRequest', value: request });
      await vi.advanceTimersByTimeAsync(0);
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
      engine.generate = vi.fn(
        (_req, _on, signal: AbortSignal) =>
          new Promise((resolve) =>
            signal.addEventListener('abort', () => {
              aborted = true;
              resolve({ finishReason: 'stop' });
            }),
          ),
      ) as unknown as TunableEngine['generate'];
      mockOnBody?.({ case: 'inferenceRequest', value: request });
      await vi.advanceTimersByTimeAsync(0);
      mockOnState?.('reconnecting');
      await vi.advanceTimersByTimeAsync(30_000);
      expect(aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(11_000);
      expect(aborted).toBe(true);
      await rt.stop();
    });
  });
});
