import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './test/e2e/helpers/homeassistant';

export default defineConfig({
  testDir: './test/e2e',
  testMatch: '**/*.spec.ts',
  // Spec FILES run in parallel - each has its own dashboard and its own
  // entities. Tests inside a file stay serial: they share the fixtures that
  // beforeAll/afterAll set up, and splitting them across workers would let one
  // worker's cleanup pull the ground out from under another's test.
  fullyParallel: false,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  timeout: 90_000,
  globalSetup: './test/e2e/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    storageState: 'test/e2e/.storage-state.json',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // The card's map needs WebGL, and a CI runner has no GPU: let Chromium
        // fall back to its software renderer instead of refusing the context.
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
      },
    },
  ],
});
