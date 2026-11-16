import type { Engine } from '../engine/types';
import { NodeRuntime } from './NodeRuntime';

const mockSent: { case?: string; value?: Record<string, unknown> }[] = [];
let mockEnrollment: unknown = null;

jest.mock('../enrollment/store', () => ({ loadEnrollment: async () => mockEnrollment }));
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
    apply = jest.fn(async () => undefined);
    stop = jest.fn();
  },
}));
jest.mock('../protocol/connection', () => ({
  GatewayConnection: class {
    start = jest.fn();
    stop = jest.fn();
    send = (b: { case?: string; value?: Record<string, unknown> }) => {
      mockSent.push(b);
      return true;
    };
  },
}));

const engine: Engine = {
  loaded: false,
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

function setup() {
  mockSent.length = 0;
  const service = { start: jest.fn(async () => undefined), stop: jest.fn(async () => undefined) };
  const telemetry = jest.fn(async () => ({
    cpuPercent: 42.5,
    memoryUsedMb: 1234.4,
    batteryPercent: 80,
    charging: true,
    temperatureC: 31.5,
  }));
  return { rt: new NodeRuntime(engine, service, telemetry), service, telemetry };
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
});
