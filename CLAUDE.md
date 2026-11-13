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
  - The control plane writes a row to a `config_changes` table (seq, entity type, entity id, org id) in the same transaction as every config change. After commit it sends a Postgres `NOTIFY` (push, wake-up only; notifications may be lost) whose payload carries the new `seq`. A `seq` jump versus the gateway's cursor means a missed notification and triggers an immediate catch-up.
  - On startup the gateway does `LISTEN` first, then reads a consistent snapshot and its change `seq`, then catches up from that `seq`.
  - A single consumer task wakes on `NOTIFY`, on `LISTEN` reconnect (immediate catch-up), or on a 30s backstop poll, reads changes after its last `seq` with a small overlap window (sequence values can commit out of order), de-duplicates by entity, **re-fetches the current row** (never applies diffs; a missing row means delete), and swaps it into memory. Re-applying is idempotent.
  - If the gateway sees a gap, or was disconnected longer than the log retention, it does a full resync.
  - Applying a change has side effects on live state: a deleted, revoked, re-keyed or unapproved node has its socket closed immediately; a pool change moves its registry entry; a revoked API key rejects new requests at once.
  - If the database is unreachable the gateway keeps serving the last known config, exposes the feed lag as a metric, and may fail closed after a configurable maximum staleness.
  - **API keys in memory**: the cache maps `hash(key)` to org, pool, limits and status. Keys are long random secrets with a readable prefix and a key id (for display and revocation), so a fast hash (SHA-256) is sufficient; compare in constant time. Only hashes are ever stored or cached, never the secret. A cache miss falls back to one database lookup (so a newly created key works immediately, before the change event arrives), with a short negative cache to blunt invalid-key floods. Revocation arrives through the change feed and takes effect for new requests at once.
  - Usage counters and rate-limit state are also in gateway memory, flushed to `usage_records` in batches (limits are approximate across instances within the flush interval).
  - Usage records are the only metering store: counters keyed by (minute bucket, org, pool, key id, model) with tokens in/out, requests and errors, flushed with an additive upsert (`ON CONFLICT DO UPDATE SET x = x + EXCLUDED.x`) so several instances add up. The gateway counts tokens itself; node-reported counts are never trusted for metering. **Prometheus and OpenTelemetry are deliberately deferred** (decided not to add them yet); if added later, never use API key or org as a metric label, and never put prompts or completions in spans.
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

## Domains

| Service | local | stg | prd |
| --- | --- | --- | --- |
| Dex (IdP) | `dex.splitcortex.127.0.0.1.nip.io` | `dex.stg.splitcortex.com` | `dex.prd.splitcortex.com` |
| Web app | `app.splitcortex.127.0.0.1.nip.io` (planned, no ingress yet) | TBD | TBD |

Control plane and gateway hostnames are TBD. Local uses `root-ca-issuer` (self-signed); stg/prd use `letsencrypt` and need DNS pointing at the Traefik load balancer.

## Commands

- Helm chart: `helm lint chart --strict [-f chart/values-stg.yaml]` and `helm template` with the same flags. Local dev install (`--wait` is required so the ClusterIssuer hooks run after the cert-manager webhook is ready): `helm upgrade -i --wait --timeout 5m --create-namespace -n splitcortex -f chart/values-local.yaml splitcortex chart`.

- Tilt: `tilt up` at the repo root uses the root `Tiltfile` (k3s context `default`, Docker registry `localhost:5000` mirrored in k3s `registries.yaml`). It currently installs the infra chart as a `chart` local_resource via `helm upgrade -i --wait` (not tilt's `helm()`, because of the ClusterIssuer hooks); service `docker_build`s are commented placeholders until code lands.

- CI/CD: `.github/workflows/chart.yaml` lints (`--strict`), renders and kubeconform-validates the chart for each of dev/stg/prd on PRs and pushes to `main`. Pushing a tag `vX.Y.Z` packages the chart and pushes it to `oci://ghcr.io/<owner>/charts`. Chart dependencies (`~/.cache/helm`, `chart/charts`) and the kubeconform binary are cached with `actions/cache`, keyed on `Chart.yaml`/`Chart.lock`. Keep action versions on the latest major.

Other commands TBD as code lands.

## Layout

- `chart/`: Helm chart, currently a **skeleton**: `Chart.yaml`, `templates/_helpers.tpl` (naming/label helpers) and empty `values.yaml` (local dev), `values-stg.yaml`, `values-prd.yaml` (overrides layered with `-f`), plus an optional git-ignored `values-local.yaml` for personal local overrides. It depends on the official **Traefik** chart (`traefik/traefik` 42.4.0 from https://traefik.github.io/charts, toggle with `traefik.enabled`, default on) and **cert-manager** (`jetstack/cert-manager` v1.21.3 from https://charts.jetstack.io, toggle with `cert-manager.enabled`, default on, CRDs enabled in `values.yaml`). **Dex** IdP (`dex/dex` 0.26.0 from https://charts.dexidp.io, toggle with `dex.enabled`; `image.tag: latest` with `pullPolicy: Always` (moving tag, not reproducible; pin a version tag if that matters); `enablePasswordDB: true`, `expiry.idTokens: 15m` (Dex access tokens), refresh tokens 2160h (~3 months) for both `validIfNotUsedFor` and `absoluteLifetime`, Kubernetes storage; exposed through Traefik ingress at `https://dex.splitcortex.127.0.0.1.nip.io` (issuer URL; TLS from `root-ca-issuer`, `rate-limit-general` middleware, which assumes namespace `splitcortex`; stg/prd override this to `https://dex.stg.splitcortex.com` / `https://dex.prd.splitcortex.com` with the `letsencrypt` ClusterIssuer); the initial user `alinflorinciu@icloud.com` with a bcrypt hash is only in git-ignored `values-local.yaml`). **PostgreSQL** (`groundhog2k/postgres` 1.6.8 from https://groundhog2k.github.io/helm-charts/, toggle with `postgres.enabled`; service name `postgres`). `templates/postgres-credentials.yaml` generates the random superuser and app-user passwords once (reused on upgrade via `lookup`) into the fixed-name Secret `postgres-credentials` (kept on uninstall, matching the retained PVC), which also carries a ready `DATABASE_URL`; the subchart values only reference that Secret's keys, never passwords. `templates/cluster-issuers.yaml` defines ClusterIssuers as Helm post-install/post-upgrade hooks (CRDs and webhook come from the same release; install with `--wait`; not removed on uninstall): `root-ca-issuer` (CA issuer backed by a self-signed root, via a `selfsigned-issuer` bootstrap) everywhere, and `letsencrypt` (Let's Encrypt **production** ACME, HTTP-01 through Traefik) only in stg/prd, enabled by setting `letsencryptEmail` (the only issuer-related value; in `values-stg.yaml`/`values-prd.yaml` it is the placeholder `"${LETSENCRYPT_EMAIL}"`, substituted at deploy time with `envsubst '$LETSENCRYPT_EMAIL' < chart/values-<env>.yaml` from a CI variable, and the template fails if the placeholder is left in; CI validate substitutes a dummy address; names and settings are hardcoded in the template, do not add issuers to values); `Chart.lock` is committed and `chart/charts/` is git-ignored (run `helm dependency build chart`). Workloads, services, ingress and secrets will be re-added as the services land. Constraints for when they are:
  - Postgres is external; the gateway needs a direct connection (it uses `LISTEN`), not PgBouncer transaction mode.
  - Gateway default is 1 replica (registry is per process; more replicas need sticky routing by pool). The ingress controller is Traefik; SSE and wss must not be cut by Traefik's entryPoint `respondingTimeouts` (static Traefik config).
  - The gateway server private key comes from a Secret mounted as a file; only the public key and wss URL go to the control plane as plain config. Prefer `existingSecret` outside dev; no inline secrets in stg/prd.
  - External ingress / cert-manager are supported. External ingress controller: `traefik.enabled=false`, set `ingress.className` (also used by the ACME HTTP-01 solver) and `dex.ingress.className`, `rateLimit.enabled=false` unless it is Traefik with its CRDs, and replace the `traefik.ingress.kubernetes.io/*` annotations on the Ingresses. External cert-manager: `cert-manager.enabled=false` (CRDs and webhook must already exist; our `root-ca-issuer`/`letsencrypt` names must not clash). To use the external cert-manager's own issuers, also set `clusterIssuers.enabled=false` and point the Ingress `cert-manager.io/cluster-issuer` annotation at them.
  - The Traefik IngressClass is named `traefik` (`traefik.ingressClass.name` in `values.yaml`), independent of the release name; Ingresses and the ClusterIssuer's HTTP-01 solver use it.
  - Traefik rate limits: `templates/rate-limits.yaml` defines Middlewares `rate-limit-general` (per client IP, 50/s burst 100; web app, control plane, Dex) and `rate-limit-gateway` (per `Authorization` header, 2000/s burst 4000, a coarse flood ceiling only; the gateway enforces real per-key limits). Values under `rateLimit`. They are **not** on the entryPoint (that would throttle the gateway): attach per route via `router.middlewares` / IngressRoute. Nothing is attached until routes exist.
  - No Redis, no serverless. Enrollment goes through the control plane ingress, never the gateway.

Other directories TBD.

## Working conventions

- **Always keep CLAUDE.md and README.md up to date.** Any change to a decision, architecture, security design, stack, commands or layout must update both files in the same change (CLAUDE.md for rules and constraints, README.md for the product-level overview). Do not leave them stale or contradicting each other or the code.
- Prefer small, focused commits. Do not commit unless asked.
- Open research items (multi-device model sharding) belong in the README roadmap, not as speculative code.
