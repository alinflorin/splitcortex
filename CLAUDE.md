# CLAUDE.md

Rules and decisions that always apply. Long implementation detail lives in [docs/](docs/): read the relevant doc before changing its area, and keep it up to date.

## Project

SplitCortex: SaaS platform that reuses compute devices (phones, Raspberry Pis, laptops, browsers) as inference serving nodes. Product overview: [README.md](README.md).

**Business model (decided)**: bring-your-own-devices SaaS. Customers enroll their own devices into their org's pools; we run the control plane and gateway; pricing per device/pool with a free tier (not set). **Not chosen**: selling inference from our own devices (cents per device per day) and a public contributor/consumer marketplace (cold start, payouts/KYC, fraud, prompts on strangers' devices). Do not build marketplace, payout or commission features. Only if demand appears: an invite-only mode where trusted members contribute to one org's pool. Reasoning: README "Business model".

## Tech stack

**Frontend (`src/ui`, pnpm)**: Vite, React, TypeScript (strict, no `any`), Fluent UI React (the only component library), react-hook-form + zod (`@hookform/resolvers/zod`; zod messages are i18n keys), React Router, react-i18next (en + ro), TanStack Query, Vitest + RTL, Dex OIDC via `react-oidc-context`. **Cards, never tables or data grids.** Navigation in the sidebar. **No CDNs, ever** (fonts, scripts, icons; fonts self-hosted). Light, airy design (hairline borders, no heavy shadows). [docs/ui.md](docs/ui.md).

**Mobile node (`src/mobile-node`, own pnpm project)**: React Native + Expo (SDK 58, Expo Router, `expo-dev-client`), TypeScript. Fluent UI is DOM-only, so it reuses only the Fluent design tokens with thin own components; no other component library. Jest. Local dev builds only: **no EAS, no Expo Go**. Engine (LiteRT-LM via third-party `react-native-litert-lm`) sits behind an interface; the TLS connection to the gateway must stay alive while serving. Android background service (foreground service + headless JS, boot start) and native telemetry live in a local Expo module. **iOS is foreground-only** (nothing built or run on iOS). Identity key is Ed25519 in `expo-secure-store` (no hardware keys). Compute backend, context window, MTP, keep-screen-on: admin override per device (`NodeConfig`) > app setting > automatic. Run on real Android devices by the owner (boot start and OEM battery limits not recorded). [docs/node-app.md](docs/node-app.md).

**Web node (`src/web-node`, own pnpm project)**: static web app at `web-node.<domain>`, same stack/look as the UI. A browser tab enrolls (code typed in; `#code=` still accepted but nothing links to it) and serves like a phone node: protobuf-over-wss, signed model download from the control plane into OPFS, engine = LiteRT-LM JS/WASM/WebGPU behind `Engine`. Its host also routes `/api` to the control plane (same origin, **no CORS**). The web app's `AppDownloads` section links mobile/desktop/CLI releases (`releases?q=<stream>&expanded=true`), inert store buttons, install one-liners, web node open/share. Foreground only; run in real browsers by the owner. [docs/web-node.md](docs/web-node.md).

**Desktop node (`src/desktop-node`, own pnpm project)**: Tauri 2 (Linux x64/arm64, macOS arm64, Windows x64). Web side = the web node's code ported; native side in Rust (`src-tauri`): engine = official LiteRT-LM C API loaded at run time with `libloading` (library fetched by `scripts/fetch-litert.mjs`, pinned SHA-256; **none for macOS x64, so not built**), model files and device key on disk (key mode 0600), control plane calls via Tauri's HTTP client (no CORS), tray with close-to-tray, sleep prevention, autostart. Releases: tag `desktop-node-vX.Y.Z` (own stream, **not** "latest"; updater reads `latest.json` from rolling release `desktop-node-updater`; secrets `DESKTOP_NODE_SIGNING_PRIVATE_KEY[_PASSWORD]`); no release-cache workflow. Run on real laptops by the owner (OS/results not recorded). [docs/desktop-node.md](docs/desktop-node.md).

**CLI node (`src/cli-node`, Rust only, no pnpm)**: headless sibling of the desktop node (same platforms): `join`, `run`, `service install` (systemd user unit / launchd agent / scheduled task), `update`. **Completely separate from the desktop node (no shared crate)**: engine binding (`engine/ffi.rs`, fetched by `scripts/fetch-litert.py`, same pinned SHA-256) is a copy; enrollment crypto (CPace ristretto255, checked byte for byte against `@cipherman/pake-js`), gateway handshake, model manager and runtime are Rust ports of the desktop node's TypeScript, so **a fix in one must be made in the other**. Protobuf generated from `src/gateway/proto` by `build.rs` (`protox` + `prost`). Releases: tag `cli-node-vX.Y.Z` (own stream, not "latest"; archives `splitcortex-node-<target>.tar.gz|zip` + `.sha256`, library next to the binary; no secrets). Installed by `src/cli-node/install.sh` / `install.ps1` served from GitHub raw (`raw.githubusercontent.com/alinflorin/splitcortex/main/src/cli-node/`), shown in the web app's *Command line* card. `install.ps1` not verified. [docs/cli-node.md](docs/cli-node.md).

**End-to-end tests (`e2e/`, own pnpm project)**: Playwright Test as the only runner, four projects (`platform` browser, `cli` binary, `desktop` Tauri via `tauri-driver` + WebdriverIO `remote()`, `mobile` Maestro on Android) against a **deployed stack**, **local nip.io by default** (`pnpm dev` asks for the Dex login), `E2E_APP_URL` overrides; the workflow targets staging. Signs in to Dex headlessly with the **stg password user** (`E2E_EMAIL`/`E2E_PASSWORD` `stg` environment secrets; `deploy.yaml` bcrypt-hashes the password into `values-stg.yaml`'s Dex `staticPasswords`; no such user in prd). One workflow `e2e.yaml` (nightly + manual, default staging) runs the four in parallel against the newest released node builds. [docs/e2e.md](docs/e2e.md).

**Backend**: two deployables, long-running processes, **no serverless functions anywhere**.

- **Control plane (`src/control-plane`, TypeScript + Fastify 5 + `fastify-type-provider-zod`)**: accounts, orgs, memberships, pools, nodes, models, keys, config, dashboards, enrollment, benchmarks, rate limits. Postgres via Drizzle (plain SQL migrations in `drizzle/`, never edit applied ones; expand/contract only), DTOs in `src/dto` (no shared package; the UI copies by hand), Dex JWT auth (no users table), routes under `/api`, tests on PGlite. Models in Garage object storage (uploads streamed through the control plane; **nodes download their pool's model from the control plane**, `GET /api/node/models[/:id/file]`, authenticated by a per-request Ed25519 signature of the device key; daily CronJob `control-plane-sweep` aborts abandoned multipart uploads). [docs/control-plane.md](docs/control-plane.md).
- **Gateway (`src/gateway`, Rust)**: OpenAI-format HTTP/SSE edge + node WebSocket (wss), auth, limits (per-key/org, 429), metering, load balancing, model management, benchmarks, connection resume, graceful drain (running requests finish, up to 1 h), several instances (internal forwarding port), key rotation. Stack: tokio, axum, rustls, prost. [docs/gateway.md](docs/gateway.md).
- **Ownership**: the control plane owns all writes to accounts, orgs, pools, keys, limits, enrollment and node registration. The gateway only reads that state (cached) and writes `usage_records`, `node_status`, `gateway_instances` and benchmark results. **Enrollment never touches the gateway.** Do not duplicate business rules in both languages.
- **Cross-language contracts** (zod schemas are not shared with the gateway): (1) the protobuf node protocol, (2) the OpenAI wire format, (3) the shared data store.
- **Gateway config cache (decided)**: node records, pools, models, API-key hashes and limits live in gateway memory, fed by a `config_changes` table plus Postgres `LISTEN/NOTIFY` (re-fetch the row, never apply diffs; missing row = delete; full resync on a gap). **No Redis.** Usage counters flush to `usage_records` in additive batches (fail closed with `503` when the buffer is full or stale). Prometheus/OTel deferred.

## Domain model

- **User** registers an account. **Organisation**: created by users, members with roles.
- **Pool**: owned by an org, contains nodes, **serves exactly one model** (assigning another replaces it; every node holds it, serving type `replicated`).
- **Node/device**: phone, RPi, laptop, browser tab… registered to a pool, runs LiteRT-LM.
- **API key**: belongs to an org, scoped to the whole org or chosen pools.
- **Model**: owned by an org (`.litertlm` in object storage, from a Hugging Face URL or upload), assigned to pools.
- **Usage record**: tokens per key/pool/org, for limits and dashboards.

## Architecture rules

- Nodes connect **outbound** to the gateway over a persistent **WebSocket** with **TLS** (wss) carrying **protobuf**. Multiplexing is application-level: every message carries a request id, credit-based backpressure, ping/pong, reconnect with resume. The protobuf schema is the versioned, transport-independent node contract. **The proto lives in `src/gateway/proto`** (so the gateway's Docker context stays its own folder); phone, web and desktop nodes each commit a generated TS copy (`pnpm gen:proto`); the CLI node generates Rust at build time. **No message broker**: the gateway keeps an in-memory registry of connected nodes per pool and relays requests/tokens over the node's stream. Keep the connection behind a transport interface (`NodeChannel`) so multi-gateway scaling can be added later. Never require inbound connectivity to a device.
- The gateway exposes the **OpenAI API format** (`/v1/chat/completions`, `/v1/models`, SSE) so clients only change base URL and key. Translate to the node protocol behind it.
- Two distinct legs; do not conflate them, and keep the OpenAI handler and the node registry in the same process (or instance group):

  ```
  client ──HTTPS + SSE (OpenAI format)──▶ gateway ──WebSocket + protobuf (wss)──▶ node
          client-initiated, per request                node-initiated, long-lived, multiplexed
  ```

- Every inference request is authenticated by API key, checked against limits, routed to a healthy node in the target pool, and metered (tokens in/out). **Routing**: key hash → org, limits, pool (resolved from `model`) → node from the in-memory registry keyed by `(org, pool)`. Details: [docs/gateway.md](docs/gateway.md).
- The web app has a **performance measurement** feature (benchmarks: latency, throughput, tokens/sec), scoped by org, never logging prompts or completions (platform-supplied benchmark prompts excepted).
- Models are replicated per device; keep placement behind an abstraction so sharding can be added later. **LiteRT-LM is the only engine**; keep it behind an interface and out of gateway/billing code.
- Tenant isolation is critical: every query, node stream and registry entry is scoped by organisation.

## Security

- API keys: store only hashes, show the secret once.
- Per-device credentials, individually revocable.
- **Node identity**: each node generates its own key pair; the private key never leaves the device (secure keystore where possible). Enrollment registers the public key; the gateway authenticates by proof of possession (mutual challenge-response on connect: the node first verifies the gateway's signature against the pinned key, then signs). Identity comes from the registered key, never from stream messages.
- **Server identity**: the gateway has its own key pair; nodes pin its public key at enrollment and verify the gateway independently of the TLS CA chain. Created once by a Helm hook Job into two k8s Secrets (private for the gateway, public for the control plane), never rotated by upgrades, never in a committed file. [docs/gateway.md](docs/gateway.md).
- **Enrollment**: admin creates a code `XXXX-XXXXXX` (10 min, single use, 3 attempts, generic 404 on every failure, per-IP limit) plus a QR; the device can always type it. CPace PAKE keyed by the secret part carries the device public key and the gateway's pinned key and wss URL; device keys are never derived from the code; optional per-pool admin approval. [docs/enrollment.md](docs/enrollment.md).
- Validate TLS properly on the node connection; no disabled certificate checks, even in dev.
- Do not log prompts, completions or key material.

## Domains

| Service | local | stg | prd |
| --- | --- | --- | --- |
| Dex | `dex.splitcortex.127.0.0.1.nip.io` | `dex.stg.splitcortex.alinflorinciu.qoffice.ro` | `dex.prd.splitcortex.com` |
| Web app | `app.splitcortex.127.0.0.1.nip.io` (Vite standalone `:5173`) | `app.stg.splitcortex.alinflorinciu.qoffice.ro` | `app.prd.splitcortex.com` (assumed) |
| Web node | `web-node.splitcortex.127.0.0.1.nip.io` (Vite standalone `:5174`) | `web-node.stg.splitcortex.alinflorinciu.qoffice.ro` | `web-node.prd.splitcortex.com` (assumed) |

Control plane at `/api` on the web app and web node hosts (Swagger at `/api/docs`). Staging gateway: `gateway.stg.splitcortex.alinflorinciu.qoffice.ro` (wss `/node`); prd gateway hostname TBD. Local uses `root-ca-issuer`; stg/prd use `letsencrypt` and need DNS to the Traefik load balancer.

## Commands

CI/CD, release streams, deploy: [docs/commands-and-ci.md](docs/commands-and-ci.md).

- Chart: `helm lint chart --strict [-f chart/values-stg.yaml]`, `helm template`. Local stack: `tilt up` at the root (`--wait` required for the install because of the ClusterIssuer hooks).
- `src/ui`, `src/web-node`, `src/desktop-node`, `src/control-plane`, `src/mobile-node` are each their own pnpm project: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm format` (run before committing; Prettier config at repo root). UI/web node/control plane: `pnpm dev`/`pnpm build`; control plane also `pnpm db:generate`/`pnpm db:migrate`; mobile: `pnpm exec expo export --platform android`, `expo run:android`.
- `e2e`: `pnpm install`, `pnpm dev [playwright args]` (asks for the login, runs against local), `pnpm test[:platform|:cli|:desktop|:mobile]` (needs `E2E_EMAIL`/`E2E_PASSWORD`), `pnpm typecheck`, `pnpm format`.
- `src/cli-node`: `cargo fmt`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, `cargo build --release` (`python3 scripts/fetch-litert.py` first).
- Releases: server tags `vX.Y.Z` (lockstep chart/ui/control-plane/gateway; same build promoted stg → prd), `mobile-node-v…`, `desktop-node-v…`, `cli-node-v…`. Versions = tag without `v`. **Push release tags one at a time** (separate `git push origin <tag>`, seconds apart): GitHub fires no tag workflows when more than 3 tags arrive in one push.
- **"Release everything"** (when the user says this): (1) make sure `main` is pushed and clean; (2) find the next **common** version: the highest `X.Y.Z` among `v*`, `mobile-node-v*`, `desktop-node-v*`, `cli-node-v*` plus one patch (ask if a minor/major bump seems intended); (3) create all four tags with that same version (`vX.Y.Z`, `mobile-node-vX.Y.Z`, `desktop-node-vX.Y.Z`, `cli-node-vX.Y.Z`) on the `main` HEAD; (4) push the tags **one by one** (separate `git push origin <tag>`, a few seconds apart); (5) then check the release runs.

## Layout

`e2e/` (end-to-end tests), `chart/` (Helm: Traefik, cert-manager, Dex, Postgres, Garage, our services; `values.yaml` = local dev, `values-stg.yaml`/`values-prd.yaml` layer on top; [docs/layout.md](docs/layout.md)), `src/{ui,web-node,desktop-node,cli-node,control-plane,mobile-node,gateway}`, `scripts/` (dev helpers).

## Working conventions

- **No resource requests or limits anywhere in the chart.**
- **Every new deployable ships with**: (1) `Dockerfile` (non-root, health endpoint); (2) chart templates `<svc>-deployment|service|ingress.yaml` under a `<svc>:` values block with `enabled` (per-env host/TLS/issuer overrides in stg/prd values); (3) Tiltfile entry (`docker_build`, `k8s_yaml` from `helm template --show-only`, `k8s_resource` with `resource_deps=['chart']`) and `--set <svc>.enabled=false` on the chart install; (4) CLAUDE.md and README updates. The UI is the reference.
- **Tilt uses a dev image**: `Dockerfile.dev` (hot-reload server on the same container port as production, with `/healthz`) plus `live_update` in the Tiltfile. Dev-only chart overrides go in the Tiltfile's `--set`, never in `values.yaml`.
- **Image names**: local = bare `splitcortex/<svc>` (chart default, must equal the Tiltfile `docker_build` name); stg/prd override `<svc>.image.repository` to `ghcr.io/alinflorin/splitcortex-<svc>`; tag defaults to `appVersion`.
- **Keep CLAUDE.md and README.md up to date** in the same change as any decision, architecture, security, stack, command or layout change (CLAUDE.md for rules, README for product overview).
- Small focused commits; do not commit unless asked.
- Open research (multi-device sharding) belongs in the README roadmap, not as speculative code. Direction: only an opt-in **local cluster mode** (same-LAN nodes as one logical node behind `NodeChannel`/placement), never across the internet; stay on Google's runtime (custom pipeline on LiteRT behind the engine interface, no llama.cpp). Not built; see README roadmap.
