import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FullConfig } from '@playwright/test';
import { appUrl } from './env.ts';

// The CLI node the suites drive is always the newest published release, locally as in CI. The workflow installs it
// itself and sets E2E_CLI_BIN; locally, when E2E_CLI_BIN is not set, this installs it (the repository's install.sh, the
// way a user does) into e2e/.cache/cli-node on every run. Offline, an earlier download is reused. To test another
// binary (a local cargo build, a pinned version), set E2E_CLI_BIN.
const NEEDS_CLI = new Set(['cli', 'serving', 'perf']);

/** The projects this run was asked for (--project=a / --project a, repeatable); all of them when not filtered. */
function selected(config: FullConfig): string[] {
  const names: string[] = [];
  const args = process.argv;
  args.forEach((arg, i) => {
    if (arg.startsWith('--project=')) names.push(arg.slice('--project='.length));
    else if (arg === '--project' || arg === '-p') names.push(args[i + 1] ?? '');
  });
  return names.length ? names : config.projects.map((p) => p.name);
}

export default function globalSetup(config: FullConfig) {
  if (process.env.E2E_CLI_BIN) return;
  if (!selected(config).some((name) => NEEDS_CLI.has(name))) return;
  const dir = resolve(import.meta.dirname, '../.cache/cli-node');
  const bin = resolve(dir, 'splitcortex-node');
  const r = spawnSync('sh', [resolve(import.meta.dirname, '../../src/cli-node/install.sh')], {
    stdio: 'inherit',
    env: {
      ...process.env,
      SPLITCORTEX_INSTALL_DIR: dir,
      SPLITCORTEX_BIN_DIR: resolve(dir, 'bin'),
      SPLITCORTEX_URL: appUrl,
      SPLITCORTEX_VERSION: '',
    },
  });
  if (r.status !== 0) {
    if (!existsSync(bin))
      throw new Error('Could not download the newest CLI node (set E2E_CLI_BIN to use another)');
    console.warn(`Could not download the newest CLI node; using the earlier download at ${bin}`);
  }
  process.env.E2E_CLI_BIN = bin;
}
