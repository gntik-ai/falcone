import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

// Probe suite for verify-artifacts.mjs: it is excluded from the normal parity config and fails on purpose.
const reports = resolve(process.env.PARITY_REPORT_DIR ?? 'test-results/parity/artifacts');
export default defineConfig({
  testDir: '.', testMatch: 'artifacts.spec.mjs', timeout: 60_000, expect: { timeout: 7_000 },
  workers: 1, retries: 0, forbidOnly: true, updateSnapshots: 'none', outputDir: resolve(reports, 'traces'),
  reporter: [['list'], ['html', { outputFolder: resolve(reports, 'html'), open: 'never' }], ['json', { outputFile: resolve(reports, 'results.json') }]],
  use: { browserName: 'chromium', headless: true, locale: 'es', viewport: { width: 1280, height: 900 }, colorScheme: 'dark', reducedMotion: 'reduce', serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off' },
});
