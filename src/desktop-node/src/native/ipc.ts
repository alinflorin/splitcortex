import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import type { Backend, DeviceCaps } from '../engine/types';

/**
 * Everything the app asks of the native side (src-tauri). One typed seam: nothing else imports `@tauri-apps/api`, so
 * tests inject a fake `NativeApi` and the engine, the model files and the host never see the IPC details.
 */
export interface LoadedEngine {
  backend: Backend;
  maxContextTokens: number;
}
export interface NativeDevice {
  name: string;
  os: string;
  osVersion: string;
  model: string;
  cpuCores: number;
  memoryTotalMb: number;
  appVersion: string;
}
export interface NativeTelemetry {
  cpuPercent: number;
  memoryUsedMb: number;
  batteryPercent: number;
  charging: boolean;
  temperatureC: number;
}
export interface NativeGenerate {
  messages: { role: string; content: string }[];
  maxTokens: number;
  temperature: number;
  topP: number;
}

export interface NativeApi {
  engineLoad(
    name: string,
    backend: Backend,
    maxContextTokens: number,
    mtp: boolean,
  ): Promise<LoadedEngine>;
  engineUnload(): Promise<void>;
  /** Streams text pieces through `onText`; resolves when the generation ended. */
  engineGenerate(req: NativeGenerate, onText: (text: string) => void): Promise<void>;
  engineCancel(): Promise<void>;
  engineCaps(): Promise<DeviceCaps>;

  modelSize(name: string): Promise<number>;
  modelWrite(name: string, at: number, bytes: Uint8Array): Promise<void>;
  modelTruncate(name: string, length: number): Promise<void>;
  modelSha256(name: string): Promise<string>;
  modelRemove(name: string): Promise<void>;
  modelList(): Promise<string[]>;

  secretGet(name: string): Promise<string | null>;
  secretSet(name: string, value: string): Promise<void>;
  secretDelete(name: string): Promise<void>;

  deviceInfo(): Promise<NativeDevice>;
  telemetry(): Promise<NativeTelemetry>;
  setKeepAwake(on: boolean): Promise<void>;
}

/** True inside the packaged app / `tauri dev`; false in a plain browser (`pnpm dev`) and in tests. */
export const inTauri = () => isTauri();

export const tauriApi: NativeApi = {
  engineLoad: (name, backend, maxContextTokens, mtp) =>
    invoke('engine_load', { name, backend, maxContextTokens, mtp }),
  engineUnload: () => invoke('engine_unload'),
  engineGenerate: (req, onText) => {
    const channel = new Channel<string>();
    channel.onmessage = onText;
    return invoke('engine_generate', { req, onText: channel });
  },
  engineCancel: () => invoke('engine_cancel'),
  engineCaps: () => invoke('engine_caps'),

  modelSize: (name) => invoke('model_size', { name }),
  // Raw bytes as the request body (no JSON/base64 detour for 8 MiB pieces); the arguments travel in headers.
  modelWrite: (name, at, bytes) =>
    invoke('model_write', bytes, { headers: { 'x-name': name, 'x-at': String(at) } }),
  modelTruncate: (name, length) => invoke('model_truncate', { name, length }),
  modelSha256: (name) => invoke('model_sha256', { name }),
  modelRemove: (name) => invoke('model_remove', { name }),
  modelList: () => invoke('model_list'),

  secretGet: (name) => invoke('secret_get', { name }),
  secretSet: (name, value) => invoke('secret_set', { name, value }),
  secretDelete: (name) => invoke('secret_delete', { name }),

  deviceInfo: () => invoke('device_info'),
  telemetry: () => invoke('telemetry'),
  setKeepAwake: (on) => invoke('set_keep_awake', { on }),
};
