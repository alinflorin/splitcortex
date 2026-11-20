import { useSyncExternalStore } from 'react';
import { ComputeEngine } from '../engine/compute';
import { LiteRtEmbedder } from '../engine/litert-embedder';
import { LiteRtEngine } from '../engine/litert';
import { OpfsModelFiles } from '../models/files';
import { NodeRuntime } from './NodeRuntime';

/** One node per browser tab: the stored files and the engine are shared by everything that uses `runtime`. */
export const modelFiles = new OpfsModelFiles();
const liteEngine = new LiteRtEngine({ openModel: (name) => modelFiles.openBlob(name) });
export const runtime = new NodeRuntime(
  new ComputeEngine(liteEngine),
  undefined,
  undefined,
  () => modelFiles,
  new LiteRtEmbedder({
    openModel: (name) => modelFiles.openBlob(name),
    gpuAvailable: async () => (await liteEngine.capabilities()).gpuAvailable,
  }),
);

export const useRuntime = () => useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
export const useLogEntries = () =>
  useSyncExternalStore(runtime.log.subscribe, runtime.log.getSnapshot);
