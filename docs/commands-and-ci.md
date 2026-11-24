# Commands, CI/CD and releases

Rules: [CLAUDE.md](../CLAUDE.md).

## Chart and Tilt

- `helm lint chart --strict [-f chart/values-stg.yaml]`, `helm template` likewise. Local install (`--wait` required so ClusterIssuer hooks run after the cert-manager webhook): `helm upgrade -i --wait --timeout 5m --create-namespace -n splitcortex -f chart/values-local.yaml splitcortex chart`.
- `tilt up` at the root (k3s context `default`, registry `localhost:5000`). Infra installs as a `chart` local_resource via `helm upgrade -i --wait` with app workloads disabled (`--set ui.enabled=false --set controlPlane.enabled=false --set webNode.enabled=false --set gateway.enabled=false`). Each service: `docker_build` + `k8s_yaml(local('helm template ... --show-only templates/<svc>-*.yaml'))`: `ui`, `web-node`, `control-plane` (+ Job `control-plane-migrate`), `gateway` (`cargo watch`; first build takes minutes).
- Gateway scaling `--set gateway.replicas=3`. Key rotation: [gateway.md](gateway.md).

## Per-project commands

- **ui / web-node**: `pnpm install`, `dev` (:5173 / :5174; open the UI as `http://local.splitcortex.com:5173` so Dex URLs match), `build`, `typecheck`, `test`, `format[:check]`; web node also `gen:proto` (needs `protoc`, commit result). Prettier config at root (single quotes, semicolons, width 100) + `.editorconfig`. Run `pnpm format` before committing.
- **control-plane**: `dev` (tsx watch; needs `DATABASE_URL`, `OIDC_ISSUER`), `test`, `typecheck`, `build` (tsup), `db:generate`, `db:migrate`, `format`.
- **gateway**: `cargo build|test|fmt` (`rustfmt.toml`, width 120), `cargo run -- keygen`, `cargo run` (needs `DATABASE_URL`, `GATEWAY_PRIVATE_KEY`). The Docker build runs `cargo nextest run --release --profile ci`.
- **mobile-node**: `typecheck`, `test`, `format[:check]`, `pnpm exec expo export --platform android`, `expo prebuild` then `expo run:android`, `pnpm exec expo install <pkg>`, `gen:proto`.
- **cli-node**: [cli-node.md](cli-node.md) (`SPLITCORTEX_HOME=<dir>` isolates state). **e2e**: [e2e.md](e2e.md).

## CI/CD

- **Images**: reusable `docker-service.yaml` (`service`, `context`, `dockerfile`) builds each arch natively (amd64 `ubuntu-latest`, arm64 `ubuntu-24.04-arm`), pushes by digest to `ghcr.io/<owner>/splitcortex-<service>`, `merge` makes the multi-arch manifest. PRs build only. Tags `vX.Y.Z` → `X.Y.Z` and `X.Y` (= chart `appVersion`); branches → `<branch>`, `sha-<short>`. Each service has a thin path-filtered caller workflow (no tag trigger); a new service adds one.
- **Test reports**: every suite writes **JUnit XML**, shown per test as a check run + job summary (`dorny/test-reporter`, `reporter: java-junit`, `fail-on-error: false`: the test step fails the job, the report only displays). Raw XML uploaded as `junit-*` artifact (14 days). Workflows showing a report need `checks: write`, also every workflow that calls them (`release.yaml`, `mobile-node-release.yaml`).
  - ui, web-node, control-plane: `pnpm test:ci` (`reports/junit.xml`). mobile-node: `pnpm test:ci` (Jest + `jest-junit`). e2e: Playwright `junit` when `CI` is set; HTML report and traces in `e2e-report-<name>`.
  - gateway: `cargo nextest run --release --profile ci` (`.config/nextest.toml`). cli-node: `cargo nextest run --profile ci` (`target/nextest/ci/junit.xml`), one report per platform (`cargo install cargo-nextest`; plain `cargo test` works).
  - **Docker**: the Dockerfile has a `test` stage that never fails (records `reports/exit-code`), a `test-report` stage (`FROM scratch`, reports only) and a `build` stage that fails on non-zero code. `docker-service.yaml` (`test-report: true`, amd64 only) exports it with `--target test-report --output type=local,dest=test-report/<svc>` before the build, so reports exist even when tests fail. Gateway uses one chain `deps` → `test` → `build` so deps compile once.
- **Chart**: `chart.yaml` lints (`--strict`), renders and kubeconform-validates dev/stg/prd; on a `vX.Y.Z` tag pushes to `oci://ghcr.io/<owner>/charts`. Actions pinned to commit SHAs at the latest major.
- **Deploy**: `deploy.yaml` (inputs `environment` stg/prd, `version`) substitutes `CLOUDFLARE_TOKEN` into `values-<env>.yaml` and runs `helm upgrade -i --wait --atomic` from the OCI chart. The GitHub environment holds `KUBECONFIG`, `CLOUDFLARE_TOKEN` (Zone:DNS:Edit), `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`; add required reviewers on `prd`. prd is manual only (also rollback). GHCR packages must be public (no imagePullSecret). Migrations must be expand/contract: `--atomic` rolls back the app, not the schema.
- **E2E**: `e2e.yaml` daily + manual against stg ([e2e.md](e2e.md)).
- **Wiki**: `wiki.yaml` (push to `main` touching `README.md`/`docs/**`) runs `scripts/sync-wiki.sh`: README → `Home`, `docs/*.md` pages, links rewritten, `_Sidebar.md` from H1s. **Never edit the wiki in the UI.** Needs the wiki enabled and `Home` created once by hand.

## Releases

Independent tag streams from `VERSIONS.txt`; no release-please, no rc tags; same build promoted stg → prd.

- **Creating tags**: edit `VERSIONS.txt` (one tag per line), push to `main`; `create-tags.yaml` creates missing tags one by one on the pushed commit with repo secret `GH_TOKEN` (PAT, Contents rw; `GITHUB_TOKEN` tags don't start workflows). Can also run by hand (version + platform/mobile/cli checkboxes, or none to sync). `release.yaml` and `mobile-node-release.yaml` re-run by hand only from the tag; the CLI one takes the version as input.
- **Server `vX.Y.Z`** (lockstep chart/ui/control-plane/gateway/web-node): `release.yaml` calls `chart.yaml` and every service workflow, creates the GitHub release (**latest**), then `deploy.yaml` for stg. A new service needs a job and entries in `github-release`'s and `deploy-stg`'s `needs`. Chart version, `appVersion`, image tags = tag without `v`.
- **Mobile `mobile-node-vX.Y.Z`**: `mobile-node-release.yaml` calls `mobile-node.yaml`, creates a (not latest) release with `splitcortex-mobile-node-vX.Y.Z.apk`. `versionCode` = X*10000+Y*100+Z (minor, patch ≤99; `app.config.ts`). Tag builds make a **signed release APK** from secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (`src/mobile-node/scripts/create-keystore.sh [--upload]`; **back up the keystore: losing it means installed apps can never update; never commit it**), read by `plugins/withReleaseSigning.js` (no secrets = debug key). Non-tag builds: debug APKs, x86_64 only. Jobs `verify` (typecheck, format, Jest, `expo export`) and `android` (prebuild + gradle, ccache + Gradle cache).
- **CLI `cli-node-vX.Y.Z`**: [cli-node.md](cli-node.md).
- **Rolling `<stream>-latest`** (`mobile-node-latest`, `cli-node-latest`): `rolling-release.yaml`, last job of each node release, copies assets into a fixed-tag prerelease (never "latest"). The web app links to them; install scripts and `update` ignore them.
- **Push tags one at a time** (seconds apart): GitHub fires no tag workflows when more than 3 tags arrive in one push.
