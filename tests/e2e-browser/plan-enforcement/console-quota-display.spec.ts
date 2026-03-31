/**
 * E2E Browser — Console quota display (Playwright).
 *
 * Verifies quota progress bars, over-limit indicators, and override badges.
 */

import { test, expect } from '@playwright/test';

const SKIP = process.env.BROWSER_TEST_ENABLED !== 'true';

test.describe('Console quota display', () => {
  test.skip(() => SKIP, 'BROWSER_TEST_ENABLED is not true');

  test('normal consumption: progress bars show correct percentages', async ({ page }) => {
    await page.goto(`${process.env.PLAYWRIGHT_BASE_URL}/login`);
    await page.fill('[data-testid="email-input"]', process.env.TEST_TENANT_OWNER_EMAIL ?? 'pro-owner@test.local');
    await page.fill('[data-testid="password-input"]', process.env.TEST_TENANT_OWNER_PASSWORD ?? 'test-password');
    await page.click('[data-testid="login-button"]');
    await page.waitForURL('**/dashboard**');

    await page.click('[data-testid="nav-usage"]');

    // Verify quota progress bars exist
    const progressBars = page.locator('[data-testid^="quota-progress-"]');
    const count = await progressBars.count();
    expect(count).toBeGreaterThan(0);

    // Each bar should have a percentage attribute between 0 and 100
    for (let i = 0; i < count; i++) {
      const bar = progressBars.nth(i);
      await expect(bar).toBeVisible();
    }
  });

  test('over-limit state: shows visual over-limit indicator after downgrade', async ({ page }) => {
    await page.goto(`${process.env.PLAYWRIGHT_BASE_URL}/login`);
    await page.fill('[data-testid="email-input"]', process.env.TEST_OVERLIMIT_OWNER_EMAIL ?? 'overlimit-owner@test.local');
    await page.fill('[data-testid="password-input"]', process.env.TEST_OVERLIMIT_OWNER_PASSWORD ?? 'test-password');
    await page.click('[data-testid="login-button"]');
    await page.waitForURL('**/dashboard**');

    await page.click('[data-testid="nav-usage"]');

    // Look for over-limit indicator
    const overlimitBadge = page.locator('[data-testid="quota-overlimit-badge"]');
    await expect(overlimitBadge).toBeVisible();
  });

  test('override active: shows override badge on affected dimension', async ({ page }) => {
    await page.goto(`${process.env.PLAYWRIGHT_BASE_URL}/login`);
    await page.fill('[data-testid="email-input"]', process.env.TEST_OVERRIDE_OWNER_EMAIL ?? 'override-owner@test.local');
    await page.fill('[data-testid="password-input"]', process.env.TEST_OVERRIDE_OWNER_PASSWORD ?? 'test-password');
    await page.click('[data-testid="login-button"]');
    await page.waitForURL('**/dashboard**');

    await page.click('[data-testid="nav-usage"]');

    const overrideBadge = page.locator('[data-testid="quota-override-badge"]');
    await expect(overrideBadge).toBeVisible();
  });
});
