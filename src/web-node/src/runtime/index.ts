import { useSyncExternalStore } from 'react';
import { ComputeEngine } from '../engine/compute';
import { LiteRtEngine } from '../engine/litert';
import { OpfsModelFiles } from '../models/files';
import { NodeRuntime } from './NodeRuntime';

/** One node per browser tab: the stored files and the engine are shared by everything that uses `runtime`. */
export const modelFiles = new OpfsModelFiles();
export const runtime = new NodeRuntime(
  new ComputeEngine(new LiteRtEngine({ openModel: (name) => modelFiles.openBlob(name) })),
  undefined,
  undefined,
  () => modelFiles,
);

export const useRuntime = () => useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
export const useLogEntries = () =>
  useSyncExternalStore(runtime.log.subscribe, runtime.log.getSnapshot);
