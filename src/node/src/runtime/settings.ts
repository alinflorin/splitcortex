import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { nodeService } from '../native/nodeService';

const KEY = 'sc-node-settings';

export interface NodeSettings {
  /** Start the background service (gateway connection, model, inference) when the device boots. Android only. */
  startAtBoot: boolean;
  /** Connect to the gateway and load the model whenever the app starts (including after a boot start). */
  connectOnStart: boolean;
}
export const DEFAULT_SETTINGS: NodeSettings = { startAtBoot: true, connectOnStart: true };

export async function loadSettings(): Promise<NodeSettings> {
  const raw = await AsyncStorage.getItem(KEY);
  return { ...DEFAULT_SETTINGS, ...(raw ? (JSON.parse(raw) as Partial<NodeSettings>) : {}) };
}
export const saveSettings = (s: NodeSettings) => AsyncStorage.setItem(KEY, JSON.stringify(s));

/** Settings (undefined while loading). */
export function useNodeSettings() {
  const [settings, setSettings] = useState<NodeSettings | undefined>(undefined);
  useEffect(() => void loadSettings().then(setSettings), []);
  const update = useCallback(
    (patch: Partial<NodeSettings>) =>
      setSettings((cur) => {
        const next = { ...(cur ?? DEFAULT_SETTINGS), ...patch };
        void saveSettings(next);
        if (patch.startAtBoot !== undefined) void nodeService.setStartAtBoot(patch.startAtBoot);
        return next;
      }),
    [],
  );
  return { settings, update };
}
