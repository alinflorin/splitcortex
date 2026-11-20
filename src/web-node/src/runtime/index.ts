import { useSyncExternalStore } from 'react';
import { ComputeEngine } from '../engine/compute';
import { LiteRtEmbedder } from '../engine/litert-embedder';
import { LiteRtEngine } from '../engine/litert';
import { OpfsModelFiles } from '../models/files';
import { NodeRuntime } from './NodeRuntime';

/** One node per browser tab: the stored files and the engine are shared by everything that uses `runtime`. */
export const modelFiles = new OpfsModelFiles();
const liteEngine = new LiteRtEngine({ openModel: (name) => modelFiles.openBlob(name) });
const compute = new ComputeEngine(liteEngine);
export const runtime = new NodeRuntime(
  compute,
  undefined,
  undefined,
  () => modelFiles,
  new LiteRtEmbedder({
    openModel: (name) => modelFiles.openBlob(name),
    // The same rules as chat: the admin's override, else this app's setting, else automatic.
    backend: () => compute.preferredBackend,
    capabilities: () => liteEngine.capabilities(),
  }),
);

export const useRuntime = () => useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
export const useLogEntries = () =>
  useSyncExternalStore(runtime.log.subscribe, runtime.log.getSnapshot);
