import type { DeviceInfo } from '../enrollment/client';
import { tauriApi, type NativeApi } from '../native/ipc';

/** What this computer tells the platform about itself at enrollment: its name, OS, core count and RAM. */
export async function desktopDeviceInfo(api: NativeApi = tauriApi): Promise<DeviceInfo> {
  const d = await api.deviceInfo();
  return {
    name: d.name,
    platform: 'desktop',
    deviceModel: d.model || undefined,
    osVersion: [d.os, d.osVersion].filter(Boolean).join(' ') || undefined,
    appVersion: d.appVersion,
    cpuCores: d.cpuCores || undefined,
    memoryTotalMb: d.memoryTotalMb || undefined,
  };
}
