import { requireOptionalNativeModule } from 'expo';
import { PermissionsAndroid, Platform } from 'react-native';

/** Values the gateway protocol treats as "unknown" (see node.proto). */
export interface DeviceTelemetry {
  cpuPercent: number;
  memoryUsedMb: number;
  batteryPercent: number;
  charging: boolean;
  temperatureC: number;
}
export const UNKNOWN_TELEMETRY: DeviceTelemetry = {
  cpuPercent: -1,
  memoryUsedMb: 0,
  batteryPercent: -1,
  charging: false,
  temperatureC: -273,
};

interface Native {
  startService(): Promise<void>;
  stopService(): Promise<void>;
  setStartAtBoot(enabled: boolean): Promise<void>;
  getTelemetry(): Promise<DeviceTelemetry>;
}

// Android only (the local module `modules/splitcortex-node-service`); absent on iOS, in Jest and in builds without it.
const native = requireOptionalNativeModule<Native>('SplitCortexNodeService');

/** The foreground service that keeps the process, the gateway connection and the model alive while serving. */
export interface ServiceControl {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export const nodeService: ServiceControl & {
  setStartAtBoot(enabled: boolean): Promise<void>;
  telemetry(): Promise<DeviceTelemetry>;
  readonly available: boolean;
} = {
  available: native !== null,
  async start() {
    if (!native) return;
    // Android 13+: without this permission the service still runs, only its notification is hidden.
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS').catch(
        () => undefined,
      );
    }
    await native.startService();
  },
  async stop() {
    await native?.stopService();
  },
  async setStartAtBoot(enabled) {
    await native?.setStartAtBoot(enabled);
  },
  async telemetry() {
    return (await native?.getTelemetry()) ?? UNKNOWN_TELEMETRY;
  },
};
