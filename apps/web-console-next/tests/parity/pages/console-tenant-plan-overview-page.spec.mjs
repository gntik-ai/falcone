import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { entitlementsMixed, overviewUrl } from './console-tenant-plan-overview-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';

const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale,
  JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-tenant-plan-overview-page.json`, import.meta.url), 'utf8')),
]));
const build = JSON.parse(readFileSync(new URL('../../../dist/.vite/manifest.json', import.meta.url), 'utf8'));
const entry = Object.values(build).find((chunk) => chunk.isEntry && chunk.name === 'app').file;
const surface = (parity) => parity.page.locator('.console-tenant-plan-overview');
const requests = (parity) => parity.network.requests.filter((request) => request.path.startsWith('/v1/tenant/plan'));
const variant = (name) => ({ planOverview: name });
const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => values[key]);
async function open(parity, name = 'success') {
  await parity.open(manifest.route, variant(name));
  await expect(surface(parity).locator('section[aria-busy="true"]')).toHaveCount(0);
}
// The page sends exactly the own-tenant read: no /v1/tenants/{id} variant and no history request.
function assertRequests(parity, count) {
  expect(requests(parity)).toHaveLength(count);
  for (const request of requests(parity)) expect(request).toEqual({ method: 'GET', path: overviewUrl, body: undefined });
  for (const request of parity.network.requests) {
    expect(new URL(request.path, 'http://synthetic.test').pathname).toMatch(/^\/v1\/(?:tenant\/plan\/effective-entitlements|tenants(?:\/synthetic-tenant)?|workspaces|plans|auth\/login-sessions\/synthetic-session\/refresh|auth\/signups\/policy)$/);
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
async function tenantless(parity, server, platformRole) {
  const seed = async (route) => {
    await parity.page.evaluate((role) => {
      const session = JSON.parse(sessionStorage.getItem('in-falcone.console-shell-session'));
      session.principal.platformRoles = [role]; session.principal.tenantIds = [];
      sessionStorage.setItem('in-falcone.console-shell-session', JSON.stringify(session));
    }, platformRole);
    await route.fallback();
  };
  await parity.page.route(`**/${entry}`, seed);
  try { await parity.page.goto(server.url('console/my-plan')); }
  finally { await parity.page.unroute(`**/${entry}`, seed); }
}

for (const role of manifest.roles) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-tenant-plan-overview-page | ${role} | ${locale} | ${width}`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    const copy = bundles[locale];
    test('data', async ({ parity }) => {
      await open(parity, 'my-plan-entitlements-mixed');
      await expect(surface(parity).getByRole('heading', { level: 1, name: copy.title, exact: true })).toBeVisible();
      await expect(surface(parity).getByText(entitlementsMixed.planSlug, { exact: true })).toBeVisible();
      await expect(surface(parity).getByLabel(fill(copy.planStatusName, { status: copy.status.active }), { exact: true })).toBeVisible();
      await expect(surface(parity).getByText(locale === 'es' ? '1 dimensión está actualmente por encima del límite.' : '1 dimension is currently over its limit.', { exact: true })).toBeVisible();
      const table = surface(parity).getByRole('table', { name: copy.limitsTitle });
      await expect(table.getByRole('columnheader')).toHaveCount(5);
      await expect(table.getByRole('row')).toHaveCount(7);
      for (const limit of entitlementsMixed.quantitativeLimits) await expect(table.getByText(limit.displayLabel, { exact: true })).toBeVisible();
      await expect(table.getByText(copy.unlimited, { exact: true })).toBeVisible();
      await expect(table.getByText(fill(copy.unlimitedUsage, { used: 1234 }), { exact: true })).toBeVisible();
      await expect(table.getByText(copy.noData, { exact: true })).toBeVisible();
      await expect(table.getByRole('meter')).toHaveCount(4);
      for (const [status, label] of [['within_limit', 'Synthetic Workspaces'], ['approaching_limit', 'Synthetic Functions'], ['at_limit', 'Synthetic Buckets'], ['over_limit', 'Synthetic Databases'], ['unknown', 'Synthetic Topics']]) {
        await expect(table.getByLabel(fill(copy.usageStatusName, { dimension: label, status: copy.usage[status] }), { exact: true })).toBeVisible();
      }
      await expect(surface(parity).getByLabel(fill(copy.capabilityEnabledName, { capability: 'Synthetic Realtime' }), { exact: true })).toBeVisible();
      await expect(surface(parity).getByLabel(fill(copy.capabilityDisabledName, { capability: 'Synthetic SSO' }), { exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('switch')).toHaveCount(0);
      await expect(surface(parity)).not.toContainText(/price|precio|renewal|renov|cycle|ciclo/i);
      assertRequests(parity, 1);
      await surface(parity).getByRole('tab', { name: copy.tabHistory, exact: true }).click();
      await expect(surface(parity).getByRole('region', { name: copy.historyLabel })).toContainText(copy.historyEmptyTitle);
      await expect(surface(parity).getByText(copy.historyEmptyDescription, { exact: true })).toBeVisible();
      assertRequests(parity, 1);
      await check.assertLocale(parity);
    });
    test('action', async ({ parity }) => {
      await open(parity, ['500', 'success']);
      await surface(parity).getByRole('button', { name: copy.retry, exact: true }).click();
      await expect(surface(parity).getByRole('table')).toBeVisible();
      assertRequests(parity, 2);
      // Observe the refreshed request's real headers; the shared recorder omits headers.
      const tokens = [];
      const observe = (request) => { if (new URL(request.url()).pathname === '/v1/tenant/plan/effective-entitlements') tokens.push(request.headers().authorization); };
      parity.page.on('request', observe);
      const before = requests(parity).length;
      const refreshBefore = parity.network.requests.filter((request) => request.method === 'POST').length;
      await open(parity, 'my-plan-entitlements-401');
      await expect(surface(parity).getByRole('table')).toBeVisible();
      expect(requests(parity).length - before).toBe(2);
      expect(parity.network.requests.filter((request) => request.method === 'POST').length - refreshBefore).toBe(1);
      expect(parity.network.requests.filter((request) => request.method === 'POST').at(-1)).toEqual({ method: 'POST', path: '/v1/auth/login-sessions/synthetic-session/refresh', body: { refreshToken: 'synthetic-refresh-token' } });
      expect(tokens).toEqual(['Bearer synthetic-access-token', 'Bearer synthetic-refreshed-access-token']);
      parity.page.off('request', observe);
      // Tabs move with the arrow keys and Historial sends no request.
      const count = requests(parity).length;
      await surface(parity).getByRole('tab', { name: copy.tabSummary, exact: true }).focus();
      await parity.page.keyboard.press('ArrowRight');
      await expect(surface(parity).getByRole('tab', { name: copy.tabHistory, exact: true })).toHaveAttribute('aria-selected', 'true');
      await parity.page.keyboard.press('ArrowLeft');
      await expect(surface(parity).getByRole('tab', { name: copy.tabSummary, exact: true })).toHaveAttribute('aria-selected', 'true');
      expect(requests(parity)).toHaveLength(count);
    });
    test('tenantless', async ({ parity, server }) => {
      for (const platformRole of ['superadmin', 'platform_operator']) {
        const before = requests(parity).length;
        await tenantless(parity, server, platformRole);
        await expect(surface(parity).getByRole('heading', { name: copy.tenantlessTitle })).toBeVisible();
        expect(requests(parity)).toHaveLength(before);
        const action = surface(parity).getByRole('button', { name: copy.openCatalog, exact: true });
        if (platformRole === 'platform_operator') {
          await expect(surface(parity).getByText(copy.tenantlessDescription, { exact: true })).toBeVisible();
          await expect(action).toHaveCount(0);
          await expect(surface(parity).getByRole('button')).toHaveCount(0);
          await expect(surface(parity).getByRole('link')).toHaveCount(0);
        } else {
          await expect(surface(parity).getByText(copy.tenantlessDescriptionCatalog, { exact: true })).toBeVisible();
          await keyboardActivate(parity.page, action);
          await expect(parity.page).toHaveURL(server.url('console/plans'));
          await expect(parity.page.locator('main h1')).toBeFocused();
        }
      }
    });
    test('error-empty', async ({ parity, server }) => {
      for (const state of manifest.states) {
        await open(parity, state.variant);
        await expect(parity.page.locator(typeof state.locator === 'string' ? state.locator : state.locator[locale])).toBeVisible();
        if (['403', '404'].includes(state.variant)) await expect(surface(parity).getByRole('button', { name: copy.retry, exact: true })).toHaveCount(0);
        if (state.variant === '403') await expect(surface(parity).getByText(copy.noAccessDescription, { exact: true })).toBeVisible();
        if (state.variant === '404') {
          const back = surface(parity).getByRole('link', { name: copy.backToOverview, exact: true });
          await expect(back).toHaveAttribute('href', new URL(server.url('console/overview')).pathname);
        }
        if (state.variant === '500') {
          await expect(surface(parity).getByRole('heading', { name: copy.errorTitle })).toBeVisible();
          await expect(surface(parity).getByText('req_synthetic_plan_500', { exact: true })).toBeVisible();
        }
        if (['500', 'network'].includes(state.variant)) await expect(surface(parity).getByRole('table')).toHaveCount(0);
        if (state.variant === 'network') {
          await expect(surface(parity).getByText(copy.requestId, { exact: true })).toHaveCount(0);
          await expect(surface(parity).getByRole('button', { name: copy.retry, exact: true })).toBeVisible();
        }
      }
      await open(parity, 'my-plan-entitlements-no-limits');
      await expect(surface(parity).getByRole('heading', { name: copy.noLimits })).toBeVisible();
      await expect(surface(parity).getByRole('table')).toHaveCount(0);
      await open(parity, 'my-plan-entitlements-no-capabilities');
      await expect(surface(parity).getByText(copy.noCapabilities, { exact: true })).toBeVisible();
      await expect(surface(parity).getByText(entitlementsMixed.planSlug, { exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('table')).toBeVisible();
      await expect(surface(parity).getByRole('tab')).toHaveCount(2);
      parity.network.setVariants(variant('my-plan-entitlements-loading-delayed'));
      await parity.page.goto(server.url('console/my-plan'));
      await expect(surface(parity).getByRole('status', { name: copy.loading })).toBeVisible();
      await expect(surface(parity).getByRole('table')).toBeVisible();
      const before = requests(parity).length;
      const refreshBefore = parity.network.requests.filter((request) => request.method === 'POST').length;
      parity.network.setVariants({ planOverview: 'my-plan-entitlements-401-refresh-rejected', refresh: '401' });
      const url = server.url('console/my-plan');
      await parity.page.goto(url);
      await expect(parity.page).toHaveURL(/\/login$/);
      expect(requests(parity)).toHaveLength(before + 1);
      expect(parity.network.requests.filter((request) => request.method === 'POST')).toHaveLength(refreshBefore + 1);
      expect(await parity.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(url).pathname);
    });
    test('accessibility', async ({ parity }) => {
      await open(parity, ['500', { variant: 'success', delayMs: 1000 }]);
      const retry = surface(parity).getByRole('button', { name: copy.retry, exact: true });
      await keyboardActivate(parity.page, retry);
      await expect(surface(parity).getByRole('button', { name: copy.retrying, exact: true })).toBeFocused();
      await expect(surface(parity).getByRole('table')).toBeVisible();
      await expect(surface(parity).getByRole('heading', { level: 1, name: copy.title, exact: true })).toBeFocused();
      for (const meter of await surface(parity).getByRole('meter').all()) {
        await expect(meter).toHaveAttribute('aria-label', /.+/);
        await expect(meter).toHaveAttribute('aria-valuetext', /.+/);
      }
      await expect(surface(parity).getByRole('alert').filter({ hasText: locale === 'es' ? 'por encima del límite.' : 'over its limit.' })).toBeVisible();
      await check.assertAccessibility(parity);
      await check.assertLocale(parity);
      await surface(parity).getByRole('tab', { name: copy.tabHistory, exact: true }).click();
      await check.assertAccessibility(parity);
      for (const state of ['my-plan-entitlements-no-limits', 'my-plan-entitlements-no-capabilities', '403', '404', '500', 'network']) {
        await open(parity, state); await check.assertAccessibility(parity); await check.assertLocale(parity);
      }
    });
    test('runtime-health', async ({ parity }) => {
      for (const origin of ['/console/my-plan/allocation', '/console/overview']) {
        await parity.open(origin);
        await parity.page.evaluate(() => { window.__planOverviewDocument = true; });
        const link = parity.page.getByRole('link', { name: locale === 'es' ? 'Mi plan' : 'My plan', exact: true });
        if (!await link.first().isVisible()) await parity.page.getByRole('button', { name: locale === 'es' ? 'Abrir navegación' : 'Open navigation', exact: true }).last().click();
        await parity.page.getByRole('link', { name: locale === 'es' ? 'Mi plan' : 'My plan', exact: true }).last().click();
        await expect(surface(parity).getByRole('table')).toBeVisible();
        expect(await parity.page.evaluate(() => window.__planOverviewDocument)).toBe(true);
        await check.assertRuntimeHealth(parity);
      }
      await open(parity);
      await check.assertRuntimeHealth(parity);
    });
    test('responsive', async ({ parity }) => {
      await open(parity); await check.assertResponsive(parity, width);
      const cell = surface(parity).getByRole('table').getByRole('cell').first();
      expect(await cell.evaluate((node) => getComputedStyle(node).display)).toBe(width === 375 ? 'block' : 'table-cell');
    });
    test('visual-review', async ({ parity, server }, info) => {
      const attach = async (state) => {
        const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
        const hash = createHash('sha256').update(body).digest('hex');
        await info.attach(`${state}-${locale}-${width}-sha256-${hash}`, { body, contentType: 'image/png' });
      };
      await open(parity, 'my-plan-entitlements-mixed'); await attach('summary');
      await surface(parity).getByRole('tab', { name: copy.tabHistory, exact: true }).click(); await attach('history-empty');
      await open(parity, 'my-plan-entitlements-500'); await attach('error');
      await tenantless(parity, server, 'superadmin'); await expect(surface(parity).getByRole('heading', { name: copy.tenantlessTitle })).toBeVisible(); await attach('tenantless');
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
  });
}
