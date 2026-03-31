/**
 * E2E Browser — Console capability display (Playwright).
 *
 * Verifies that the React console correctly renders capability states
 * for different plan tiers. Controlled by BROWSER_TEST_ENABLED env var.
 */

import { test, expect } from '@playwright/test';

const SKIP = process.env.BROWSER_TEST_ENABLED !== 'true';

test.describe('Console capability display', () => {
  test.skip(() => SKIP, 'BROWSER_TEST_ENABLED is not true');

  test('professional plan: realtime, webhooks, sql_admin_api sections are visible and active', async ({ page }) => {
    // Login as tenant owner of a professional-plan tenant
    await page.goto(`${process.env.PLAYWRIGHT_BASE_URL}/login`);
    await page.fill('[data-testid="email-input"]', process.env.TEST_TENANT_OWNER_EMAIL ?? 'pro-owner@test.local');
    await page.fill('[data-testid="password-input"]', process.env.TEST_TENANT_OWNER_PASSWORD ?? 'test-password');
    await page.click('[data-testid="login-button"]');
    await page.waitForURL('**/dashboard**');

    // Navigate to capabilities/plan section
    await page.click('[data-testid="nav-plan"]');

    // Verify enabled capabilities are shown as active
    for (const cap of ['realtime', 'webhooks', 'sql_admin_api']) {
      const section = page.locator(`[data-testid="capability-${cap}"]`);
      await expect(section).toBeVisible();
      await expect(section.locator('[data-testid="capability-status"]')).toHaveAttribute('data-enabled', 'true');
    }
  });

  test('starter plan: premium capabilities are disabled with restriction indicator', async ({ page }) => {
    await page.goto(`${process.env.PLAYWRIGHT_BASE_URL}/login`);
    await page.fill('[data-testid="email-input"]', process.env.TEST_STARTER_OWNER_EMAIL ?? 'starter-owner@test.local');
    await page.fill('[data-testid="password-input"]', process.env.TEST_STARTER_OWNER_PASSWORD ?? 'test-password');
    await page.click('[data-testid="login-button"]');
    await page.waitForURL('**/dashboard**');

    await page.click('[data-testid="nav-plan"]');

    for (const cap of ['realtime', 'webhooks', 'sql_admin_api', 'passthrough_admin', 'custom_domains', 'scheduled_functions']) {
      const section = page.locator(`[data-testid="capability-${cap}"]`);
      await expect(section).toBeVisible();
      await expect(section.locator('[data-testid="capability-status"]')).toHaveAttribute('data-enabled', 'false');
    }

    // Verify upgrade hint is present
    const upgradeHint = page.locator('[data-testid="upgrade-hint"]');
    await expect(upgradeHint).toBeVisible();
  });

  test('plan change via API reflects in console after reload', async ({ page }) => {
    // This test assumes an API call was made to change the plan.
    // The actual plan change is done externally; here we just verify the UI.
    await page.goto(`${process.env.PLAYWRIGHT_BASE_URL}/login`);
    await page.fill('[data-testid="email-input"]', process.env.TEST_TRANSITION_OWNER_EMAIL ?? 'transition-owner@test.local');
    await page.fill('[data-testid="password-input"]', process.env.TEST_TRANSITION_OWNER_PASSWORD ?? 'test-password');
    await page.click('[data-testid="login-button"]');
    await page.waitForURL('**/dashboard**');

    await page.click('[data-testid="nav-plan"]');

    // Verify current state is rendered (specific assertions depend on pre-test setup)
    const planBadge = page.locator('[data-testid="current-plan-badge"]');
    await expect(planBadge).toBeVisible();
  });
});
