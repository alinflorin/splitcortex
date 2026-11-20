# Web app (`src/ui`)

Rules: [CLAUDE.md](../CLAUDE.md).

## Stack and conventions

- Vite, React (compiler via the experimental Rust port: `react({ compiler: true })` + `oxc-transform-react`), strict TS (no `any`), Fluent UI only, react-hook-form (`mode: 'onTouched'`) + zod (messages are i18n keys), React Router, TanStack Query.
- **i18n**: react-i18next, localStorage then browser, fallback en; en + ro; JSON in `public/locales/<lng>/translation.json`. **Theme**: Fluent teams light/dark, System/Light/Dark, persisted; theme and language pickers live in the avatar menu (also signed out).
- **No CDNs**: Inter self-hosted (`@fontsource-variable/inter`, `src/fonts.css`).
- **Tests**: Vitest (jsdom, `src/test/setup.ts` stubs `matchMedia`/`ResizeObserver`), RTL, next to the code; use `renderApp` from `src/test/render.tsx`; mock `react-oidc-context` with `vi.mock`; the chart package is mocked (no canvas).
- **Design**: light, airy, hairline borders, no heavy shadows, no gradients (flat `#4f5df0`). Every page uses `components/layout/PageHeader`. Sidebar on desktop, overlay drawer on mobile. Short route fade-in (`.sc-enter`, off under `prefers-reduced-motion`).

## Auth

**Dex OIDC** via `react-oidc-context` (public client `splitcortex-ui`, code + PKCE). Dex URL from `window.location` (`<domain>` → `https://dex.<domain>`; `VITE_OIDC_AUTHORITY` overrides). No end-session endpoint: sign-out clears the local session. Dex CORS is wide open (`web.allowedOrigins: ["*"]`, plus `web.allowedHeaders` for preflight). Tokens last 15 min and `automaticSilentRenew` only runs while a page is awake, so `PrivateRoute` tries `signinSilent()` before sending an expired session to Dex, `SignInOnRenewFailure` signs in again after a failed renewal, and every call gets its token from `auth/useFreshToken.ts` (renews under 30 s, one shared renewal; `useRequest` replays once after a 401). Home and About are public, everything else is behind `PrivateRoute`.

## Data and feedback

- Control plane calls through TanStack Query (`src/api/`: `client.ts` fetch + zod parsing, same-origin `/api` or `VITE_API_URL`; `hooks.ts`; `ApiProvider` shows failed mutations as toasts; `schemas.ts` hand-synced DTOs). Queries wait for the OIDC token. Role gating (`lib/roles.ts`) mirrors the server and is only a convenience.
- Use `useConfirm()` and `useToast()` (`components/feedback/`), not ad-hoc dialogs.

## Layout and pages

- **Cards, never tables.** `components/cards` (`CardList`, `ItemCard`, `Stat`/`StatRow`): one column on mobile, `variant="grid"` from 720 px.
- **Navigation in the sidebar.** Inside an org it shows only that org (`OrgNav.tsx`): Back, org name + role label, then Models/Pools/API keys/Members/Usage/Metrics/Audit log/Settings (API keys, Audit, Settings admin-only). Top level: Home, Organisations, Playground, About. Routes (all private): `/organisations`, `/organisations/:orgId/{pools, pools/:poolId, models, api-keys, members, usage, metrics, audit, settings}`, `.../nodes/:nodeId`, `/playground`, `/user-settings`.
- **Pools list**: green/amber dot and "online / total", refreshed every 10 s.
- **Pool screen**: devices, with admin buttons **Add web node** (creates a code, opens `https://web-node.<domain>/#code=...`; `VITE_WEB_NODE_URL` overrides), **Add many devices** (`BulkEnrollDialog`, 1..50 codes, CSV, cancels unused on close), **Add device** (`EnrollDeviceDialog`: code + QR with countdown, API address, closes itself when a node appears); served models; pool usage; **Benchmarks** (`PoolBenchmarks`, polls every 3 s while running).
- **Node page**: status, CPU, memory, battery/temperature, device info, approve/revoke, admin **Restart** (confirm; disabled unless online), engine card with admin overrides (compute, context 512–131072, MTP, keep-screen-on; saved on change/blur); polls every 10 s; shows `live.modalities`.
- **API keys**: cards with status/scope (**Expiring soon** under 7 days); create dialog (org or pool checkboxes, expiry, limits); **Change expiry** (also revives); one-time secret dialog with **Use this key** (curl/Python examples; gateway URL `gateway.<domain>/v1`, `VITE_GATEWAY_URL` overrides, `lib/gateway.ts`); **Edit limits**; revoke.
- **Models**: status, progress, retry, delete; add from a Hugging Face link or upload with part-level retry (`lib/uploadParts.ts`); **Type** Chat/Embeddings (embedding models are left out of the Playground picker).
- **Account settings**: name/email and a danger zone deleting the account (`DELETE /api/me`; the toast names orgs where the user is sole owner).
- **Audit log** (admin/owner; plain members are redirected): newest first, action label `audit.actions.<action>` (new actions need en + ro labels), filters by category and outcome, **Load more** (`useInfiniteQuery`), CSV/JSON export (`lib/saveFile.ts`).
- **Limits**: `LimitsFields` (requests/min, tokens/min, tokens/day; empty = unlimited) in org settings, key creation, per-key dialog.
- **Playground**: chat with a pool. The user **pastes an API key** (component state only); `GET /v1/models` fills the picker; `POST /v1/chat/completions` streams SSE (`lib/chatStream.ts`; stop aborts so the gateway cancels the node). Options: system prompt, temperature, max tokens; shows time to first token and tokens/s. **Attachments** (`lib/attachments.ts`, paperclip/drop/paste, plus a microphone via `MediaRecorder`): images the gateway takes (JPEG/PNG/GIF/BMP ≤ 1 MiB) go as is, others are scaled to 1024 px JPEG; audio (wav/mp3/flac ≤ 5 MiB) as is, other formats decoded with Web Audio to 16 kHz mono WAV (≤ 10 min); text files (≤ 200 KiB) pasted as a fenced `[File: name]` block; PDFs/binaries refused. Sent as OpenAI parts; a text-only message stays a string. A warning shows when the model's `input_modalities` lacks an attached kind. **No chat memory**: the conversation is resent each turn, refresh clears it, and the page respects `max_media_bytes`. Markdown via `react-markdown` (no raw HTML). Calls go to **`/v1` on the app's own origin** (`getPlaygroundBaseUrl`), routed to the gateway by `gateway.appIngress`, so **no CORS on the gateway**.
- **Home** (`pages/Home.tsx`): landing with an animated `NetworkDiagram`, steps, feature cards, a curl example, **Run a node** (`AppDownloads bare`), **Endpoints** (gateway base URL and `<origin>/api`, with copy buttons) and a call to action; signed-out visitors get "Get started" (Dex sign-in). **About**: the story and the two-leg flow. Public copy keeps internal plans, pricing and the tech stack out (WebGPU and LiteRT-LM are named on purpose). Shared pieces in `components/marketing/`; copy in `home.*`/`about.*`.
- **`AppDownloads`** ("Run a node", `#run`): **Mobile app** (APK → `releases/tag/mobile-node-latest`; store buttons inert), **Command line** (`curl … install.sh | sh`, `irm … install.ps1 | iex`, release `cli-node-latest`; scripts from GitHub raw `src/cli-node/install.*`), **Web node** (open without a code; share via `navigator.share`, else copy). Each stream has a rolling `<stream>-latest` release rewritten by `rolling-release.yaml`.
- **Version**: the sidebar footer shows the Helm chart version from `/version.json` (Caddy serves env `APP_VERSION` = `.Chart.Version`; Vite dev has the same route).

## Charts

`@fluentui/react-charts` only, wrapped by `components/charts/TimeCharts.tsx` (`ChartCard`, line or stacked bars). `MetricsView` shows **live** charts (15 s refresh, a switch freezes, ranges 15 min–7 days) at org (**Metrics** page), pool (pool screen) and node (node screen, telemetry only) level; device charts include **measured tokens/s** and **failure rate** beside the reported tokens/s. `UsageView` has request and token charts above its period cards.

## Container

`Dockerfile` (pnpm test, build, precompress, Caddy on 8080 with SPA fallback, `/healthz`, non-root), `Dockerfile.dev` (Vite on 8080 for Tilt); chart `ui-*.yaml` under `ui:`. **Brotli**: `scripts/precompress.mjs` writes `.br` copies after build; Caddy serves them (`precompressed br`), other encodings on the fly.
