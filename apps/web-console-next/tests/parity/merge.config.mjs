import { defineConfig } from '@playwright/test';
import parity from './playwright.config.mjs';

// Re-run the parity reporter against the complete suite, without writing another blob.
export default defineConfig({
  testDir: '.',
  reporter: parity.reporter.filter(([name]) => name !== 'blob'),
});
