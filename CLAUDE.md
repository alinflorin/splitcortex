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
- Enrollment UI: accepts a typed short code (always) or a scanned QR (when a camera works), with an editable gateway URL. See Security for the protocol.
- The app must keep the TLS connection to the gateway alive while serving; mobile OS background limits (Android foreground service, iOS suspension) are a known risk to investigate early.

**Backend (undecided)**: do not assume it yet.

- Open question: the gateway needs long-lived TLS connections to nodes, load balancing and low-latency metering. The gateway is a separate always-on service (long-running process or container). Do not use serverless functions anywhere in the backend.
- Keep data access behind a thin layer in the frontend so the backend choice stays swappable.

## Domain model

- **User**: registers an account.
- **Organisation**: created by users; has members with roles (membership management).
- **Pool**: an inference pool owned by an organisation; contains device nodes and serves a set of models.
- **Node / device**: a phone, RPi, etc. registered to a pool. Runs LiteRT-LM.
- **API key**: belongs to an organisation; used by clients to call the gateway.
- **Model**: managed by the platform and replicated onto every node in a pool.
- **Usage record**: token usage per key / pool / org, used for limits and dashboards.

## Architecture rules

- The app is both the control plane (accounts, orgs, pools, keys, config, dashboards) and the **API gateway** (auth, limits, metering, load balancing, model management).
- Nodes connect **outbound** to the gateway over a persistent **WebSocket** connection secured with **TLS** (wss), carrying **protobuf** messages. Multiplexing is application-level: every message carries a request id, with credit-based backpressure, ping/pong keepalives and reconnect with resume. The protobuf schema is the versioned node protocol contract; keep it transport-independent. There is **no message broker** for now: the gateway keeps an in-memory registry of connected nodes per pool and relays requests and streamed tokens over the node's stream. Keep the node connection behind a transport interface (e.g. `NodeChannel`) so multi-gateway scaling (shared registry, gateway-to-gateway forwarding, or NATS) can be added later. Never design anything that requires inbound connectivity to a device.
- The gateway exposes the **OpenAI API format** (e.g. `/v1/chat/completions`, `/v1/models`, streaming via SSE) so existing OpenAI clients and SDKs work by changing only the base URL and API key. Keep this wire format at the gateway edge; translate to the internal node protocol behind it.
- The gateway has two distinct legs; do not conflate them. The OpenAI handler and the node registry/sockets must live in the same process (or instance group), so the client-facing endpoint must not be split out into a separate service or function:

  ```
  client ──HTTPS + SSE (OpenAI format)──▶ gateway ──WebSocket + protobuf (wss)──▶ node
          client-initiated, per request                node-initiated, long-lived, multiplexed
  ```

- The web app includes a **performance measurement** feature (e.g. benchmarking nodes and pools: latency, throughput, tokens/sec). Measurements must be scoped by organisation like all other data, and must not log prompts or completions (benchmark prompts excepted if they are platform-supplied).
- Every inference request must be authenticated by API key, checked against limits, routed to a healthy node in the target pool, and metered (tokens in/out).
- Models are **replicated** per device for now. Keep model placement behind an abstraction so sharding a large model across devices (open research) can be added later without rewriting the gateway.
- **LiteRT-LM** is the only supported engine. Keep the engine behind an interface; do not leak LiteRT-LM specifics into gateway or billing code.
- Tenant isolation is critical: every query, node stream and registry entry must be scoped by organisation.

## Security

- API keys: store only hashes, show the secret once at creation.
- Node authentication must be per-device credentials, revocable individually.
- **Node identity**: each node generates its own public/private key pair on the device. The private key never leaves the device (use the platform secure keystore where possible). On enrollment the node registers its public key with the platform; the gateway authenticates the node by proof of possession of the matching private key (challenge-response signed during or right after the TLS handshake). Identity comes from the registered key, never from messages on the stream.
- **Server identity**: the server has its own key pair. Nodes learn and trust the server's public key (pin it at enrollment) so they can verify the gateway independently of the TLS CA chain.
- **Enrollment** (initiated from the web app, completed on the device):
  - An admin picks a pool in the web app, which creates an enrollment record (org, pool, expiry ~10 min, single-use, attempt-limited) and shows a **short code** formatted `XXXX-XXXXXX` (Crockford base32, no ambiguous characters). The same code is also shown as a QR for devices with a working camera; the QR is only a convenience and carries the gateway URL plus the same code. **Every device must be able to enroll by typing the code** (no camera required).
  - The first part (4 chars) is a lookup id, unique among all active enrollments across organisations (unique index; not reused until expired). The second part (6 chars) is the secret. Store only a verifier/hash of the secret server-side. The code reveals nothing about org or pool before success.
  - The mobile app takes the code and a **gateway URL, which has a default and is user-editable** (self-hosted or LAN gateways).
  - Device keys are **never derived from the code**: the device generates its own non-exportable key pair in the secure keystore. The code only authorizes registering that public key.
  - Because the code is short, use a **password-authenticated key exchange (PAKE; CPace or SPAKE2)** keyed by the secret part, so the code authenticates both sides and cannot be attacked offline. Inside the PAKE-protected channel the gateway sends its public key (the device pins it) and the device sends its public key and device info. This is what lets a short code replace a long pinned-key QR. A fake gateway at an edited URL learns nothing from the exchange.
  - Online guessing is bounded: a few attempts per enrollment, then it is invalidated, plus per-IP rate limits. The secret is single-use and consumed in the same transaction that registers the device.
  - Optional per-pool **admin approval**: the device appears as pending in the web app, showing a short fingerprint of its public key for the admin to compare, and is only active once approved.
  - After enrollment the code is dead; each connection authenticates with the signed challenge. Revoking a node means deleting its registered public key.
- Open decisions: PAKE choice and library availability on React Native/Expo (spike early; if no usable library, fall back to TLS with CA validation plus mandatory admin approval, and document the weaker first-contact trust), code length and TTL, whether approval is on by default, bulk code generation for many devices, key algorithm (Ed25519 is the likely default), server key rotation, and whether the key pair is used only for authentication or also to sign messages and model manifests.
- Validate TLS properly on the node connection; no disabled certificate checks, even in dev shortcuts. The node also verifies the gateway against the pinned server key.
- Do not log prompts, completions, or key material.

## Commands

TBD (no stack chosen yet).

## Layout

TBD.

## Working conventions

- Keep CLAUDE.md and README.md in sync with decisions; update them when the stack, commands or layout are established.
- Prefer small, focused commits. Do not commit unless asked.
- Open research items (multi-device model sharding) belong in the README roadmap, not as speculative code.
