import { defineConfig } from '@playwright/test';

// API-level config for the scheduling HTTP slice smoke. No browser projects:
// the slice is exercised purely through Playwright's `request` API client
// against the running docker-compose stack (booted via tests/env/up.sh).
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.APISIX_BASE_URL ?? 'http://localhost:9080',
    ignoreHTTPSErrors: true,
  },
});
