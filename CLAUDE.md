# CLAUDE.md

Rules and decisions that always apply. Detail lives in [docs/](docs/): read the relevant doc before changing its area and keep it up to date.

## Project

SplitCortex: SaaS that reuses compute devices (phones, Raspberry Pis, laptops, browsers) as inference serving nodes. Overview: [README.md](README.md).

**Business model (decided)**: bring-your-own-devices SaaS. Customers enroll their own devices into their org's pools; we run the control plane and gateway; pricing per device/pool with a free tier (not set). **Not chosen, do not build**: selling inference from our own devices, a public contributor/consumer marketplace (payouts, KYC, commission). Only if demand appears: an invite-only mode where trusted members contribute to one org's pool.

## Stack (detail in the linked doc)

- **UI `src/ui`** (pnpm): Vite, React, strict TS (no `any`), Fluent UI React only (plus `three` for the landing scroll tour), react-hook-form + zod (messages are i18n keys), React Router, react-i18next (en + ro), TanStack Query, Vitest + RTL, Dex OIDC. **Cards, never tables.** Charts: `@fluentui/react-charts`, live metrics at org/pool/node level. Playground chats with a pool via a user-pasted key through `/v1` on the app's origin (**no CORS on the gateway**). **No CDNs, ever** (fonts self-hosted). Light, airy design. Static images ship Brotli copies (`scripts/precompress.mjs`). [docs/ui.md](docs/ui.md)
- **Mobile node `src/mobile-node`** (own pnpm): Expo SDK 58, React Native, dev builds only (no EAS, no Expo Go). Fluent tokens only, own thin components. Engine behind an interface; Android foreground service + headless JS in a local Expo module; **iOS foreground-only, never built**. Ed25519 key in `expo-secure-store`. Settings precedence: admin `NodeConfig` > app setting > automatic. [docs/node-app.md](docs/node-app.md)
- **Web node `src/web-node`** (own pnpm): static app at `web-node.<domain>`; enrolls by typed code or QR, serves over protobuf/wss, model in OPFS, LiteRT-LM WASM/WebGPU behind `Engine`; routes `/api` same-origin (**no CORS**). Foreground only. [docs/web-node.md](docs/web-node.md)
- **CLI node `src/cli-node`** (Rust only): the only desktop/server node (no GUI app, decided). `join`, `run`, `service install`, `update`. LiteRT-LM C API via `libloading`. Hidden **`run --fake`** = synthetic engine for e2e/perf (no model, no download, rest of the node real; never in customer pools). Port of the web node's TS (enrollment, handshake, models, runtime): keep behaviour equal. Tags `cli-node-vX.Y.Z`. [docs/cli-node.md](docs/cli-node.md)
- **E2E `src/e2e`** (own pnpm, Playwright): runs against `BASE_URL`, signs in through Dex, tests api, ui and every node type, then (last, only if all passed) performance with fake CLI nodes (`perf` project, report-only). [docs/e2e.md](docs/e2e.md)
- **Control plane `src/control-plane`**: TS, Fastify 5, zod, Postgres via Drizzle (plain SQL migrations, never edit applied ones, expand/contract only), DTOs in `src/dto` (UI copies by hand), Dex JWT (no users table), routes under `/api`, tests on PGlite. Models in Garage; **nodes download their pool's model from the control plane**, signed per request by the device key. [docs/control-plane.md](docs/control-plane.md)
- **Gateway `src/gateway`**: Rust, tokio, axum, rustls, prost. OpenAI-format HTTP/SSE edge + node WebSocket, auth, limits, metering, balancing, benchmarks, resume, graceful drain, several instances. [docs/gateway.md](docs/gateway.md)
- No serverless functions anywhere; long-running processes only.

## Decisions

- **Ownership**: the control plane owns all writes to accounts, orgs, pools, keys, limits, enrollment, node registration. The gateway only reads that state (cached) and writes `usage_records`, `pool_metrics`, `node_metrics`, `node_status`, `gateway_instances`, `audit_logs` (own events), benchmark results. **Enrollment never touches the gateway.** No business rules duplicated across languages.
- **Cross-language contracts**: (1) protobuf node protocol, (2) OpenAI wire format, (3) shared data store.
- **API error i18n**: control plane and gateway answer in `Accept-Language` (en, ro; English fallback); OpenAI `code`/`type` stay untranslated. New messages need both languages (`src/i18n/messages.ts`, `src/i18n.rs`). All clients send the header.
- **Audit log**: per org, 90 days, admins/owners only. Control plane records every mutation under `/organisations` in one hook (`plugins/audit.ts`; a new mutating route must be added to its table or the app won't start). Gateway events are batched, **never fail-closed, never one row per request**. No prompts, completions or key material in any row.
- **Per-org metrics**: `pool_metrics`/`node_metrics` in Postgres, written by the gateway in additive batches (never fail-closed, never per request), read by `GET /api/organisations/:orgId/metrics`. Retention 7 days. No OTel on nodes; device numbers ride protobuf `Telemetry`.
- **Gateway config cache**: in memory, fed by `config_changes` + `LISTEN/NOTIFY` (re-fetch the row; full resync on a gap). **No Redis.** Usage counters flush additively; fail closed with `503` when the buffer is full or stale.
- **Multimodal**: images (`image_url` data URL) and audio (`input_audio`) as OpenAI parts, relayed only to nodes whose `ModelState.modalities` allow them, else `400`. The gateway never fetches URLs. No audio/image output, no video, no tool calling.
- **Embeddings**: `/v1/embeddings` for models of `kind = embedding`; a pool serves one model, so embeddings get their own pool. The node writes the task prefix.
- **Remote restart**: the control plane writes `node_commands` + `NOTIFY`; the holding gateway instance delivers protobuf `Restart`. Audited `node.restart`, nothing queued for offline nodes.

## Domain model

User; Organisation (members with roles); **Pool** (org-owned, serves exactly one model, replicated on every node); **Node** (device registered to a pool, runs LiteRT-LM); **API key** (org-scoped, whole org or chosen pools); **Model** (org-owned `.litertlm`, from Hugging Face URL or upload); **Usage record** (tokens per key/pool/org).

## Architecture rules

- Nodes connect **outbound** to the gateway over a persistent TLS WebSocket carrying **protobuf**; app-level multiplexing (request ids, credits, ping/pong, resume). Never require inbound connectivity. The proto lives in `src/gateway/proto`; phone and web nodes commit a generated TS copy (`pnpm gen:proto`), the CLI generates Rust in `build.rs`. **No message broker**: in-memory registry of nodes per `(org, pool)`; keep the connection behind `NodeChannel`.
- Two legs, never conflated: client → gateway (HTTPS + SSE, OpenAI format) and gateway → node (wss + protobuf). The OpenAI handler and node registry live in the same process or instance group.
- Every request: API key → org, limits, pool (from `model`) → healthy node → metering.
- Benchmarks (latency, throughput, tokens/sec) are scoped by org and never log prompts or completions.
- Models are replicated per device; keep placement abstract so sharding can be added. **LiteRT-LM is the only engine**, behind an interface, out of gateway/billing code.
- Tenant isolation is critical: every query, node stream and registry entry is scoped by org.

## Security

- API keys: only hashes stored, secret shown once. Per-device credentials, individually revocable.
- **Node identity**: own key pair, private key never leaves the device; the gateway authenticates by mutual challenge-response (node verifies the gateway's signature against its pinned key first). Identity comes from the registered key, never from stream messages.
- **Gateway identity**: own key pair made once by a Helm hook Job into two k8s Secrets, never rotated by upgrades, never in a committed file. Nodes pin the public key at enrollment.
- **Enrollment**: admin creates a code `XXXX-XXXXXX` (10 min, single use, 3 attempts, generic 404, per-IP limit) plus QR; CPace PAKE carries the device public key, the gateway's key and wss URL; device keys never derived from the code; optional per-pool approval. [docs/enrollment.md](docs/enrollment.md)
- Validate TLS properly everywhere, even in dev. Never log prompts, completions or key material.

## Domains

Local `*.local.splitcortex.com`, stg `*.stg.splitcortex.com`, prd `splitcortex.com`. Web app on the base domain (`local.splitcortex.com`, needs its own A record, a wildcard doesn't cover it); web node `web-node.<env>`; Dex `dex.<env>`; control plane at `/api` on both app hosts (Swagger `/api/docs`); stg gateway `gateway.stg.splitcortex.com` (wss `/node`). One `letsencrypt` issuer with **DNS-01 via Cloudflare** everywhere (no self-signed CA, no HTTP-01); local names resolve to `127.0.0.1` in public DNS. `cloudflareApiToken` is a required chart value (local: git-ignored `chart/values-local.yaml`; stg/prd: `${CLOUDFLARE_TOKEN}` from the GitHub secret).

## Commands

CI/CD, releases, deploy: [docs/commands-and-ci.md](docs/commands-and-ci.md).

- **Test reports**: JUnit XML everywhere, shown on the run with `dorny/test-reporter` (`pnpm test:ci`, `cargo nextest run --profile ci`, Playwright `junit`; Docker unit tests export via the `test-report` stage). [docs/commands-and-ci.md](docs/commands-and-ci.md)
- Chart: `helm lint chart --strict [-f chart/values-stg.yaml]`, `helm template`. Local stack: `tilt up --wait` at the root.
- `src/{ui,web-node,control-plane,mobile-node}` (pnpm): `pnpm install`, `typecheck`, `test`, `format` (before committing; Prettier config at root), `dev`/`build`. Control plane also `db:generate`/`db:migrate`; mobile `expo run:android`.
- `src/cli-node`: `cargo fmt`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, `cargo build --release` (`python3 scripts/fetch-litert.py` first).
- **graphify** (code only, `graphify-out/` git-ignored): run `graphify update .` after changing code; use `graphify query|path|explain` before grepping.
- Releases: server `vX.Y.Z` (chart/ui/control-plane/gateway in lockstep), `mobile-node-v…`, `cli-node-v…`; tags are created by `create-tags.yaml` from `VERSIONS.txt`. **Push release tags one at a time** (more than 3 in one push fire no workflows). **"Release everything"**: ensure `main` is pushed and clean; next common version = highest `X.Y.Z` among the three tag families plus one patch (ask if a minor/major seems intended); write the three tags into `VERSIONS.txt`, push to `main`; then check the runs.

## Layout

`chart/` (Helm), `src/{ui,web-node,cli-node,control-plane,mobile-node,gateway,e2e}`, `scripts/`. [docs/layout.md](docs/layout.md)

## Working conventions

- **No resource requests or limits in the chart.**
- **Every new deployable ships with**: a non-root `Dockerfile` with a health endpoint; chart `<svc>-deployment|service|ingress.yaml` under a `<svc>:` block with `enabled`; a Tiltfile entry (`docker_build`, `k8s_yaml`, `k8s_resource` with `resource_deps=['chart']`) and `--set <svc>.enabled=false` on the chart install; CLAUDE.md and README updates. The UI is the reference.
- Tilt uses `Dockerfile.dev` (hot reload, same port, `/healthz`) plus `live_update`. Dev-only chart overrides go in the Tiltfile's `--set`, never in `values.yaml`.
- Images: local `splitcortex/<svc>`; stg/prd `ghcr.io/alinflorin/splitcortex-<svc>`; tag defaults to `appVersion`.
- Keep CLAUDE.md and README.md current in the same change as any decision, architecture, security, stack, command or layout change.
- Small focused commits; do not commit unless asked.
- Open research (multi-device sharding) lives in the README roadmap and [docs/sharding-research.md](docs/sharding-research.md), not as speculative code. Only an opt-in same-LAN cluster mode, on Google's runtime.
