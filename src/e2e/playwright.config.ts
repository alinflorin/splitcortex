import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

// `setup` first (organisation, models, pools, keys), then the projects below run at the same time, one worker each (files
// inside a project stay in order). Every node type has pools and an API key of its own, so a request can only be served
// by the node under test while the other types run next to it. `cleanup` removes the devices and keys at the end.
// E2E_WORKERS sets the number of workers (default 4); `--project=<name>` runs one project.
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: Number(process.env.E2E_WORKERS) || 4,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 20 * 60_000,
  expect: { timeout: 15_000 },
  // CI also writes JUnit XML (reports/junit.xml), which the workflow shows as a test report on the run.
  reporter: process.env.CI
    ? [
        ['github'],
        ['html', { open: 'never' }],
        ['junit', { outputFile: 'reports/junit.xml' }],
        ['list'],
      ]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL,
    // Without this a wrong locator waits for the whole test timeout instead of failing.
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    // Locally the browser is visible; CI (no display) runs headless.
    headless: !!process.env.CI,
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /setup\.spec\.ts/, teardown: 'cleanup' },
    { name: 'cleanup', testMatch: /cleanup\.spec\.ts/ },
    // Without devices: the API (control plane and gateway), the web app and the web node's join screen. Quick, so they
    // run before the long node round trip.
    {
      name: 'api',
      dependencies: ['setup'],
      testMatch: /(control-plane|gateway|api-security|api-edge)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'ui',
      dependencies: ['setup'],
      testMatch: /(ui|ui-admin|ui-app|ui-org|web-node|seo|analytics)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'tenancy',
      dependencies: ['setup'],
      testMatch: /tenancy\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // One project per node type: the three run side by side, each in its own pools. The web node needs WebGPU (software
    // Vulkan, SwiftShader, when the machine has no GPU, as on CI); approval also uses a browser tab as a device.
    {
      name: 'nodes-web',
      dependencies: ['setup'],
      testMatch: /(approval|nodes-web)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--enable-unsafe-webgpu',
            '--enable-features=Vulkan,WebGPU',
            '--use-angle=swiftshader',
            '--use-webgpu-adapter=swiftshader',
          ],
        },
      },
    },
    {
      name: 'nodes-cli',
      dependencies: ['setup'],
      testMatch: /nodes-cli\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Several devices in one pool (CLI nodes, plus a browser tab for the mixed pool): balancing, failure, the device API.
    // Its own pools and key, so it runs next to the other node projects. Needs the CLI node release, like nodes-cli.
    {
      name: 'nodes-multi',
      dependencies: ['setup'],
      testMatch: /nodes-multi\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--enable-unsafe-webgpu',
            '--enable-features=Vulkan,WebGPU',
            '--use-angle=swiftshader',
            '--use-webgpu-adapter=swiftshader',
          ],
        },
      },
    },
    // Performance of the platform with a fleet of fake CLI nodes (`run --fake`). Run it alone, on one worker, after the
    // other projects have passed: `--project=perf --workers=1`. Results land in `perf-results/`.
    {
      name: 'perf',
      dependencies: ['setup'],
      testMatch: /perf\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // The emulator is one device: Android is its own project (and CI job).
    {
      name: 'nodes-android',
      dependencies: ['setup'],
      testMatch: /nodes-android\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
