import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { myPlanEndpoints, myPlanMixed, myPlanUrl } from './console-tenant-plan-overview-page.manifest.ts';
import { allocationEndpoints } from './console-tenant-allocation-summary-page.manifest.ts';
import { myPlanSessions } from '../fixtures/my-plan.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';

const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale,
  JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-tenant-plan-overview-page.json`, import.meta.url), 'utf8')),
]));
const build = JSON.parse(readFileSync(new URL('../../../dist/.vite/manifest.json', import.meta.url), 'utf8'));
const entry = Object.values(build).find((chunk) => chunk.isEntry && chunk.name === 'app').file;
const surface = (parity) => parity.page.locator('.plan-overview');
const calls = (parity) => parity.network.requests.filter((request) => request.path.startsWith('/v1/tenant/plan/effective-entitlements'));
async function open(parity, variant = 'success') { await parity.open(manifest.route, { myPlanEntitlements: variant }); }
function assertReads(parity, count) {
  expect(calls(parity)).toHaveLength(count);
  for (const request of calls(parity)) expect(request).toEqual({ method: 'GET', path: myPlanUrl, body: undefined });
  expect(parity.network.requests.filter((request) => /\/v1\/tenants\/[^/]+\/plan|\/history/.test(request.path))).toEqual([]);
}
async function keyboardActivate(page, target) {
  await page.evaluate(() => document.activeElement?.blur());
  for (let index = 0; index < 80; index++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((node) => node === document.activeElement)) { await page.keyboard.press('Enter'); return; }
  }
  throw new Error('Action is not keyboard reachable');
}
async function openTenantless(parity, server, fixture) {
  // Seed the real session parser after the document init script and before the entry executes.
  const seed = async (route) => {
    await parity.page.evaluate((session) => sessionStorage.setItem('in-falcone.console-shell-session', JSON.stringify(session)), myPlanSessions[fixture]);
    await route.fallback();
  };
  await parity.page.route(`**/${entry}`, seed);
  try { await parity.page.goto(server.url('console/my-plan')); }
  finally { await parity.page.unroute(`**/${entry}`, seed); }
}
async function attach(parity, info, name, locale, width) {
  await check.assertLocale(parity);
  const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
  const hash = createHash('sha256').update(body).digest('hex');
  await info.attach(`${name}-${locale}-${width}-sha256-${hash}`, { body, contentType: 'image/png' });
}

for (const role of manifest.roles) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-tenant-plan-overview-page | ${role} | ${locale} | ${width}`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: { ...myPlanEndpoints, ...allocationEndpoints } });
    const copy = bundles[locale];
    test('data', async ({ parity }) => {
      await open(parity, 'my-plan-entitlements-mixed');
      const table = surface(parity).getByRole('table', { name: copy.tableTitle });
      await expect(table.getByRole('columnheader')).toHaveCount(5);
      await expect(table.getByRole('row')).toHaveCount(8);
      await expect(surface(parity).getByText(myPlanMixed.planSlug, { exact: true })).toBeVisible();
      await expect(surface(parity).getByText(copy.planStatuses.active, { exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('alert')).toContainText(locale === 'es' ? '1 dimensión' : '1 dimension');
      await expect(table.getByText(copy.unlimited, { exact: true })).toHaveCount(2);
      await expect(table.getByText(copy.noData, { exact: true })).toHaveCount(2);
      await expect(table.getByRole('meter')).toHaveCount(4);
      for (const row of myPlanMixed.quantitativeLimits) {
        await expect(table.getByText(row.displayLabel ?? row.dimensionKey, { exact: true })).toBeVisible();
        await expect(table.getByLabel(copy.statusName.replace('{dimension}', row.displayLabel ?? row.dimensionKey).replace('{status}', copy.usage[row.usageStatus]), { exact: true })).toBeVisible();
      }
      for (const capability of myPlanMixed.capabilities) {
        await expect(surface(parity).getByLabel(copy.capabilityName.replace('{capability}', capability.displayLabel).replace('{state}', capability.enabled ? copy.enabledName : copy.disabledName), { exact: true })).toBeVisible();
      }
      await expect(surface(parity)).not.toContainText(/Monthly|Annual|Acme|Recent activity|synthetic-unavailable/);
      await expect(surface(parity).getByRole('searchbox')).toHaveCount(0);
      await expect(surface(parity).getByRole('checkbox')).toHaveCount(0);
      assertReads(parity, 1);
      await check.assertLocale(parity);
    });
    test('action', async ({ parity, server }) => {
      await open(parity, ['my-plan-entitlements-500', 'success']);
      await keyboardActivate(parity.page, surface(parity).getByRole('button', { name: copy.retry, exact: true }));
      await expect(surface(parity).getByRole('table')).toBeVisible();
      assertReads(parity, 2);
      const summary = surface(parity).getByRole('tab', { name: copy.tabSummary, exact: true });
      await summary.focus(); await parity.page.keyboard.press('ArrowRight');
      await expect(surface(parity).getByRole('tab', { name: copy.tabHistory })).toHaveAttribute('aria-selected', 'true');
      await expect(surface(parity).getByRole('heading', { name: copy.historyTitle })).toBeVisible();
      await expect(surface(parity).getByText(copy.historyDescription)).toBeVisible();
      assertReads(parity, 2);
      await parity.page.keyboard.press('ArrowLeft');
      await expect(surface(parity).getByRole('table')).toBeVisible();
      assertReads(parity, 2);
      await open(parity, ['my-plan-entitlements-network', { variant: 'success', delayMs: 1000 }]);
      await expect(surface(parity).getByText(copy.networkDescription, { exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('table')).toHaveCount(0);
      assertReads(parity, 3);
      await check.assertLocale(parity);
      await keyboardActivate(parity.page, surface(parity).getByRole('button', { name: copy.retry, exact: true }));
      await expect(surface(parity).getByRole('button', { name: copy.retrying, exact: true })).toBeFocused();
      await expect(surface(parity).getByRole('table')).toBeVisible();
      await expect(surface(parity).getByRole('heading', { name: copy.title, level: 1 })).toBeFocused();
      await expect(surface(parity).getByText(copy.networkDescription, { exact: true })).toHaveCount(0);
      assertReads(parity, 4);
      const before = calls(parity).length;
      await openTenantless(parity, server, 'shell-superadmin-tenantless');
      await keyboardActivate(parity.page, surface(parity).getByRole('link', { name: copy.catalogue }));
      await expect(parity.page).toHaveURL(/\/console\/plans$/);
      await expect(parity.page.locator('main h1')).toBeFocused();
      expect(calls(parity)).toHaveLength(before);
    });
    test('error-empty', async ({ parity, server }) => {
      for (const state of manifest.states) {
        await open(parity, state.variant);
        await expect(parity.page.locator(typeof state.locator === 'string' ? state.locator : state.locator[locale])).toBeVisible();
        if (['403', '404', 'empty'].includes(state.variant)) await expect(surface(parity).getByRole('button', { name: copy.retry, exact: true })).toHaveCount(0);
        if (state.variant === '404') await expect(surface(parity).getByRole('link', { name: copy.back })).toHaveAttribute('href', new URL(server.url('console/overview')).pathname);
        if (state.variant === '500') await expect(surface(parity).getByText('req_synthetic_my_plan_500', { exact: true })).toBeVisible();
        if (state.variant === 'network') await expect(surface(parity).getByText(copy.networkDescription)).toBeVisible();
        if (['500', 'network'].includes(state.variant)) await expect(surface(parity).getByRole('table')).toHaveCount(0);
        await check.assertAccessibility(parity);
        await check.assertLocale(parity);
      }
      await open(parity, 'my-plan-entitlements-no-capabilities');
      await expect(surface(parity).getByText(copy.noCapabilities)).toBeVisible();
      await expect(surface(parity).getByRole('table')).toBeVisible();
      await expect(surface(parity).getByRole('alert')).toBeVisible();
      parity.network.setVariants({ myPlanEntitlements: 'my-plan-entitlements-loading-delayed' });
      await parity.page.goto(server.url('console/my-plan'));
      await expect(surface(parity).getByRole('status', { name: copy.loading })).toBeVisible();
      await expect(surface(parity).getByRole('table')).toBeVisible();
      for (const fixture of Object.keys(myPlanSessions)) {
        const before = calls(parity).length;
        await openTenantless(parity, server, fixture);
        await expect(surface(parity).getByRole('heading', { name: copy.tenantlessTitle })).toBeVisible();
        await expect(surface(parity).getByRole('link', { name: copy.catalogue })).toHaveCount(fixture === 'shell-superadmin-tenantless' ? 1 : 0);
        expect(calls(parity)).toHaveLength(before);
        await check.assertLocale(parity);
        await check.assertAccessibility(parity);
      }
      const before = calls(parity).length;
      const refreshBefore = parity.network.requests.filter((request) => request.method === 'POST').length;
      parity.network.setVariants({ myPlanEntitlements: 'my-plan-entitlements-401', refresh: '401' });
      await parity.page.goto(server.url('console/my-plan'));
      await expect(parity.page).toHaveURL(/\/login$/);
      await expect(parity.page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(calls(parity)).toHaveLength(before + 1);
      expect(parity.network.requests.filter((request) => request.method === 'POST')).toHaveLength(refreshBefore + 1);
      expect(await parity.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(server.url('console/my-plan')).pathname);
    });
    test('accessibility', async ({ parity, server }) => {
      await open(parity, ['500', { variant: 'success', delayMs: 1000 }]);
      await keyboardActivate(parity.page, surface(parity).getByRole('button', { name: copy.retry, exact: true }));
      await expect(surface(parity).getByRole('button', { name: copy.retrying, exact: true })).toBeFocused();
      await expect(surface(parity).getByRole('table')).toBeVisible();
      await expect(surface(parity).getByRole('heading', { level: 1 })).toBeFocused();
      for (const meter of await surface(parity).getByRole('meter').all()) {
        await expect(meter).toHaveAttribute('aria-label', /.+/);
        await expect(meter).toHaveAttribute('aria-valuetext', /.+/);
      }
      await check.assertAccessibility(parity); await check.assertLocale(parity);
      await surface(parity).getByRole('tab', { name: copy.tabSummary }).focus();
      await parity.page.keyboard.press('ArrowRight');
      await expect(surface(parity).getByRole('heading', { name: copy.historyTitle })).toBeVisible();
      await check.assertAccessibility(parity); await check.assertLocale(parity);
      await openTenantless(parity, server, 'shell-platform-operator-tenantless');
      await expect(surface(parity).getByRole('heading', { name: copy.tenantlessTitle })).toBeVisible();
      await expect(surface(parity).locator('a,button,[tabindex="0"]')).toHaveCount(0);
    });
    test('runtime-health', async ({ parity, server }) => {
      await parity.open('/console/my-plan/allocation');
      await parity.page.evaluate(() => { window.__planOverviewDocument = true; });
      await parity.page.locator('.allocation-summary').getByRole('link', { name: copy.title, exact: true }).click();
      await expect(surface(parity).getByRole('table')).toBeVisible();
      expect(await parity.page.evaluate(() => window.__planOverviewDocument)).toBe(true);
      await check.assertRuntimeHealth(parity);
      await parity.open('/console/settings');
      await parity.page.evaluate(() => { window.__planOverviewDocument = true; });
      if (width < 1024) await parity.page.getByRole('button', { name: locale === 'es' ? 'Abrir navegación' : 'Open navigation', exact: true }).click();
      const nav = parity.page.getByRole('navigation', { name: locale === 'es' ? 'Navegación de consola' : 'Console navigation', exact: true }).filter({ visible: true });
      await nav.getByRole('link', { name: copy.title, exact: true }).click();
      await expect(surface(parity).getByRole('table')).toBeVisible();
      expect(await parity.page.evaluate(() => window.__planOverviewDocument)).toBe(true);
      await check.assertRuntimeHealth(parity);
      await parity.open('/console/overview');
      // overview.tsx:47 uses ClickableCard with href, so the quick card may load a new document.
      await parity.page.locator('.console-overview').getByRole('link', { name: copy.title, exact: true }).click();
      await expect(parity.page).toHaveURL(server.url('console/my-plan'));
      await expect(surface(parity).getByRole('heading', { name: copy.title, level: 1 })).toBeVisible();
      await expect(surface(parity).getByRole('table')).toBeVisible();
      await check.assertRuntimeHealth(parity);
    });
    test('responsive', async ({ parity }) => {
      await open(parity);
      await check.assertResponsive(parity, width);
      const cell = surface(parity).getByRole('cell').first();
      expect(await cell.evaluate((node) => getComputedStyle(node).display)).toBe(width === 375 ? 'block' : 'table-cell');
    });
    test('visual-review', async ({ parity, server }, info) => {
      await open(parity, 'my-plan-entitlements-mixed');
      await expect(surface(parity).getByRole('table', { name: copy.tableTitle })).toBeVisible();
      await expect(surface(parity).getByText(myPlanMixed.planSlug, { exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('alert')).toContainText(locale === 'es' ? '1 dimensión' : '1 dimension');
      await attach(parity, info, 'my-plan-entitlements-mixed-summary', locale, width);
      await surface(parity).getByRole('tab', { name: copy.tabHistory }).click();
      await expect(surface(parity).getByRole('heading', { name: copy.historyTitle })).toBeVisible();
      await expect(surface(parity).getByText(copy.historyDescription, { exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('table')).toHaveCount(0);
      assertReads(parity, 1);
      await attach(parity, info, 'my-plan-entitlements-mixed-history', locale, width);
      await open(parity, 'my-plan-entitlements-500');
      await expect(surface(parity).getByRole('heading', { name: copy.errorTitle })).toBeVisible();
      await expect(surface(parity).getByText(copy.errorDescription, { exact: true })).toBeVisible();
      await expect(surface(parity).getByText('req_synthetic_my_plan_500')).toBeVisible();
      await expect(surface(parity).getByRole('button', { name: copy.retry, exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('table')).toHaveCount(0);
      await attach(parity, info, 'my-plan-entitlements-500', locale, width);
      await openTenantless(parity, server, 'shell-superadmin-tenantless');
      await expect(surface(parity).getByRole('heading', { name: copy.tenantlessTitle })).toBeVisible();
      await expect(surface(parity).getByText(copy.tenantlessAdminDescription, { exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('link', { name: copy.catalogue, exact: true })).toBeVisible();
      assertReads(parity, 2);
      await attach(parity, info, 'shell-superadmin-tenantless', locale, width);
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
  });
}
