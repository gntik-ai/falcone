import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const reports = resolve(process.env.PARITY_REPORT_DIR ?? 'test-results/parity');
export default defineConfig({
  testDir: '.',
  testMatch: process.env.PARITY_NEGATIVE === 'true' ? 'negative.spec.mjs' : ['pages/*.spec.mjs', 'endpoints.spec.mjs', 'harness.spec.mjs', 'page-endpoints.spec.mjs'],
  timeout: 60_000, expect: { timeout: 7_000 },
  workers: 1, retries: 0, forbidOnly: true, updateSnapshots: 'none',
  outputDir: resolve(reports, 'traces'),
  snapshotPathTemplate: resolve(reports, 'snapshots/{testFilePath}/{testName}/{arg}{ext}'),
  reporter: [
    ['list'], ['html', { outputFolder: resolve(reports, 'html'), open: 'never' }],
    ['json', { outputFile: resolve(reports, 'results.json') }], ['./reporter.mjs'],
  ],
  use: { browserName: 'chromium', headless: true, locale: 'es', viewport: { width: 1280, height: 900 }, colorScheme: 'dark', reducedMotion: 'reduce', serviceWorkers: 'block', trace: 'retain-on-failure' },
});
