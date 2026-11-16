# CLI node (`src/cli-node`) details

Summary in [CLAUDE.md](../CLAUDE.md). A **headless, Rust-only node for Linux, macOS and Windows**: the same job as the [desktop node](desktop-node.md) and the phone node (enroll with a code, connect out to the gateway, download the pool's model, serve requests), without a window, for servers and screenless computers. One static binary plus the engine library, installed by a script from this repository.

**Separate from the desktop node on purpose.** The two share no code: `src/cli-node/src/engine/` is a copy of `src/desktop-node/src-tauri/src/engine/` (the LiteRT-LM binding), `storage.rs`/`system.rs` are adapted copies, and `crypto.rs`, `handshake.rs`, `connection.rs`, `enroll.rs`, `models.rs`, `runtime.rs` and `engine/compute.rs` are Rust ports of the desktop node's TypeScript (`enrollment/crypto.ts`, `protocol/handshake.ts`, `protocol/connection.ts`, `enrollment/client.ts`, `models/manager.ts`, `runtime/NodeRuntime.ts`, `engine/compute.ts`). **A fix to the engine binding, the handshake or the enrollment crypto must be made in both places.** Contracts that must stay identical: the protobuf (generated from `src/gateway/proto` by `build.rs`, no copy), the enrollment crypto (control plane `src/control-plane/src/enrollment/crypto.ts`) and the handshake labels (`src/gateway/src/node_ws.rs`).

## Stack and layout

- Rust (edition 2024), `tokio`, `tokio-tungstenite` (wss), `reqwest` (HTTPS, **rustls with the OS root certificates**, no OpenSSL), `prost` (the node protocol, built by `build.rs` with `protox`: no protoc), `curve25519-dalek` + `sha2` (CPace), `ed25519-dalek`, `hkdf`, `chacha20poly1305`, `libloading`, `clap`, `sysinfo`, `keepawake`. No CORS concern (it is not a browser).
- `src/main.rs` (commands), `runtime.rs` (the service loop), `connection.rs` (gateway link), `enroll.rs` + `crypto.rs` (enrollment), `handshake.rs` (signatures), `models.rs` (download/verify/load), `engine/` (`mod.rs` + `ffi.rs` binding, `compute.rs` policy), `storage.rs`, `settings.rs`, `system.rs`, `service.rs` (background service), `update.rs` (self-update).
- Scripts: `scripts/fetch-litert.py` (same pinned LiteRT-LM v0.19.1 zip and SHA-256 as the desktop node; bump both together), `scripts/set-version.py`, `scripts/package.py`. `install.sh` / `install.ps1` are the installers.

## Commands

`splitcortex-node join [--url <web app address>] [--code XXXX-XXXXXX]` (asks for what is missing; `SPLITCORTEX_URL` also sets the address; `https://host` and `https://host/api` both work), `run` (foreground, Ctrl+C or SIGTERM stops it; waits for admin approval if the pool needs it), `status`, `leave` (forgets the enrollment and the device key), `config [--compute auto|cpu|gpu] [--context N] [--keep-awake true|false]`, `update [--check]`, `service install|uninstall|status`. The admin override from the web app (backend, context window, MTP, keep awake) wins over `config`, field by field, like on the other nodes. Reported platform: `cli`. Logs go to stderr (`RUST_LOG` sets the level); prompts and completions are never logged.

## State and engine

- Data directory (`directories` crate, `SPLITCORTEX_HOME` overrides it; `<home>/data` and `<home>/cache`): `models/`, `secrets/device-key` (mode 0600, directory 0700 on Unix; Windows relies on the user profile's ACL), `enrollment.json`, `settings.json`, `backend-bench.json`. The device key is a software Ed25519 key like the other nodes'.
- Engine: the binding and policy are the desktop node's (see [desktop-node.md](desktop-node.md) for the C API, the fallbacks and the unverified points). The library is found at `litert/` **next to the executable** (symlinks are resolved) or via `SPLITCORTEX_LITERT_LIB`. `cargo test` loads the real library when `scripts/fetch-litert.py` was run (`the_shipped_library_has_every_function`). **Not verified: any generation against a real model on any OS.**
- Requests: one at a time (`busy` otherwise), chunks/done/error carry a `seq` and stay in an outbox for 60 s so a reconnect resumes (`Resume`/`ResumeAck`); running requests are given up after 40 s without a gateway.

## Install, service, update

- **Install**: `curl -fsSL https://raw.githubusercontent.com/alinflorin/splitcortex/main/src/cli-node/install.sh | sh` (Linux x64/arm64, macOS Apple silicon) and `irm https://raw.githubusercontent.com/alinflorin/splitcortex/main/src/cli-node/install.ps1 | iex` (Windows x64); these two lines are what the web app's *Command line* card shows with copy buttons. The script finds the newest `cli-node-v*` release through the GitHub API (not `releases/latest`, which is the server's), downloads `splitcortex-node-<target>.tar.gz` (`.zip` on Windows) and its `.sha256`, verifies it and unpacks it into `~/.local/lib/splitcortex-node` (`%LOCALAPPDATA%\Programs\SplitCortexNode` on Windows) with a link in `~/.local/bin` (Windows: the folder is added to the user PATH). `SPLITCORTEX_VERSION` pins a version, `SPLITCORTEX_INSTALL_DIR`/`SPLITCORTEX_BIN_DIR` move it. Files fetched with `curl`/`irm` carry no quarantine mark, so macOS Gatekeeper and Windows SmartScreen do not block the unsigned binary (a browser download would be). Served from GitHub raw, so it works without the platform being up and follows `main`.
- **Service**: `service install` writes a systemd **user** unit on Linux (`loginctl enable-linger` keeps it running when logged out), a launchd agent on macOS (log in the cache directory), a scheduled task at logon on Windows (log in the cache directory). It starts `splitcortex-node run`.
- **Update**: `update` queries the releases, takes the newest published `cli-node-vX.Y.Z` (ignores drafts, pre-releases and other streams), verifies the checksum and replaces the binary and the library in place (Windows moves the running `.exe` aside to `.old`, removed on the next start). Restart the node afterwards.

## Release and CI

- **Tag `cli-node-vX.Y.Z`** (own stream, independent of `vX.Y.Z`, `mobile-node-v*` and `desktop-node-v*`; tags by hand). `.github/workflows/cli-node-release.yaml` creates the GitHub release (**not** latest), then builds on linux x64 (`ubuntu-22.04`), linux arm64 (`ubuntu-22.04-arm`), macOS arm64 and Windows x64: `set-version.py` (version = tag), `fetch-litert.py --required`, `cargo build --release --target`, `package.py` (binary + `litert/<library>` at the archive's top level, `.sha256`), `gh release upload`. No macOS Intel (no LiteRT-LM library). No release-cache workflow. No signing key or secret is needed.
- **CI** `cli-node.yaml` (path filter includes `src/gateway/proto/**`): on the same four platforms `cargo fmt --check`, `cargo clippy --all-targets -D warnings`, `cargo test` (with the library fetched), plus `shellcheck install.sh` on Linux. No image, no deploy, no chart, no Tiltfile entry (not a deployed service).

## Verified and not

Verified here (Linux x64): unit tests (crypto, handshake, storage, settings, update parsing), the **CPace implementation against `@cipherman/pake-js` byte for byte** (fixed scalars; the control plane and the web side run that library), the **connection against a fake gateway** (handshake, key pinning refusal, ping/pong), a smoke test of the commands, `install.sh` end to end against a local server with a packaged release build. **Not verified**: enrollment against a running control plane, a session against the real gateway, generation on a real model, the Windows and macOS builds (CI compiles them), `install.ps1` (never run), service install on any OS, `update` against a real release.

## Not built / open

macOS Intel; battery and temperature telemetry; hardware-backed key; OS code signing; a Docker image for the CLI node; a shared crate with the desktop node (decided against for now).
