# Desktop node (`src/desktop-node`)

Summary in [CLAUDE.md](../CLAUDE.md). A Tauri 2 app (Linux, macOS, Windows) serving like a phone node. It ports the web node's web side ([web-node.md](web-node.md)) and replaces browser-only parts with native code. A change to enrollment, protocol, runtime, compute or model code in the web node, phone app or here usually needs the same change in the others (ported, not shared). The [CLI node](cli-node.md) ports this app's logic to Rust.

**Verification**: `cargo test` loads the real Linux library and resolves every function (`the_shipped_library_has_every_function`). The owner has since run it on real laptops with real models (OS, speeds, defects not recorded; add them here). *Unchecked*: that the conversation stream's chunk text is the JSON the parser expects (`chunk_text` also accepts plain text), role names the chat templates want (`assistant` passed as received), GPU backends per OS, the MTP drafter, `finishReason` (`length` when piece count reaches `maxTokens`), macOS App Nap / Linux throttling of the hidden webview's timers and WebSocket (check hidden for hours).

## Layout

- **Web side** (`src/`): Vite, React + React Compiler, strict TS, Fluent, react-hook-form + zod (i18n-key messages), react-i18next en + ro, Vitest, self-hosted Inter, no CDNs, cards; one page, no router. `src/protocol/gen` from `src/gateway/proto` (`pnpm gen:proto`, committed, prettier-ignored).
- **Native side** (`src-tauri/`, Rust 2024): `engine/`, `storage.rs` (model files, device secret), `system.rs` (device info, telemetry, sleep prevention, updater gate), `lib.rs` (plugins, tray, close-to-tray). `capabilities/default.json` needs an entry for each plugin API the web side uses.
- **Seam**: `src/native/ipc.ts` is the only file importing `@tauri-apps/api` (typed `NativeApi`; tests inject a fake). `src/native/http.ts` = `fetch` through Tauri's HTTP client. `src/native/updater.ts` wraps updater, process and autostart plugins.

## Engine (`src-tauri/src/engine`, `src/engine/native.ts`)

**Image/audio input**: the C API takes a vision and an audio backend in `litert_lm_engine_settings_create` (the two `NULL`s before); `create_best` tries media on (same backend as the model) then off, each with MTP then without, and `engine_load` returns `modalities`. Messages with media go to the conversation as JSON parts with `blob` (base64: `{"type":"image"|"audio","blob":...}`, the form the LiteRT-LM conversation reads, same as its JS wire format); the web side sends the bytes base64 inside the JSON arguments. Not run against a real multimodal model yet (see the unchecked points below).

- Google's official **LiteRT-LM C API** (`litert_lm_c_api`, asset `litert_lm_c_api-1.0.0.zip` of LiteRT-LM v0.19.1) **loaded at run time with `libloading`** (`ffi.rs` declares only the ~40 functions used; no bindgen). No official Rust crate; community `litert-lm-rs` not used. Never unloaded (`ManuallyDrop`: `dlclose` crashed).
- `scripts/fetch-litert.mjs [triple] [--required]` downloads the zip, **checks the pinned SHA-256**, copies the library into `src-tauri/resources/litert/` (git-ignored; bundled as the `litert/` resource, found via `resource_dir()`, `SPLITCORTEX_LITERT_LIB` overrides). Libraries exist for linux x86_64/arm64, windows x86_64, macOS arm64; **none for macOS x86_64**, so the release matrix doesn't build Intel macOS. Updating LiteRT-LM = change `VERSION`/`SHA256` and re-check `ffi.rs` against the headers.
- One model, one generation at a time: `engine_load` (backend cpu|gpu, window via `set_max_num_tokens`, MTP via the speculative-decoding config, retried without MTP if rejected, kernel cache in the app cache dir), `engine_generate` (fresh conversation per request: history via `conversation_config_set_messages`, last turn via `send_message_stream`, sampler top-p/temperature and max output tokens in the session config; pieces stream over a Tauri `Channel`), `engine_cancel` (atomic flag; the stream callback calls `conversation_cancel_process`, the only call allowed inside a callback), `engine_unload`, `engine_caps`.
- **GPU**: `gpuAvailable` true on macOS, Windows, and Linux when `libvulkan.so.1` loads; it only gates the automatic CPU-vs-GPU measurement; a failed load steps back to CPU; admin/user setting can force GPU.
- Prompts/completions are never logged or stored.

## Models, identity, HTTP

- **Models**: downloaded by the web side's model manager (signed 8 MiB `Range` requests, resume, SHA-256, replace), written in place at an offset by `model_write` (raw bytes as IPC body, args in headers) into `<app data>/models/`; hash streamed in Rust; file names validated (`[A-Za-z0-9._-]`, no leading dot).
- **Identity**: Ed25519 key as a file in `<app data>/secrets/` (mode 0600, dir 0700 on Unix; Windows relies on profile ACL), never webview storage (the `localStorage` fallback exists only outside Tauri). Software key, no OS keychain (a Linux box may lack a secret service). Deleting app data forgets it: re-join and remove the old node in the web app. Enrollment record and settings are in webview `localStorage` (not secret).
- **No CORS** (the control plane has none and must not get any): control plane calls (enrollment, `GET /node/me`, model download) go through `@tauri-apps/plugin-http` (Rust, normal TLS validation; capability allows any http/https URL since the user types the address). The gateway wss is opened by the webview (the gateway ignores `Origin`). A self-signed control plane (local Tilt) must be trusted by the OS.
- **Enrollment URL** defaults to `https://app.prd.splitcortex.com/api` (editable; `VITE_ENROLLMENT_URL` overrides in dev). **No deep link yet**: the user types address and code.
- Reports `platform: "desktop"`, host name, OS, arch, cores, RAM, app version. Telemetry: this app's CPU share and RSS (sysinfo); battery/temperature are sentinels. Admin `NodeConfig.keepScreenOn` = keep the computer awake.

## Behaviour

- **Tray**: closing hides the window, the node keeps serving; menu Show/Quit; left click shows. `--hidden` starts without a window (autostart). Sleep prevention (`keepawake`, idle sleep only; display may turn off) follows *keep the computer awake*, admin wins.
- **Settings** (web `localStorage`): compute auto/CPU/GPU, context window, keep awake, connect and load on open; *App* card: version, update check/install, *start when I log in* (`tauri-plugin-autostart`, Launch Agent on macOS).
- CSP in `tauri.conf.json` (self, `ipc:`, https/wss connections, inline styles for Fluent/Griffel).

## Release and auto-update

- **Tag `desktop-node-vX.Y.Z`** (own stream). `desktop-node-release.yaml` creates the release (**not** latest), builds with `tauri-apps/tauri-action@v1` on linux x86_64 (`ubuntu-22.04`), linux arm64 (`ubuntu-22.04-arm`), macOS arm64 (`macos-latest`), windows x86_64 (`windows-latest`). Each job sets the version from the tag (`scripts/set-version.mjs`: `package.json`, `tauri.conf.json`, `Cargo.toml`, `VITE_APP_VERSION`), fetches the library with `--required`, builds and uploads deb/rpm/AppImage, dmg/app.tar.gz, NSIS exe/msi plus signed updater bundles (`createUpdaterArtifacts`). **No release-cache workflow** (decided; cold Rust cache on tags).
- **Updater**: `tauri-plugin-updater`, endpoint `https://github.com/alinflorin/splitcortex/releases/download/desktop-node-updater/latest.json`. `releases/latest/download` can't work (latest is the server's), so the **rolling pre-release `desktop-node-updater`** (never delete) holds only `latest.json`, rebuilt after each desktop release from its assets by `scripts/make-latest-json.py` (parallel jobs would race on a shared file). On Linux only an **AppImage** can self-update (`can_self_update`). Checks once on open, *Check for updates* button; install verifies the signature and relaunches.
- **Signing**: minisign key; **public key in `tauri.conf.json`**, private key in secrets `DESKTOP_NODE_SIGNING_PRIVATE_KEY` and `..._PASSWORD` (GitHub rejects empty secrets, so the key has a password). Generated on the maintainer's machine at `~/.config/splitcortex/desktop-node-updater.key` (+ `desktop-node-updater.password`). **Back it up; losing it means installed apps can never update; never commit it.** Replace with `pnpm tauri signer generate` and update the pubkey (installed apps trust the old one, so rotate before the first public release).
- **OS code signing not set up**: macOS unsigned/unnotarized (right-click or `xattr -cr`), Windows not Authenticode-signed (SmartScreen). Add `APPLE_*` / `WINDOWS_CERTIFICATE` secrets to `tauri-action` when wanted.
- **CI** `desktop-node.yaml` (path-filtered PR/push) on linux x64/arm64, macOS, Windows: typecheck, prettier check, Vitest, build, fetch library, `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`. No images/chart.

## Commands

See [commands-and-ci.md](commands-and-ci.md). Linux build needs `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`; `pnpm tauri dev` fetches the library and starts Vite.

## Not built

macOS Intel; enrollment deep link; battery/temperature telemetry; keychain/hardware-backed identity; OS code signing.
