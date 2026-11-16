import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import type { ComputePrefs } from '../engine/types';
import { nodeService } from '../native/nodeService';

const KEY = 'sc-node-settings';

export type ComputeChoice = 'auto' | 'cpu' | 'gpu';
/** Bounds of a context window the user may type (tokens), the same the control plane accepts for the admin override. */
export const MIN_CONTEXT = 512;
export const MAX_CONTEXT = 131072;

/** Parses the context field: empty = automatic (0), a whole number within the bounds, else null (invalid). */
export function parseContext(text: string): number | null {
  const v = text.trim();
  if (v === '') return 0;
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= MIN_CONTEXT && n <= MAX_CONTEXT ? n : null;
}

export interface NodeSettings {
  /** Start the background service (gateway connection, model, inference) when the device boots. Android only. */
  startAtBoot: boolean;
  /** Connect to the gateway and load the model whenever the app starts (including after a boot start). */
  connectOnStart: boolean;
  /** Compute backend. `auto` measures CPU against GPU once per model and takes the faster. An admin override from the web app wins. */
  compute: ComputeChoice;
  /** Context window in tokens, 0 = automatic. An admin override from the web app wins. */
  maxContextTokens: number;
}
export const DEFAULT_SETTINGS: NodeSettings = {
  startAtBoot: true,
  connectOnStart: true,
  compute: 'auto',
  maxContextTokens: 0,
};

/** The engine preferences these settings stand for (undefined = automatic). */
export const computePrefs = (s: NodeSettings): ComputePrefs => ({
  backend: s.compute === 'auto' ? undefined : s.compute,
  maxContextTokens: s.maxContextTokens > 0 ? s.maxContextTokens : undefined,
});

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
