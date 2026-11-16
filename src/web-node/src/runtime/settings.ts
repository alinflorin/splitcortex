import { useCallback, useEffect, useState } from 'react';
import type { ComputePrefs } from '../engine/types';

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
  /** Connect to the gateway and load the model as soon as this page opens (a previously started node resumes). */
  connectOnStart: boolean;
  /** Compute backend. `auto` measures CPU against GPU once per model and takes the faster. An admin override from the web app wins. */
  compute: ComputeChoice;
  /** Context window in tokens, 0 = automatic. An admin override from the web app wins. */
  maxContextTokens: number;
  /** Keep the screen on while serving (Screen Wake Lock). An admin override wins. */
  keepScreenOn: boolean;
}
export const DEFAULT_SETTINGS: NodeSettings = {
  connectOnStart: true,
  compute: 'auto',
  maxContextTokens: 0,
  keepScreenOn: true,
};

/** The engine preferences these settings stand for (undefined = automatic). */
export const computePrefs = (s: NodeSettings): ComputePrefs => ({
  backend: s.compute === 'auto' ? undefined : s.compute,
  maxContextTokens: s.maxContextTokens > 0 ? s.maxContextTokens : undefined,
});

export async function loadSettings(): Promise<NodeSettings> {
  try {
    const raw = localStorage.getItem(KEY);
    return { ...DEFAULT_SETTINGS, ...(raw ? (JSON.parse(raw) as Partial<NodeSettings>) : {}) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
export const saveSettings = async (s: NodeSettings) => localStorage.setItem(KEY, JSON.stringify(s));

/** Settings (undefined while loading). */
export function useNodeSettings() {
  const [settings, setSettings] = useState<NodeSettings | undefined>(undefined);
  useEffect(() => void loadSettings().then(setSettings), []);
  const update = useCallback(
    (patch: Partial<NodeSettings>) =>
      setSettings((cur) => {
        const next = { ...(cur ?? DEFAULT_SETTINGS), ...patch };
        void saveSettings(next);
        return next;
      }),
    [],
  );
  return { settings, update };
}
