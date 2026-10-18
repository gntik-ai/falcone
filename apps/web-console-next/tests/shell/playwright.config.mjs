import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: '*.spec.mjs', timeout: 60_000, expect: { timeout: 15_000 },
  workers: 1, retries: 0, reporter: 'list', outputDir: '../../test-results/shell',
  use: { browserName: 'chromium', headless: true },
});
