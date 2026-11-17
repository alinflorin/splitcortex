import { defineConfig, devices } from '@playwright/test';
import { appUrl, isLocalStack } from './src/env.ts';

// One runner, eight projects (run one with --project=<name>): platform (browser: web app), web-node (browser: the web node), cli (the
// splitcortex-node binary), api (the control plane's rules and the enrollment limits, no node), serving (the gateway and control plane with a live node: inference, keys, limits, metering), desktop (the Tauri app through tauri-driver), mobile (the Android app through Maestro), perf (load against the gateway with simulated nodes, run on demand).
// Suites for a binary or device that is not present skip locally and fail in CI.
export default defineConfig({
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'platform',
      testDir: './tests/platform',
      use: { ...devices['Desktop Chrome'], baseURL: appUrl, ignoreHTTPSErrors: isLocalStack },
    },
    {
      name: 'web-node',
      testDir: './tests/web-node',
      use: { ...devices['Desktop Chrome'], ignoreHTTPSErrors: isLocalStack },
    },
    { name: 'cli', testDir: './tests/cli' },
    { name: 'api', testDir: './tests/api' },
    {
      name: 'serving',
      testDir: './tests/serving',
      // A few specs check the web app against real traffic from the node.
      use: { ...devices['Desktop Chrome'], baseURL: appUrl, ignoreHTTPSErrors: isLocalStack },
    },
    // Load against a dedicated/local stack with simulated nodes; not part of the nightly run (see docs/e2e.md).
    { name: 'perf', testDir: './tests/perf', timeout: 900_000 },
    { name: 'desktop', testDir: './tests/desktop', timeout: 180_000 },
    { name: 'mobile', testDir: './tests/mobile', timeout: 300_000 },
  ],
});
