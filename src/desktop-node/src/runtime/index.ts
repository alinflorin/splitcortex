import { useSyncExternalStore } from 'react';
import { ComputeEngine } from '../engine/compute';
import { NativeEngine } from '../engine/native';
import { NativeModelFiles } from '../models/files';
import { nativeHost } from './host';
import { NodeRuntime } from './NodeRuntime';

/** One node per installation: the stored files and the engine are shared by everything that uses `runtime`. */
export const modelFiles = new NativeModelFiles();
export const runtime = new NodeRuntime(
  new ComputeEngine(new NativeEngine()),
  nativeHost(),
  undefined,
  () => modelFiles,
);

export const useRuntime = () => useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
export const useLogEntries = () =>
  useSyncExternalStore(runtime.log.subscribe, runtime.log.getSnapshot);
