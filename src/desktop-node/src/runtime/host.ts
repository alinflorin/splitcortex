import { tauriApi, type NativeApi } from '../native/ipc';

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

/**
 * What the runtime needs from the computer. The window may be hidden to the tray while the node serves; the native
 * side keeps the process alive and, when asked, keeps the computer from going to sleep.
 */
export interface Host {
  /** Prevents the computer from sleeping while serving (the screen may still turn off). */
  setKeepAwake(on: boolean): Promise<void>;
  /** Calls back when the window is shown again or the network returns (a good moment to reconnect at once). */
  onForeground(cb: () => void): () => void;
  telemetry(): Promise<DeviceTelemetry>;
  /** Starts the app again (a new process) so it reconnects on its own; rejects when this installation cannot. */
  restartApp(): Promise<void>;
}

const RESTART_MARK = 'sc-node-restarted';
/** Set just before a remote restart: the next start serves again even if "connect on open" is off. */
export const hasRestartMark = () => {
  try {
    return localStorage.getItem(RESTART_MARK) === '1';
  } catch {
    return false;
  }
};
export const clearRestartMark = () => {
  try {
    localStorage.removeItem(RESTART_MARK);
  } catch {
    // storage unavailable: nothing to clear
  }
};

export function nativeHost(api: NativeApi = tauriApi): Host {
  return {
    setKeepAwake: (on) => api.setKeepAwake(on).catch(() => undefined),
    onForeground(cb) {
      const onVisible = () => document.visibilityState === 'visible' && cb();
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('online', cb);
      return () => {
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('online', cb);
      };
    },
    telemetry: () => api.telemetry().catch(() => ({ ...UNKNOWN_TELEMETRY })),
    async restartApp() {
      try {
        localStorage.setItem(RESTART_MARK, '1');
      } catch {
        // without storage the node comes back only if "connect on open" is on
      }
      try {
        await api.restartApp();
      } catch (e) {
        clearRestartMark();
        throw e;
      }
    },
  };
}
