import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TunableEngine } from '../engine/types';
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
  return { rt: new NodeRuntime(engine, host, settings, () => files), host };
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
