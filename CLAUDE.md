# CLAUDE.md

Always-on rules. Detail lives in [docs/](docs/): read the relevant doc before changing its area and keep it current.

## Project

SplitCortex: SaaS that reuses devices (phones, Pis, laptops, browsers) as inference nodes. Overview: [README.md](README.md).

**Business model (decided)**: bring-your-own-devices SaaS. Customers enroll their own devices into their org's pools; we run control plane + gateway; pricing per device/pool with a free tier (not set). **Do not build**: selling inference from our own devices, a public contributor/consumer marketplace (payouts, KYC, commission).

## Stack

- **UI `src/ui`** (pnpm): Vite, React, strict TS (no `any`), Fluent UI only (+ `three` for the landing tour), react-hook-form + zod (messages are i18n keys), React Router, react-i18next (en + ro, **both indexed**: English bare, Romanian under `/ro`), TanStack Query, Vitest + RTL, Dex OIDC. **Cards, never tables.** Playground uses a user-pasted key via `/v1` on the app's origin (**no CORS on the gateway**). **No CDNs**, one exception: Google Analytics `gtag.js`, prod only, after cookie consent, page views only (ids stripped, never typed text/prompts/keys/codes). **SEO**: seven public pages (Home, Quick start, Help, About, Terms, Privacy, Contact) prerendered at build; **only prd is indexable**; everything else `noindex`; host filled at runtime. New links to public pages use `useLocalePath()`. [docs/ui.md](docs/ui.md)
- **Mobile node `src/mobile-node`** (pnpm): Expo SDK 58, React Native, dev builds only (no EAS/Expo Go). Fluent tokens only. Engine behind an interface; **iOS foreground-only, never built**. Ed25519 key in `expo-secure-store`. Settings precedence: admin `NodeConfig` > app setting > automatic. [docs/node-app.md](docs/node-app.md)
- **Web node `src/web-node`** (pnpm): static app at `web-node.<domain>`; enrolls by code/QR, protobuf/wss, model in OPFS, LiteRT-LM WASM/WebGPU; `/api` same-origin (**no CORS**). [docs/web-node.md](docs/web-node.md)
- **CLI node `src/cli-node`** (Rust): the only desktop/server node (no GUI, decided). Hidden **`run --fake`** = synthetic engine for e2e/perf (never in customer pools). Port of the web node's TS: keep behaviour equal. [docs/cli-node.md](docs/cli-node.md)
- **E2E `src/e2e`** (pnpm, Playwright): runs against `BASE_URL` through Dex; api, ui, every node type, then report-only `perf`. [docs/e2e.md](docs/e2e.md)
- **Control plane `src/control-plane`**: TS, Fastify 5, zod, Drizzle/Postgres (plain SQL migrations, never edit applied ones, expand/contract only), DTOs in `src/dto` (UI copies by hand), Dex JWT (no users table), routes under `/api`, tests on PGlite. Models in Garage; nodes download their pool's model from the control plane, signed per request by the device key. [docs/control-plane.md](docs/control-plane.md)
- **Gateway `src/gateway`**: Rust, tokio, axum, rustls, prost. OpenAI HTTP/SSE edge + node WebSocket. [docs/gateway.md](docs/gateway.md)
- No serverless; long-running processes only.

## Decisions

- **Ownership**: the control plane owns all writes to accounts, orgs, pools, keys, limits, enrollment, node registration. The gateway reads that state (cached) and writes only `usage_records`, `pool_metrics`, `node_metrics`, `node_status`, `gateway_instances`, `audit_logs` (own events), benchmark results. **Enrollment never touches the gateway.** No business rules duplicated across languages.
- **Contracts across languages**: protobuf node protocol, OpenAI wire format, shared data store.
- **API error i18n**: control plane and gateway answer per `Accept-Language` (en, ro; English fallback); OpenAI `code`/`type` untranslated. New messages need both languages (`src/i18n/messages.ts`, `src/i18n.rs`).
- **Audit log**: per org, 90 days, admins/owners. Control plane records every `/organisations` mutation in one hook (`plugins/audit.ts`; a new mutating route must be added to its table or the app won't start). Gateway events batched, **never fail-closed, never one row per request**. No prompts, completions or key material.
- **Metrics**: written by the gateway in additive batches (never fail-closed, never per request), 7-day retention. No OTel on nodes.
- **Gateway config cache**: in memory, `config_changes` + `LISTEN/NOTIFY`. **No Redis.** Usage counters flush additively; fail closed (`503`) when the buffer is full or stale.
- **Multimodal**: images (`image_url` data URL) and audio (`input_audio`) as OpenAI parts, only to nodes whose `ModelState.modalities` allow them, else `400`. Gateway never fetches URLs. No audio/image output, video or tool calling.
- **Embeddings**: `/v1/embeddings` for `kind = embedding` models; a pool serves one model, so embeddings get their own pool. The node writes the task prefix.
- **Remote restart**: control plane writes `node_commands` + `NOTIFY`; the holding gateway sends protobuf `Restart`. Audited; nothing queued for offline nodes.

## Architecture rules

- Domain: User; Organisation (roles); **Pool** (org-owned, one model, replicated on every node); **Node**; **API key** (whole org or chosen pools); **Model** (org-owned `.litertlm`, from Hugging Face URL or upload); **Usage record**.
- Nodes connect **outbound** to the gateway over a persistent TLS WebSocket carrying **protobuf**. Never require inbound connectivity. Proto in `src/gateway/proto`; phone/web nodes commit generated TS (`pnpm gen:proto`), CLI generates Rust in `build.rs`. **No message broker**: in-memory registry per `(org, pool)` behind `NodeChannel`.
- Two legs, never conflated: client → gateway (HTTPS + SSE, OpenAI format) and gateway → node (wss + protobuf).
- Every request: API key → org, limits, pool (from `model`) → healthy node → metering.
- Benchmarks scoped by org, never log prompts or completions.
- **LiteRT-LM is the only engine**, behind an interface, out of gateway/billing code.
- Tenant isolation is critical: every query, node stream and registry entry is scoped by org.

## Security

- API keys: only hashes stored, secret shown once. Per-device credentials, individually revocable.
- **Node identity**: own key pair, private key never leaves the device; mutual challenge-response (node verifies the gateway's signature against its pinned key first). Identity comes from the registered key, never stream messages.
- **Gateway identity**: key pair made once by a Helm hook Job into k8s Secrets, never rotated by upgrades, never in a committed file. Nodes pin the public key at enrollment.
- **Enrollment**: admin code `XXXX-XXXXXX` (10 min, single use, 3 attempts, generic 404, per-IP limit) plus QR; CPace PAKE; device keys never derived from the code; optional per-pool approval. [docs/enrollment.md](docs/enrollment.md)
- Validate TLS properly everywhere, even in dev. Never log prompts, completions or key material.

## Domains

Local `*.local.splitcortex.com`, stg `*.stg.splitcortex.com`, prd `splitcortex.com`. Web app on the base domain (local needs its own A record); web node `web-node.<env>`; Dex `dex.<env>`; control plane at `/api` on both app hosts (Swagger `/api/docs`); stg gateway `gateway.stg.splitcortex.com` (wss `/node`). One `letsencrypt` issuer, **DNS-01 via Cloudflare** everywhere (no self-signed, no HTTP-01); local names resolve to `127.0.0.1` in public DNS. `cloudflareApiToken` is required (local: git-ignored `chart/values-local.yaml`; stg/prd: `${CLOUDFLARE_TOKEN}`).

## Commands

Details, CI/CD, releases: [docs/commands-and-ci.md](docs/commands-and-ci.md).

- Chart: `helm lint chart --strict [-f chart/values-stg.yaml]`, `helm template`. Local stack: `tilt up --wait`.
- pnpm projects (`src/{ui,web-node,control-plane,mobile-node}`): `install`, `typecheck`, `test`, `format` (before committing), `dev`/`build`.
- `src/cli-node`: `cargo fmt`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (`python3 scripts/fetch-litert.py` first).
- **graphify** (code only, `graphify-out/` git-ignored): `graphify update .` after code changes; `graphify query|path|explain` before grepping.
- Tests report JUnit XML everywhere. Releases: server `vX.Y.Z` (chart/ui/control-plane/gateway lockstep), `mobile-node-v…`, `cli-node-v…`; tags created by `create-tags.yaml` from `VERSIONS.txt`. **Push release tags one at a time** (>3 in one push fire no workflows). **"Release everything"**: `main` pushed and clean; next version = highest `X.Y.Z` among the three tag families + one patch (ask if minor/major seems intended); write the three tags into `VERSIONS.txt`, push to `main`; check the runs.

## Working conventions

- Layout: `chart/`, `src/{ui,web-node,cli-node,control-plane,mobile-node,gateway,e2e}`, `scripts/` ([docs/layout.md](docs/layout.md)).
- **No resource requests or limits in the chart.**
- **Every new deployable ships with**: non-root `Dockerfile` with health endpoint; chart `<svc>-deployment|service|ingress.yaml` under a `<svc>:` block with `enabled`; Tiltfile entry (`docker_build`, `k8s_yaml`, `k8s_resource` with `resource_deps=['chart']`) and `--set <svc>.enabled=false` on the chart install; CLAUDE.md and README updates. The UI is the reference.
- Tilt uses `Dockerfile.dev` (hot reload, `/healthz`) plus `live_update`. Dev-only chart overrides go in the Tiltfile's `--set`, never `values.yaml`.
- Images: local `splitcortex/<svc>`; stg/prd `ghcr.io/alinflorin/splitcortex-<svc>`; tag defaults to `appVersion`.
- Update CLAUDE.md and README.md in the same change as any decision, architecture, security, stack, command or layout change.
- Small focused commits; do not commit unless asked.
