# End-to-end suite

Summary in [CLAUDE.md](../CLAUDE.md). Code in `src/e2e` (own pnpm project, Playwright, TypeScript).

## What it does

One sequential run (`workers: 1`) against one environment (`BASE_URL`, default `https://local.splitcortex.com`; Dex is `dex.<host>`, the web node `web-node.<host>`):

1. **setup**: signs in every user of `E2E_EMAILS`/`E2E_PASSWORDS` through Dex (storage state in `.auth/`), then, as user 1 and through the web app, **finds or creates** the organisation `e2e`, the two fixed models from Hugging Face (chat SmolLM2-135M-Instruct, embedding EmbeddingGemma 300M) and one pool for each, and waits until the models are `ready`. Organisation, models and pools **persist between runs**, so the models are downloaded from Hugging Face only the first time. Per run it clears leftover devices and creates a fresh API key.
2. **nodes** (always all; they run last, the others are quick): in the chat pool, then in the embedding pool, the node types **take turns in the same pool** (web, CLI, Android; a missing emulator skips Android, a failing node does not skip the next). Each enrolls by typing the code from "Add device", comes online (loads the pool's model first), serves through the Playground and `/v1` (JSON, SSE, bad key = 401; embeddings for the embedding pool), is revoked via the API and must disappear before the next comes.
   - **web**: a second browser context on `web-node.<host>`, Chromium with WebGPU/SwiftShader flags.
   - **cli**: the released `splitcortex-node` (`cli-node-latest`, or `E2E_CLI_VERSION`) downloaded by `lib/releases.ts` into `.cache/`; `join --url --code`, then `run` as a child process with a throw-away `SPLITCORTEX_HOME`.
   - **android**: the released APK (`mobile-node-latest`, or `E2E_MOBILE_VERSION`) on the emulator/device adb sees; opened with the `splitcortex://enroll` deep link, then driven with uiautomator (`lib/adb.ts`: taps "Enroll" and "Start"). For `local.splitcortex.com` it runs `adb reverse tcp:443 tcp:443` (the name resolves to 127.0.0.1, which on the emulator is itself).
3. **api** (no devices, quick; `control-plane.spec.ts`, `gateway.spec.ts`), each in a **throw-away** organisation or pool it creates and deletes itself, so the run's models and pools are untouched:
   - _control plane_: bearer-token checks, `/me`, organisation rename/slug rules, pools (create, duplicate, partial update, delete), enrollment codes (one, bulk, cancel, generic 404 for unknown codes on the device endpoints), usage and metrics (shapes, ranges, filters), **members and roles** (needs the second user: member vs admin vs owner, last owner, leaving), the audit log (filters, paging, CSV/JSON export, admins only) and deleting the organisation. Errors are checked in English and Romanian.
   - _gateway_: key creation (secret shown once, validation), expiry/limit changes, authentication errors, `Accept-Language`, `/v1/models` scoping per key, wrong model/endpoint/body errors, `503` for a pool without a device (a throw-away pool serving the chat model), `429` + `Retry-After` for a request limit and lifting it, revocation, and the audit rows the gateway writes (`api_key.rejected`, `limit.exceeded`; polled, they are batched).
4. **ui** (`ui.spec.ts`, `ui-admin.spec.ts`, `web-node.spec.ts`): the web app as a person uses it, in a throw-away organisation. `ui`: every sidebar page loads, the pool lifecycle (create, edit, add-device code with "New code" and Close cancelling it, delete with confirmation), members (you, add, invalid address, remove), what a plain member does not see, Romanian (`sc-lang` in localStorage), the Playground with a wrong key, the not-found pages. `ui-admin`: models (form validation, **an upload of a tiny file** through the control plane into Garage, served from a pool, stop serving, delete), API keys (create with scope, limits and expiry, the key used against the gateway, edit limits and expiry, revoke and the gateway answering 401), the audit page (rows, category/outcome filters, CSV export), usage and metrics (empty states, ranges), settings (rename, slug validation, organisation limits, delete). `web-node`: the join screen (code shape, generic refusal of an unknown code, Romanian).
5. **tenancy**: user 2 cannot read or delete user 1's organisation.
6. **cleanup** (setup's teardown, runs even after failures): revokes the run's devices and API key. The organisation, models and pools stay. Devices are not reused: every node enrolls afresh and downloads the model itself (no node-side cache is kept between runs).

## Running

- Local: `cp .env.example .env`, fill `E2E_EMAILS`/`E2E_PASSWORDS` (users from `chart/values-local.yaml`), `pnpm install`, `pnpm install:browsers`, `pnpm test` (the browsers are visible locally, headless in CI; `test:ui` for the Playwright UI). Start the emulator first (`adb` on the path) or Android is skipped. `.env` never holds anything else secret.
- CI: `.github/workflows/e2e.yaml`, daily (03:17 UTC) and manual (inputs `cli_version`, `mobile_version`), against stg, environment `stg` (secrets `E2E_EMAILS`, `E2E_PASSWORDS`). Caches: pnpm store, Playwright browsers, the node release downloads, the AVD and its snapshot (`reactivecircus/android-emulator-runner`, API 34 x86_64, KVM enabled). The report is uploaded as an artifact.

## Users in stg

`e2e.users` (chart value, `{email, hash}`) are appended to Dex's `staticPasswords` by `templates/dex-config.yaml`. It is empty in git: `deploy.yaml` (stg only) turns the same secrets into bcrypt hashes with `htpasswd` and passes them as an extra values file. Local users live in the git-ignored `values-local.yaml`.

## Not verified

The `setup`, `api`, `ui` and `tenancy` projects (40 tests) pass against the local stack (`local.splitcortex.com`, two users). Not run against stg. The node round trips below were written without a running stack: it type-checks and Playwright lists the tests, but no run against local or stg has happened. Selectors are the English UI strings. The Android engine has not been run on an emulator before (docs/node-app.md), the web node needs WebGPU (SwiftShader in CI is untested), and the CLI/APK release assets are assumed to be named as in `rolling-release.yaml`.

## Gotchas (found by running it)

- **Dialogs**: `AddModelDialog` and every confirm dialog are `modalType="alert"`, so their role is `alertdialog`; the others are `dialog`. A Fluent toast renders its text twice (visible title + `aria-live`): use `.first()`. A dialog that just closed stays in the DOM for its exit animation: wait with `dialogsClosed(page)` (`lib/ui.ts`) before opening the next one, or `getByRole('dialog')` picks the closing one and loses it. Escape does not close the add-device dialog in practice; the test clicks Close.
- **Names**: "Start" also matches "Restart"; use `exact: true`. The pool page has four comboboxes: the model picker is found by its placeholder.
- **Idempotent setup**: `ensurePool` always checks that the pool serves its model (a pool left over from a crashed run had none, which showed up in the web node as "The pool serves no model"), and the node specs assert it before enrolling.
- **Web node** starts by itself after joining; the driver only presses Start if it did not.
- `actionTimeout` is set, so a wrong locator fails in 30 s instead of waiting for the test timeout.
