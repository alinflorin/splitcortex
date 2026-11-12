# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

SplitCortex is a SaaS platform for reusing mobile compute devices (phones, Raspberry Pis, etc.) as inference serving nodes. See [README.md](README.md) for the product overview.

The repository is currently empty apart from docs. Update the "Commands" and "Layout" sections below as code lands.

## Tech stack

**Frontend (decided)**: Vite, React, TypeScript, Fluent UI (React), react-hook-form, zod.

- Forms use react-hook-form with zod schemas (via `@hookform/resolvers/zod`). Share zod schemas for API payloads where possible.
- Use Fluent UI components for all UI; do not introduce another component library.
- TypeScript strict mode; no `any`.

**Endpoint app (decided)**: React Native with Expo, TypeScript. It runs on the phone as the inference node and connects to the gateway.

- Dev setup only for now: run on a physical device. **No EAS builds**; build locally (`expo prebuild` / `expo run:android` or `expo run:ios`).
- LiteRT-LM needs native code, so Expo Go will not work. Use a local development build with a custom native module (Expo Modules API) wrapping LiteRT-LM. Keep that module behind the engine interface.
- Enrollment UI: accepts a typed short code (always) or a scanned QR (when a camera works), with an editable enrollment URL (the control plane / BFF, not the gateway). See Security for the protocol.
- The app must keep the TLS connection to the gateway alive while serving; mobile OS background limits (Android foreground service, iOS suspension) are a known risk to investigate early.

**Backend (decided)**: two deployables with different languages.

- **Control plane: TypeScript + Fastify.** Accounts, orgs, memberships, pools, keys, config, dashboards, enrollment, benchmarks. Shares zod schemas and inferred types with the frontend through a workspace package (e.g. `packages/shared`); validate every request/response at the Fastify edge with them (e.g. `fastify-type-provider-zod`).
- **Gateway: Rust**, for performance. It terminates the OpenAI-format HTTP/SSE edge and the node WebSocket (wss) connections, and does auth, limit checks, metering, load balancing and model management on the hot path. Suggested stack (not yet fixed): tokio, axum, tokio-tungstenite or axum WebSocket, rustls, prost for protobuf. It is a long-running process or container; do not use serverless functions anywhere in the backend.
- **The zod schemas are not shared with the gateway.** The cross-language contracts are: (1) the protobuf node protocol (single source, generate TS and Rust code from it), (2) the OpenAI wire format at the gateway edge, (3) the shared data store / internal API between control plane and gateway. Do not duplicate business rules in both languages: the control plane owns all writes to accounts, orgs, pools, keys, limits, enrollment and node registration; the gateway only reads that state (cached) and writes usage records. **Enrollment never touches the gateway**: nodes enroll against the control plane (Fastify/BFF) over HTTPS; the gateway only sees nodes that are already registered.
- **Gateway config cache (decided)**: the gateway keeps node records, pools, models, API key hashes and limits in its own process memory. **No Redis**; the live registry of connected nodes holds socket handles and is in-process by nature. Sync from the control plane's database:
  - The control plane writes a row to a `config_changes` table (seq, entity type, entity id, org id) in the same transaction as every config change. After commit it sends a Postgres `NOTIFY` as a wake-up only (notifications may be lost).
  - On startup the gateway does `LISTEN` first, then reads a consistent snapshot and its change `seq`, then catches up from that `seq`.
  - A single consumer task wakes on `NOTIFY` or a short poll (~5s), reads changes after its last `seq` with a small overlap window (sequence values can commit out of order), de-duplicates by entity, **re-fetches the current row** (never applies diffs; a missing row means delete), and swaps it into memory. Re-applying is idempotent.
  - If the gateway sees a gap, or was disconnected longer than the log retention, it does a full resync.
  - Applying a change has side effects on live state: a deleted, revoked, re-keyed or unapproved node has its socket closed immediately; a pool change moves its registry entry; a revoked API key rejects new requests at once.
  - If the database is unreachable the gateway keeps serving the last known config, exposes the feed lag as a metric, and may fail closed after a configurable maximum staleness.
  - **API keys in memory**: the cache maps `hash(key)` to org, pool, limits and status. Keys are long random secrets with a readable prefix and a key id (for display and revocation), so a fast hash (SHA-256) is sufficient; compare in constant time. Only hashes are ever stored or cached, never the secret. A cache miss falls back to one database lookup (so a newly created key works immediately, before the change event arrives), with a short negative cache to blunt invalid-key floods. Revocation arrives through the change feed and takes effect for new requests at once.
  - Usage counters and rate-limit state are also in gateway memory, flushed to `usage_records` in batches (limits are approximate across instances within the flush interval).
  - A shared store (Redis) or broker (NATS) is only considered for multi-gateway presence/forwarding, never for config or the live registry.
- The OpenAI handler and the node registry must stay in the same gateway process (see Architecture rules).
- Still open: database, ORM/query layer, auth/session mechanism for the web app, monorepo tooling (pnpm workspaces plus a Cargo workspace), PAKE library availability in Node (server side) and React Native (device side), see Security.

## Domain model

- **User**: registers an account.
- **Organisation**: created by users; has members with roles (membership management).
- **Pool**: an inference pool owned by an organisation; contains device nodes and serves a set of models.
- **Node / device**: a phone, RPi, etc. registered to a pool. Runs LiteRT-LM.
- **API key**: belongs to an organisation; used by clients to call the gateway.
- **Model**: managed by the platform and replicated onto every node in a pool.
- **Usage record**: token usage per key / pool / org, used for limits and dashboards.

## Architecture rules

- The platform has a **control plane** (Fastify: accounts, orgs, pools, keys, config, dashboards) and an **API gateway** (Rust: auth, limits, metering, load balancing, model management). They are separate services sharing a data store; the gateway never owns configuration data.
- Nodes connect **outbound** to the gateway over a persistent **WebSocket** connection secured with **TLS** (wss), carrying **protobuf** messages. Multiplexing is application-level: every message carries a request id, with credit-based backpressure, ping/pong keepalives and reconnect with resume. The protobuf schema is the versioned node protocol contract; keep it transport-independent. There is **no message broker** for now: the gateway keeps an in-memory registry of connected nodes per pool and relays requests and streamed tokens over the node's stream. Keep the node connection behind a transport interface (e.g. `NodeChannel`) so multi-gateway scaling (shared registry, gateway-to-gateway forwarding, or NATS) can be added later. Never design anything that requires inbound connectivity to a device.
- The gateway exposes the **OpenAI API format** (e.g. `/v1/chat/completions`, `/v1/models`, streaming via SSE) so existing OpenAI clients and SDKs work by changing only the base URL and API key. Keep this wire format at the gateway edge; translate to the internal node protocol behind it.
- The gateway has two distinct legs; do not conflate them. The OpenAI handler and the node registry/sockets must live in the same process (or instance group), so the client-facing endpoint must not be split out into a separate service or function:

  ```
  client ──HTTPS + SSE (OpenAI format)──▶ gateway ──WebSocket + protobuf (wss)──▶ node
          client-initiated, per request                node-initiated, long-lived, multiplexed
  ```

- The web app includes a **performance measurement** feature (e.g. benchmarking nodes and pools: latency, throughput, tokens/sec). Measurements must be scoped by organisation like all other data, and must not log prompts or completions (benchmark prompts excepted if they are platform-supplied).
- Every inference request must be authenticated by API key, checked against limits, routed to a healthy node in the target pool, and metered (tokens in/out).
- **Routing (gateway)**: API key hash, then org, limits and target pool, then a node from the in-memory live registry.
  - **An API key is bound to exactly one pool** (an org that wants several pools creates several keys). This keeps the OpenAI format unchanged: clients only change base URL and key. `/v1/models` lists the models of the key's pool. Resolving the pool by `model` or by an extra header/path is not used for now.
  - The live registry is keyed by `(org, pool)`. A node's org and pool come from its registered record (loaded from the database after proof of key possession), never from messages on the stream.
  - Eligible nodes are connected, healthy, have the requested model ready and have credits. Choose with power-of-two-choices on in-flight requests, weighted by measured tokens/sec (devices vary a lot, so no plain round-robin).
  - Failures: node drops before the first token, retry once on another node; drops mid-stream, end the stream with an error (no silent restart, to avoid double metering); no eligible node, `503` with `Retry-After`; limits exceeded, `429` before any node is touched.
  - The registry is per process. With several gateway instances a request must reach the instance holding the pool's nodes (single instance or sticky routing by pool for now); gateway-to-gateway forwarding is future work behind `NodeChannel`.
- Models are **replicated** per device for now. Keep model placement behind an abstraction so sharding a large model across devices (open research) can be added later without rewriting the gateway.
- **LiteRT-LM** is the only supported engine. Keep the engine behind an interface; do not leak LiteRT-LM specifics into gateway or billing code.
- Tenant isolation is critical: every query, node stream and registry entry must be scoped by organisation.

## Security

- API keys: store only hashes, show the secret once at creation.
- Node authentication must be per-device credentials, revocable individually.
- **Node identity**: each node generates its own public/private key pair on the device. The private key never leaves the device (use the platform secure keystore where possible). On enrollment the node registers its public key with the platform; the gateway authenticates the node by proof of possession of the matching private key (challenge-response signed during or right after the TLS handshake). Identity comes from the registered key, never from messages on the stream.
- **Server identity**: the server has its own key pair. Nodes learn and trust the server's public key (pin it at enrollment) so they can verify the gateway independently of the TLS CA chain.
- **Enrollment** (initiated from the web app, completed on the device):
  - An admin picks a pool in the web app, which creates an enrollment record (org, pool, expiry ~10 min, single-use, attempt-limited) and shows a **short code** formatted `XXXX-XXXXXX` (Crockford base32, no ambiguous characters). The same code is also shown as a QR for devices with a working camera; the QR is only a convenience and carries the enrollment (BFF) URL plus the same code. **Every device must be able to enroll by typing the code** (no camera required).
  - The first part (4 chars) is a lookup id, unique among all active enrollments across organisations (unique index; not reused until expired). The second part (6 chars) is the secret. Store only a verifier/hash of the secret server-side. The code reveals nothing about org or pool before success.
  - The mobile app takes the code and an **enrollment URL (the control plane / BFF), which has a default and is user-editable** (self-hosted or LAN deployments). The node talks to the BFF, never to the gateway, during enrollment; the PAKE rounds run over plain HTTPS request/response, with in-progress PAKE state kept in the database (or another shared store) so any BFF instance can serve any round.
  - Device keys are **never derived from the code**: the device generates its own non-exportable key pair in the secure keystore. The code only authorizes registering that public key.
  - Because the code is short, use a **password-authenticated key exchange (PAKE; CPace or SPAKE2)** keyed by the secret part, so the code authenticates both sides and cannot be attacked offline. Inside the PAKE-protected channel the BFF sends the **gateway's** public key and the gateway wss URL (the device pins the key) and the device sends its public key and device info. The BFF therefore needs to know the gateway's public key (from configuration or the shared store). This is what lets a short code replace a long pinned-key QR. A fake BFF at an edited URL learns nothing from the exchange.
  - Online guessing is bounded: a few attempts per enrollment, then it is invalidated, plus per-IP rate limits. The secret is single-use and consumed in the same transaction that registers the device.
  - Optional per-pool **admin approval**: the device appears as pending in the web app, showing a short fingerprint of its public key for the admin to compare, and is only active once approved.
  - After enrollment the code is dead; each connection authenticates with the signed challenge. Revoking a node means deleting its registered public key.
- Open decisions: PAKE choice and library availability on React Native/Expo (spike early; if no usable library, fall back to TLS with CA validation plus mandatory admin approval, and document the weaker first-contact trust), code length and TTL, whether approval is on by default, bulk code generation for many devices, key algorithm (Ed25519 is the likely default), server key rotation, and whether the key pair is used only for authentication or also to sign messages and model manifests.
- Validate TLS properly on the node connection; no disabled certificate checks, even in dev shortcuts. The node also verifies the gateway against the pinned server key.
- Do not log prompts, completions, or key material.

## Commands

TBD (no stack chosen yet).

## Layout

- `infra/`: Terraform. `dev/` (local provisioning only, never CI), `stg/` and `prd/` (CI-managed), `modules/` (shared). See [infra/README.md](infra/README.md).
- `.github/workflows/terraform.yml`: fmt/validate, then plan and apply per environment.

Everything else TBD.

## Infrastructure (Terraform)

- `dev` is provisioned locally only; it is not in CI and has no GitHub environments. Only `stg` and `prd` run in GitHub Actions.
- CI triggers: PR to `main` (validate + plan, no apply), push to `main` (validate, plan stg and prd, then apply stg, then prd), manual dispatch (env `stg` or `prd`, apply only honoured on `main`). The apply job applies the saved plan from the plan job.
- Two GitHub environment sets per stage: `tf-stg-plan`, `tf-prd-plan` (read-only credentials) and `tf-stg-apply`, `tf-prd-apply` (write credentials; `tf-prd-apply` should require reviewers).
- State backend (decided): HCP Terraform (Terraform Cloud) via a `cloud` block in `stg` and `prd`; workspace names `stg` and `prd`. The organization comes from `TF_CLOUD_ORGANIZATION` (GitHub variable in CI), tokens from the `TF_TOKEN` secret in each GitHub environment. Provider credentials live in the HCP Terraform workspace variables. `dev` stays on local state.
- `infra/modules/platform` installs cluster components via `helm_release` and `kubernetes_*` resources (Traefik, cert-manager, a self-signed `root-ca-issuer` ClusterIssuer, and an optional `letsencrypt` ClusterIssuer behind `enable_letsencrypt` that depends on Traefik and is never enabled in dev; ClusterIssuers use local charts under `platform/charts/` because `kubernetes_manifest` needs CRDs at plan time; only wired into `dev` so far). Modules only declare `required_providers`; each env root configures the `helm` and `kubernetes` providers itself in `providers.tf` because the target cluster differs (dev: local kubeconfig; stg/prd: TBD). Commit `.terraform.lock.hcl`.
- Bootstrap only: no resources yet. Hosting provider is still undecided.

## Working conventions

- **Always keep CLAUDE.md and README.md up to date.** Any change to a decision, architecture, security design, stack, commands or layout must update both files in the same change (CLAUDE.md for rules and constraints, README.md for the product-level overview). Do not leave them stale or contradicting each other or the code.
- Prefer small, focused commits. Do not commit unless asked.
- Open research items (multi-device model sharding) belong in the README roadmap, not as speculative code.
