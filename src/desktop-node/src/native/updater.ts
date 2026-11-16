import { invoke } from '@tauri-apps/api/core';
import { inTauri } from './ipc';

/** An available update, with the call that installs it. */
export interface PendingUpdate {
  version: string;
  install(): Promise<void>;
}

/**
 * Checks the release feed (GitHub `latest.json`, signed with the updater key) through tauri-plugin-updater. Returns
 * null when up to date or when this installation cannot update itself (a plain browser, or a Linux install that is
 * not an AppImage). The plugin modules are imported lazily: they only exist inside the app.
 */
export async function checkForUpdate(): Promise<PendingUpdate | null> {
  if (!inTauri()) return null;
  if (!(await invoke<boolean>('can_self_update'))) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    install: async () => {
      await update.downloadAndInstall();
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    },
  };
}

/** "Start when I log in" (the app then opens hidden in the tray). */
export async function autostart() {
  const mod = await import('@tauri-apps/plugin-autostart');
  return { isEnabled: mod.isEnabled, enable: mod.enable, disable: mod.disable };
}
