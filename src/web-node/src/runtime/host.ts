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
 * What the runtime needs from the browser (the phone app has a native service for this). A web node only serves while
 * its tab is open: a browser may throttle or freeze a hidden tab, and there is no background service to prevent it.
 */
export interface Host {
  /** Keeps the screen on (Screen Wake Lock) while serving; best effort, released when the tab is hidden. */
  setKeepAwake(on: boolean): Promise<void>;
  /** Calls back when the tab becomes visible again or the network returns (a good moment to reconnect at once). */
  onForeground(cb: () => void): () => void;
  telemetry(): Promise<DeviceTelemetry>;
}

interface BatteryManager {
  level: number;
  charging: boolean;
}
interface BrowserNavigator {
  getBattery?: () => Promise<BatteryManager>;
  wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> };
}

export const browserHost: Host = (() => {
  let lock: { release(): Promise<void> } | null = null;
  let wanted = false;
  const nav = () => navigator as unknown as BrowserNavigator;

  async function acquire() {
    if (!wanted || lock || document.visibilityState !== 'visible') return;
    try {
      lock = (await nav().wakeLock?.request('screen')) ?? null;
    } catch {
      lock = null; // refused (battery saver, no permission): serving still works
    }
  }
  // The browser releases the lock when the tab is hidden: take it again when it is back.
  document.addEventListener('visibilitychange', () => {
    lock = null;
    void acquire();
  });

  return {
    async setKeepAwake(on) {
      wanted = on;
      if (on) await acquire();
      else {
        const l = lock;
        lock = null;
        await l?.release().catch(() => undefined);
      }
    },
    onForeground(cb) {
      const onVisible = () => document.visibilityState === 'visible' && cb();
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('online', cb);
      return () => {
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('online', cb);
      };
    },
    async telemetry() {
      const t = { ...UNKNOWN_TELEMETRY };
      // JS heap of this tab (Chromium only); the model's WASM memory is not counted.
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      if (mem) t.memoryUsedMb = mem.usedJSHeapSize / 1024 ** 2;
      try {
        const b = await nav().getBattery?.();
        if (b) {
          t.batteryPercent = b.level * 100;
          t.charging = b.charging;
        }
      } catch {
        // no Battery API (Firefox, Safari)
      }
      return t;
    },
  };
})();
