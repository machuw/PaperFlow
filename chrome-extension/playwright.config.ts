import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/e2e/**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  globalTeardown: './tests/e2e/_global-teardown.ts',
  use: {
    headless: false,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    actionTimeout: 5_000,
  },
});
