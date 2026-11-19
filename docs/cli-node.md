# CLI node (`src/cli-node`)

Summary in [CLAUDE.md](../CLAUDE.md). A **headless, Rust-only node** (Linux, macOS, Windows) doing the [desktop node](desktop-node.md)'s job without a window: enroll with a code, connect out to the gateway, download the pool's model, serve. One binary plus the engine library, installed by a script from this repo.

**Separate from the desktop node on purpose (no shared crate).** `src/engine/` is a copy of `src/desktop-node/src-tauri/src/engine/`; `storage.rs`/`system.rs` are adapted copies; `crypto.rs`, `handshake.rs`, `connection.rs`, `enroll.rs`, `models.rs`, `runtime.rs`, `engine/compute.rs` are Rust ports of the desktop's TypeScript (`enrollment/crypto.ts`, `protocol/handshake.ts`, `protocol/connection.ts`, `enrollment/client.ts`, `models/manager.ts`, `runtime/NodeRuntime.ts`, `engine/compute.ts`). **A fix to the engine binding, handshake or enrollment crypto must be made in both.** Contracts that must stay identical: the protobuf (generated from `src/gateway/proto` by `build.rs`, no copy), the enrollment crypto (`src/control-plane/src/enrollment/crypto.ts`), the handshake labels (`src/gateway/src/node_ws.rs`).

## Stack and layout

Rust 2024, `tokio`, `tokio-tungstenite` (wss), `reqwest` (**rustls with OS root certs**, no OpenSSL), `prost` (via `build.rs` + `protox`, no protoc), `curve25519-dalek` + `sha2` (CPace), `ed25519-dalek`, `hkdf`, `chacha20poly1305`, `libloading`, `clap`, `sysinfo`, `keepawake`. Files: `main.rs` (commands), `runtime.rs`, `connection.rs`, `enroll.rs` + `crypto.rs`, `handshake.rs`, `models.rs`, `engine/` (`mod.rs`, `ffi.rs`, `compute.rs`), `storage.rs`, `settings.rs`, `system.rs`, `service.rs`, `update.rs`. Scripts: `fetch-litert.py` (same pinned LiteRT-LM v0.19.1 zip + SHA-256 as the desktop node; bump both together), `set-version.py`, `package.py`; installers `install.sh`, `install.ps1`.

## Commands

`splitcortex-node join [--url <web app address>] [--code XXXX-XXXXXX]` (address: `--url`, else `SPLITCORTEX_URL`, else `settings.json` `appUrl` (written by the installer or `config --url`), else `https://app.prd.splitcortex.com`; `https://host` and `https://host/api` both work; asks for the code if missing), `run` (foreground; Ctrl+C/SIGTERM stops; waits for admin approval if required), `status`, `leave` (forgets enrollment and device key), `config [--compute auto|cpu|gpu] [--context N] [--keep-awake true|false] [--url ...]`, `update [--check]`, `service install|uninstall|status`. Admin overrides (backend, context, MTP, keep awake) win over `config`, field by field. Platform reported: `cli`. Logs to stderr (`RUST_LOG`); never prompts/completions.

## State and engine

- Data dir (`directories` crate; `SPLITCORTEX_HOME` overrides; `<home>/data`, `<home>/cache`): `models/`, `secrets/device-key` (mode 0600, dir 0700 on Unix; Windows relies on profile ACL), `enrollment.json`, `settings.json`, `backend-bench.json`. Software Ed25519 key like the other nodes.
- **Image/audio input**: same as the desktop node (`create_best`, media on first, `Engine::modalities()` into `ModelState.modalities`; protocol `parts` are base64-encoded into `engine::Part`s). A fix in one is a fix in the other.
- Engine binding and policy are the desktop node's (C API, fallbacks, unchecked points: see [desktop-node.md](desktop-node.md)). Library found in `litert/` **next to the executable** (symlinks resolved) or via `SPLITCORTEX_LITERT_LIB`. `cargo test` loads it when `fetch-litert.py` was run.
- One request at a time (`busy` otherwise); chunks/done/error carry `seq` and stay in an outbox 60 s for `Resume`/`ResumeAck`; running requests are given up after 40 s without a gateway.

## Install, service, update

- **Install**: `curl -fsSL https://raw.githubusercontent.com/alinflorin/splitcortex/main/src/cli-node/install.sh | sh` (Linux x64/arm64, macOS arm64) and `irm https://raw.githubusercontent.com/alinflorin/splitcortex/main/src/cli-node/install.ps1 | iex` (Windows x64): these lines are in the web app's *Command line* card. The script finds the newest `cli-node-v*` release through the GitHub API (not `releases/latest`, which is the server's), downloads `splitcortex-node-<target>.tar.gz` (`.zip` on Windows) + `.sha256`, verifies, unpacks into `~/.local/lib/splitcortex-node` (`%LOCALAPPDATA%\Programs\SplitCortexNode`) with a link in `~/.local/bin` (Windows: folder added to user PATH). `SPLITCORTEX_VERSION` pins a version; `SPLITCORTEX_INSTALL_DIR`/`SPLITCORTEX_BIN_DIR` move it. At the end both ask for the web app address (default `https://app.prd.splitcortex.com`; `install.sh` reads from `/dev/tty` since stdin is the pipe, skipping the question without a terminal) and **save it** via `config --url`; `SPLITCORTEX_URL` answers up front. Files fetched with `curl`/`irm` carry no quarantine mark, so Gatekeeper/SmartScreen don't block the unsigned binary. Served from GitHub raw: works without the platform up and follows `main`.
- **Service**: `service install` writes a systemd **user** unit on Linux (`loginctl enable-linger` keeps it running logged out), a launchd agent on macOS, a logon scheduled task on Windows (logs in the cache dir); it runs `splitcortex-node run`.
- **Update**: `update` takes the newest published `cli-node-vX.Y.Z` (ignores drafts, pre-releases, other streams), verifies the checksum, replaces binary and library in place (Windows moves the running `.exe` aside to `.old`, removed on next start). Restart afterwards.

## Release and CI

- **Tag `cli-node-vX.Y.Z`** (own stream). `cli-node-release.yaml` creates the release (**not** latest) then builds on linux x64 (`ubuntu-22.04`), linux arm64 (`ubuntu-22.04-arm`), macOS arm64, Windows x64: `set-version.py`, `fetch-litert.py --required`, `cargo build --release --target`, `package.py` (binary + `litert/<library>` at the archive top, `.sha256`), `gh release upload`. No macOS Intel (no library). No release-cache workflow, no secrets.
- **CI** `cli-node.yaml` (path filter includes `src/gateway/proto/**`) on the same four platforms: `cargo test` (library fetched) on all, `cargo fmt --check` and `cargo clippy --all-targets -D warnings` only on Linux x64; release profile is thin LTO with 16 codegen units, `shellcheck install.sh` on Linux. Not a deployed service (no image/chart/Tiltfile).

## Verified

Linux x64: unit tests (crypto, handshake, storage, settings, update parsing), **CPace byte for byte against `@cipherman/pake-js`** (fixed scalars), the connection against a fake gateway (handshake, pinning refusal, ping/pong), a command smoke test, `install.sh` end to end against a local server with a packaged build. The owner has since run enrollment, a gateway session and generation on real laptops (OS and results not recorded). *Not verified*: Windows and macOS builds (CI only compiles them), `install.ps1`, service install on any OS, `update` against a real release.

## Not built

macOS Intel; battery/temperature telemetry; hardware-backed key; OS code signing; Docker image; shared crate with the desktop node (decided against).
