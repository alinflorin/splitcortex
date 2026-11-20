import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

// Sequential on purpose: one organisation, a chat pool and an embedding pool, one node at a time (web, then CLI, then Android), so a request
// can only be served by the node under test. `setup` creates the organisation and `cleanup` deletes it again.
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 20 * 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['list']]
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
      testMatch: /(control-plane|gateway)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'ui',
      dependencies: ['setup'],
      testMatch: /(ui|ui-admin|ui-app|ui-org|web-node)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'tenancy',
      dependencies: ['setup'],
      testMatch: /tenancy\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'nodes',
      dependencies: ['setup'],
      testMatch: /(approval|nodes)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        // WebGPU for the web node's engine; software Vulkan (SwiftShader) when the machine has no GPU (CI).
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
  ],
});
