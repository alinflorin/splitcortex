import { useSyncExternalStore } from 'react';
import { LiteRtEngine } from '../engine/litert';
import { NodeRuntime } from './NodeRuntime';

/** One service per app process. */
export const runtime = new NodeRuntime(new LiteRtEngine());

export const useRuntime = () => useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
export const useLogs = () => useSyncExternalStore(runtime.log.subscribe, runtime.log.getSnapshot);
