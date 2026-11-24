# Mobile node (`src/mobile-node`)

Rules: [CLAUDE.md](../CLAUDE.md). The web node ([web-node.md](web-node.md)) ports this app's enrollment, protocol, runtime, compute and model code: change both together.

## App

- Expo SDK 58, Expo Router (`src/app/`), `expo-dev-client`. Fluent UI React is DOM-only, so only `@fluentui/tokens` (Teams light/dark + brand tokens from `src/theme/brand.ts`) via `useTheme()` (`ThemeContext.tsx`; System/Light/Dark) and thin components in `src/components/` (`Logo`/`Brand` = web logo redrawn in `react-native-svg`; keep in sync with the web sidebar). No other component library. Inter via `@expo-google-fonts/inter`. i18next, bundled JSON (en + ro). Cards, hairline borders, no shadows.
- Tests: Jest (`jest-expo`, `@testing-library/react-native` 14 with async `render`/`fireEvent`; `src/test/setup.ts`, `renderWithTheme`), next to code.
- **Enrollment** (`src/app/enroll.tsx`, `src/enrollment/`): typed code (always) or QR (`expo-camera`), editable control-plane URL (default `EXPO_PUBLIC_ENROLLMENT_URL`), deep link `splitcortex://enroll?url=...&code=...`. [enrollment.md](enrollment.md).
- **Home**: service card (connection, model + progress, start/stop/restart), org/pool/device info (refreshed from `GET /node/me`). **Logs**: in-memory ring of 500 lines, states and counts only. **Settings**: start at boot (default on), connect and load on start (default on), Compute, Context, MTP, keep-screen-on.

## Runtime

- `src/runtime/NodeRuntime.ts` owns the gateway connection (`protocol/connection.ts`: wss + protobuf, mutual proof against the key **pinned at enrollment**; jittered reconnect to 30 s; 60 s idle watchdog), the model manager (`models/manager.ts`) and the engine. Proto types generated (`pnpm gen:proto`, committed in `src/protocol/gen`); `protocol/handshake.ts` must match `gateway/src/node_ws.rs`.
- **Models**: on `ModelAssignment`, download from `<control plane>/node/models/<id>/file` in 4 MiB `Range` requests streamed to disk (never whole in memory: JS heap ~192 MB), each signed with the device key, resume from `.part`, verify SHA-256, delete the previous model first, load. Status → gateway as `ModelState`.
- **Resume / key rotation**: chunks numbered and kept per request (`outbox`, 20 000 frames, 60 s after end); after reconnect send `Resume`, resend above `ResumeAck`; give up after 40 s unreachable; foreground return reconnects at once. Trusts the pinned gateway key plus keys announced in a rotation; reports key ids (`GatewayKeys`) after every `Ready`.

## Engine

- `Engine` interface (`src/engine/types.ts`); adapter `LiteRtEngine` over third-party **`react-native-litert-lm`** (not official: read its code before relying on it; its postinstall only fetches the iOS framework, so the pnpm build script stays unapproved). Required lazily. Each request is self-contained (history flattened to system prompt + one user turn; sampling/system changes reload). One request at a time. **Image/audio**: only the last user turn's media is sent (buffers after the text); modalities come from bundle metadata into `ModelState.modalities`.
- **Compute and context** (`engine/compute.ts`): per field **admin override (`NodeConfig`) > app setting > automatic**. Automatic backend: with a GPU driver and not an emulator, the first load benchmarks both (40 decode tokens), GPU only if >10% faster, remembered per model file; else CPU. Automatic context by RAM (<4 GB: 2048, <10 GB: 4096, else 8192). Forced GPU without a driver runs on CPU; a failing load steps back. Changes reload after the running generation. Backend and window go in `Telemetry` for context-aware routing.
- **MTP** passes `enableSpeculativeDecoding` (retries without on failure). **Keep screen on** sets `FLAG_KEEP_SCREEN_ON` natively. Both tri-state admin overrides.
- **Embeddings** (`kind == "embedding"`): same signed download, loaded into the library's embedding engine; `Embedder` interface, adapter `engine/litertEmbedder.ts`, pure logic `engine/embedding.ts` (`embedAll`). `ModelManager` frees the other engine on kind change. READY with `embedding_dimension`, no modalities. Per input: trim, EmbeddingGemma prefix per task (same strings as other nodes); `dimensions` truncates and renormalises (larger = `bad_request`); `prompt_tokens` 0. NaN/infinity = `engine_error`. Errors: `bad_request`, `engine_error`, `model_not_ready`, `wrong_model_kind`.
- **Remote restart** (`NodeRuntime.remoteRestart`): refuse new requests (`restarting`), wait for running ones up to `grace_seconds` (cap 1 h, then cancel), close socket, unload engines, start a fresh session. Foreground service stays up. A second `Restart` while pending is ignored; a local stop cancels it.
- **Telemetry** (native `getTelemetry()`): app CPU share, PSS memory, battery %, charging, temperature, every 10 s with tokens/s; unknown = protocol sentinels. No `cpuCores`.

## Android

- **Background service** (`modules/splitcortex-node-service`, local Expo module, Kotlin): `NodeService` is a `specialUse` foreground service (`dataSync` can't start from boot on Android 15) with partial wake lock and low-priority notification, extending `HeadlessJsTaskService` to run `SplitCortexNode`. `BootReceiver` starts it on `BOOT_COMPLETED` and after app update when start-at-boot is on (mirrored to native SharedPreferences). `src/runtime/headless.ts` (from custom entry `index.ts`) calls `runtime.start()` and stays pending until it stops; stops the service at once if connect-on-start is off or the device isn't enrolled/approved. Same singleton runtime when the app opens. Android 13+ asks for notification permission.
- **Doze**: Wi-Fi lock (`WIFI_MODE_FULL_LOW_LATENCY`) and a battery-optimisation exemption request (`BatteryExemption` card on Home until exempt, always in Settings).
- **Build**: the library needs **minSdk 26** and Kotlin **2.4.0** (Expo 58 defaults to 2.2.0): `app.json` `expo-build-properties`. Android <8 unsupported. The library ships only arm64-v8a and x86_64, so builds target those (`reactNativeArchitectures`; CI non-release uses `-PreactNativeArchitectures=x86_64`); `plugins/withGradleSpeed.js` sets `org.gradle.jvmargs` (4 GB heap, 1 GB Metaspace) and caching.
- **x86_64 emulator**: `patches/react-native-litert-lm.patch` (pnpm `patchedDependencies`) makes the ABI filter follow `reactNativeArchitectures` and lets `LiteRTLMPackage` init on x86_64. After changing it delete `android/build/generated/autolinking`.
- **Backup disabled** (`android.allowBackup: false`) so the device key never restores onto another device.

## iOS (nothing built or run)

Interfaces must not assume Android. **Foreground-only**: iOS suspends the app soon after it leaves the foreground; serve only while open (idle timer disabled), ideally charging; no audio/VoIP/location tricks. LiteRT-LM's Swift API is Early Preview. **Decided: identity stays Ed25519 in `expo-secure-store`** (Secure Enclave has only P-256; switching would re-enroll every node).

## Setup rules

Physical device, **no EAS**, local builds (`expo prebuild` / `expo run:android`), no Expo Go. The TLS connection must stay alive while serving (OS background limits are a known risk).
