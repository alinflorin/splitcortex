import { useSyncExternalStore } from 'react';
import { ComputeEngine } from '../engine/compute';
import { NativeEmbedder } from '../engine/embedder';
import { NativeEngine } from '../engine/native';
import { NativeModelFiles } from '../models/files';
import { nativeHost } from './host';
import { NodeRuntime } from './NodeRuntime';

/** One node per installation: the stored files and the engine are shared by everything that uses `runtime`. */
export const modelFiles = new NativeModelFiles();
const engine = new ComputeEngine(new NativeEngine());
export const runtime = new NodeRuntime(
  engine,
  nativeHost(),
  undefined,
  () => modelFiles,
  new NativeEmbedder(undefined, () => engine.preferredBackend),
);

export const useRuntime = () => useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
export const useLogEntries = () =>
  useSyncExternalStore(runtime.log.subscribe, runtime.log.getSnapshot);
