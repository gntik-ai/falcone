import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { entitlementsMixed, entitlementsPath, entitlementsSearch } from './console-tenant-plan-overview-page.manifest.ts';
import { allocationEndpoints } from './console-tenant-allocation-summary-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';

const read = (locale, namespace) => JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/${namespace}.json`, import.meta.url), 'utf8'));
const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, read(locale, 'pages.console-tenant-plan-overview-page')]));
const allocation = Object.fromEntries(['es', 'en'].map((locale) => [locale, read(locale, 'pages.console-tenant-allocation-summary-page')]));
const surface = (parity) => parity.page.locator('.my-plan');
const requests = (parity) => parity.network.requests.filter((request) => request.path.startsWith(entitlementsPath));
const variant = (name) => ({ myPlanEntitlements: name });
async function open(parity, name = 'success') {
  await parity.open(manifest.route, variant(name));
  await expect(surface(parity).locator('section[aria-busy="true"]')).toHaveCount(0);
}
// The page's only own request is the exact entitlements read; no tenant-id scoped variant is ever sent.
async function assertRequests(parity, count) {
  expect(requests(parity)).toHaveLength(count);
  for (const request of requests(parity)) expect(request).toEqual({ method: 'GET', path: entitlementsPath + entitlementsSearch, body: undefined });
  for (const request of parity.network.requests) {
    expect(new URL(request.path, 'http://synthetic.test').pathname).toMatch(/^\/v1\/(?:tenant\/plan\/effective-entitlements|tenants(?:\/synthetic-tenant)?|workspaces|auth\/login-sessions\/synthetic-session\/refresh|auth\/signups\/policy|plans|tenant\/plan\/allocation-summary)$/);
  }
}
async function keyboardActivate(page, locator) {
  await page.evaluate(() => document.activeElement?.blur());
  for (let index = 0; index < 80; index++) {
    await page.keyboard.press('Tab');
    if (await locator.evaluate((node) => node === document.activeElement)) {
      await page.keyboard.press('Enter'); return;
    }
  }
  throw new Error('Primary action was not reachable by keyboard');
}
// Runs after the harness init script, so it replaces the seeded principal before any app code reads it.
async function asTenantless(parity, role) {
  await parity.page.addInitScript((platformRole) => {
    const key = 'in-falcone.console-shell-session';
    const session = JSON.parse(sessionStorage.getItem(key));
    session.principal.platformRoles = [platformRole]; session.principal.tenantIds = [];
    sessionStorage.setItem(key, JSON.stringify(session));
  }, role);
}

for (const role of manifest.roles) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-tenant-plan-overview-page | ${role} | ${locale} | ${width}`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: { ...manifest.endpoints, ...allocationEndpoints } });
    const copy = bundles[locale];
    test('data', async ({ parity }) => {
      await open(parity, 'my-plan-entitlements-mixed');
      const page = surface(parity);
      await expect(parity.page.getByRole('heading', { level: 1, name: copy.title, exact: true })).toBeVisible();
      await expect(page.getByText('synthetic-pro', { exact: true })).toBeVisible();
      await expect(page.getByText(copy.status.active, { exact: true })).toBeVisible();
      await expect(page.getByRole('alert')).toHaveText(locale === 'es' ? '1 dimensión está actualmente por encima del límite.' : '1 dimension is currently over its limit.');
      const table = page.getByRole('table');
      await expect(table.getByRole('columnheader')).toHaveText([copy.dimension, copy.limit, copy.origin, copy.consumption, copy.state]);
      for (const dimension of entitlementsMixed.quantitativeLimits) {
        await expect(table.getByText(dimension.displayLabel, { exact: true })).toBeVisible();
        await expect(table.getByRole('group', { name: copy.usageStatusName.replace('{dimension}', dimension.displayLabel).replace('{status}', copy.usage[dimension.usageStatus]) })).toBeVisible();
      }
      await expect(table.getByText(`${new Intl.NumberFormat(locale).format(1234)} / ${copy.unlimited}`, { exact: true })).toBeVisible();
      await expect(table.getByText(copy.noData, { exact: true }).first()).toBeVisible();
      await expect(table.getByRole('meter')).toHaveCount(4);
      for (const meter of await table.getByRole('meter').all()) await expect(meter).toHaveAttribute('aria-label', /.+/);
      for (const capability of entitlementsMixed.capabilities) {
        const state = capability.enabled ? 'enabled' : 'disabled';
        await expect(page.getByRole('group', { name: copy.capability[state].replace('{capability}', capability.displayLabel) })).toHaveText(copy[state]);
      }
      // No billing chrome, toggle or kit sample value.
      await expect(page).not.toContainText(/[$€]|renew|renov|monthly|mensual|annual|anual|Acme|Recent activity/i);
      await expect(page.getByRole('switch')).toHaveCount(0);
      // The locale scan covers the populated Summary before the tab changes.
      await check.assertLocale(parity);
      await page.getByRole('tab', { name: copy.tabHistory, exact: true }).click();
      await expect(page.getByRole('heading', { name: copy.historyEmptyTitle, exact: true })).toBeVisible();
      await assertRequests(parity, 1);
      await check.assertLocale(parity);
    });
    test('action', async ({ parity, server }) => {
      await open(parity, ['my-plan-entitlements-500', 'success']);
      await surface(parity).getByRole('button', { name: copy.retry, exact: true }).click();
      await expect(surface(parity).getByRole('table')).toBeVisible();
      await assertRequests(parity, 2);
      // Selecting Historial sends no request.
      await surface(parity).getByRole('tab', { name: copy.tabHistory, exact: true }).click();
      await expect(surface(parity).getByRole('tab', { name: copy.tabHistory, exact: true })).toHaveAttribute('aria-selected', 'true');
      await assertRequests(parity, 2);
      // Observe the replayed request's real headers; the shared recorder omits headers.
      const tokens = [];
      const observe = (request) => { if (new URL(request.url()).pathname === entitlementsPath) tokens.push(request.headers().authorization); };
      parity.page.on('request', observe);
      const before = requests(parity).length;
      const refreshBefore = parity.network.requests.filter((request) => request.method === 'POST').length;
      await open(parity, 'my-plan-entitlements-401-refresh-ok');
      await expect(surface(parity).getByRole('table')).toBeVisible();
      expect(requests(parity).length - before).toBe(2);
      expect(parity.network.requests.filter((request) => request.method === 'POST').length - refreshBefore).toBe(1);
      expect(parity.network.requests.filter((request) => request.method === 'POST').at(-1)).toEqual({ method: 'POST', path: '/v1/auth/login-sessions/synthetic-session/refresh', body: { refreshToken: 'synthetic-refresh-token' } });
      expect(tokens).toEqual(['Bearer synthetic-access-token', 'Bearer synthetic-refreshed-access-token']);
      parity.page.off('request', observe);
      // A tenantless superadmin opens the plan catalogue by keyboard; focus lands on its heading.
      await asTenantless(parity, 'superadmin');
      const count = requests(parity).length;
      await parity.open(manifest.route);
      await keyboardActivate(parity.page, surface(parity).getByRole('button', { name: copy.openCatalog, exact: true }));
      await expect(parity.page).toHaveURL(server.url('console/plans'));
      await expect(parity.page.locator('main h1')).toBeFocused();
      expect(requests(parity)).toHaveLength(count);
    });
    test('error-empty', async ({ parity, server }) => {
      for (const state of manifest.states) {
        await open(parity, state.variant);
        await expect(parity.page.locator(typeof state.locator === 'string' ? state.locator : state.locator[locale])).toBeVisible();
        await expect(surface(parity).getByRole('table')).toHaveCount(0);
        if (['403', '404'].includes(state.variant)) await expect(surface(parity).getByRole('button', { name: copy.retry, exact: true })).toHaveCount(0);
        if (state.variant === '404') {
          const link = surface(parity).getByRole('link', { name: copy.backToOverview, exact: true });
          await expect(link).toHaveAttribute('href', new URL(server.url('console/overview')).pathname);
        }
        if (state.variant === '500') await expect(surface(parity).getByText('req_synthetic_my_plan_500', { exact: true })).toBeVisible();
        if (['500', 'network'].includes(state.variant)) await expect(surface(parity).getByRole('button', { name: copy.retry, exact: true })).toBeVisible();
        if (['500', 'network'].includes(state.variant)) await expect(surface(parity).getByRole('alert')).toHaveText(`${copy.errorTitle}. ${state.variant === 'network' ? copy.networkMessage : copy.errorMessage}`);
        if (state.variant === 'network') await expect(surface(parity).getByText(copy.requestId, { exact: true })).toHaveCount(0);
      }
      await open(parity, 'my-plan-entitlements-no-limits');
      await expect(surface(parity).getByRole('heading', { name: copy.noLimits, exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('table')).toHaveCount(0);
      await expect(surface(parity).getByText('synthetic-pro', { exact: true })).toBeVisible();
      await open(parity, 'my-plan-entitlements-no-capabilities');
      await expect(surface(parity).getByRole('heading', { name: copy.noCapabilities, exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('alert')).toBeVisible();
      await expect(surface(parity).getByRole('table')).toBeVisible();
      await expect(surface(parity).getByRole('tab')).toHaveCount(2);
      parity.network.setVariants(variant('my-plan-entitlements-loading-delayed'));
      await parity.page.goto(server.url('console/my-plan'));
      await expect(surface(parity).getByRole('status', { name: copy.loading })).toBeVisible();
      await expect(surface(parity).getByRole('table')).toBeVisible();
      // A rejected refresh ends the session: one refresh, no retry, login with the return path stored.
      const attempts = requests(parity).length;
      const refreshBefore = parity.network.requests.filter((request) => request.method === 'POST').length;
      parity.network.setVariants({ myPlanEntitlements: 'my-plan-entitlements-401-refresh-rejected', refresh: '401' });
      const url = server.url('console/my-plan');
      await parity.page.goto(url);
      await expect(parity.page).toHaveURL(/\/login$/);
      expect(requests(parity)).toHaveLength(attempts + 1);
      expect(parity.network.requests.filter((request) => request.method === 'POST')).toHaveLength(refreshBefore + 1);
      expect(await parity.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(url).pathname);
      // Tenantless platform principals send no request; only superadmin gets the catalogue action.
      const before = requests(parity).length;
      await asTenantless(parity, 'superadmin');
      await parity.open(manifest.route);
      await expect(surface(parity).getByRole('heading', { name: copy.tenantlessTitle, exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('button', { name: copy.openCatalog, exact: true })).toBeVisible();
      expect(requests(parity)).toHaveLength(before);
      await parity.page.reload();
      await expect(surface(parity).getByRole('heading', { name: copy.tenantlessTitle, exact: true })).toBeVisible();
      expect(requests(parity)).toHaveLength(before);
      await asTenantless(parity, 'platform_operator');
      await parity.open(manifest.route);
      await expect(surface(parity).getByRole('heading', { name: copy.tenantlessTitle, exact: true })).toBeVisible();
      await expect(surface(parity).getByText(copy.tenantlessDescription, { exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('button')).toHaveCount(0);
      await expect(surface(parity).getByRole('link')).toHaveCount(0);
      expect(requests(parity)).toHaveLength(before);
    });
    test('accessibility', async ({ parity }) => {
      await open(parity, ['my-plan-entitlements-500', { variant: 'success', delayMs: 1000 }]);
      const retry = surface(parity).getByRole('button', { name: copy.retry, exact: true });
      await keyboardActivate(parity.page, retry);
      await expect(surface(parity).getByRole('button', { name: copy.retrying, exact: true })).toBeFocused();
      await expect(surface(parity).getByRole('table')).toBeVisible();
      await expect(surface(parity).getByRole('heading', { level: 1, name: copy.title, exact: true })).toBeFocused();
      for (const meter of await surface(parity).getByRole('meter').all()) {
        await expect(meter).toHaveAttribute('aria-label', /.+/);
        await expect(meter).toHaveAttribute('aria-valuetext', /.+/);
      }
      // The mixed Summary, with its populated limits and capabilities, is scanned before the tab changes.
      await check.assertAccessibility(parity);
      await check.assertLocale(parity);
      const summary = surface(parity).getByRole('tab', { name: copy.tabSummary, exact: true });
      const history = surface(parity).getByRole('tab', { name: copy.tabHistory, exact: true });
      await summary.focus(); await parity.page.keyboard.press('ArrowRight');
      await expect(history).toHaveAttribute('aria-selected', 'true');
      await expect(history).toBeFocused();
      await check.assertAccessibility(parity);
      await check.assertLocale(parity);
      await parity.page.keyboard.press('ArrowLeft');
      await expect(summary).toHaveAttribute('aria-selected', 'true');
      for (const state of ['my-plan-entitlements-403', 'my-plan-entitlements-404', 'my-plan-entitlements-500', 'my-plan-entitlements-network', 'my-plan-entitlements-no-limits', 'my-plan-entitlements-no-capabilities']) {
        await open(parity, state); await check.assertAccessibility(parity);
      }
      for (const platformRole of ['superadmin', 'platform_operator']) {
        await asTenantless(parity, platformRole);
        await parity.open(manifest.route);
        await expect(surface(parity).getByRole('button', { name: copy.openCatalog, exact: true })).toHaveCount(platformRole === 'superadmin' ? 1 : 0);
        await check.assertAccessibility(parity);
        await check.assertLocale(parity);
      }
    });
    test('runtime-health', async ({ parity }) => {
      await open(parity);
      await parity.page.evaluate(() => { window.__myPlanDocument = true; });
      const title = allocation[locale].title;
      const link = parity.page.getByRole('link', { name: title, exact: true });
      if (!await link.first().isVisible()) await parity.page.getByRole('button', { name: locale === 'es' ? 'Abrir navegación' : 'Open navigation', exact: true }).last().click();
      await parity.page.getByRole('link', { name: title, exact: true }).last().click();
      await expect(parity.page.locator('.allocation-summary').getByRole('table')).toBeVisible();
      // The allocation back link returns client-side and focuses the Mi plan heading.
      await parity.page.locator('.allocation-summary').getByRole('link', { name: allocation[locale].myPlan, exact: true }).first().click();
      await expect(surface(parity).getByRole('table')).toBeVisible();
      await expect(parity.page.getByRole('heading', { level: 1, name: copy.title, exact: true })).toBeFocused();
      expect(await parity.page.evaluate(() => window.__myPlanDocument)).toBe(true);
      await check.assertRuntimeHealth(parity);
      await open(parity);
      await check.assertRuntimeHealth(parity);
    });
    test('responsive', async ({ parity }) => {
      await open(parity); await check.assertResponsive(parity, width);
      const cell = surface(parity).locator('.my-plan-limits tbody tr').first();
      expect(await cell.evaluate((node) => getComputedStyle(node).display)).toBe(width === 375 ? 'block' : 'table-row');
      await open(parity, 'my-plan-entitlements-no-capabilities'); await check.assertResponsive(parity, width);
    });
    test('visual-review', async ({ parity }, info) => {
      const attach = async (state) => {
        const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
        const hash = createHash('sha256').update(body).digest('hex');
        await info.attach(`${state}-${locale}-${width}-sha256-${hash}`, { body, contentType: 'image/png' });
      };
      await open(parity, 'my-plan-entitlements-mixed'); await attach('mixed');
      await surface(parity).getByRole('tab', { name: copy.tabHistory, exact: true }).click();
      await expect(surface(parity).getByRole('heading', { name: copy.historyEmptyTitle, exact: true })).toBeVisible();
      await attach('history-empty');
      await open(parity, 'my-plan-entitlements-500'); await attach('500');
      await asTenantless(parity, 'superadmin');
      await parity.open(manifest.route);
      await expect(surface(parity).getByRole('heading', { name: copy.tenantlessTitle, exact: true })).toBeVisible();
      await attach('tenantless');
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
  });
}
