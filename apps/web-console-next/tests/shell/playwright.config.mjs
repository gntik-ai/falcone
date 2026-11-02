import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: '*.spec.mjs', timeout: 60_000, expect: { timeout: 15_000 },
  workers: 1, retries: 0, reporter: [['list'], ['html', { outputFolder: '../../test-results/shell-report', open: 'never' }], ['json', { outputFile: '../../test-results/shell-report.json' }]], outputDir: '../../test-results/shell',
  use: { browserName: 'chromium', headless: true },
});
