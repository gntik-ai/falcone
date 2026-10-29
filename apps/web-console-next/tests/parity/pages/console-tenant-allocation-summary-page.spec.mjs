import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { allocationMixed } from './console-tenant-allocation-summary-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';

const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale,
  JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-tenant-allocation-summary-page.json`, import.meta.url), 'utf8')),
]));
const build = JSON.parse(readFileSync(new URL('../../../dist/.vite/manifest.json', import.meta.url), 'utf8'));
const entry = Object.values(build).find((chunk) => chunk.isEntry && chunk.name === 'app').file;
const surface = (parity) => parity.page.locator('.allocation-summary');
const requests = (parity) => parity.network.requests.filter((request) => request.path === '/v1/tenant/plan/allocation-summary');
const variant = (name) => ({ allocationSummary: name });
async function open(parity, name = 'success') {
  await parity.open(manifest.route, variant(name));
  await expect(surface(parity).locator('section[aria-busy="true"]')).toHaveCount(0);
}
async function assertRequests(parity, count) {
  expect(requests(parity)).toHaveLength(count);
  for (const request of requests(parity)) expect(request).toEqual({ method: 'GET', path: '/v1/tenant/plan/allocation-summary', body: undefined });
  for (const request of parity.network.requests) {
    expect(new URL(request.path, 'http://synthetic.test').pathname).toMatch(/^\/v1\/(?:tenant\/plan\/allocation-summary|tenants(?:\/synthetic-tenant)?|workspaces|auth\/login-sessions\/synthetic-session\/refresh|auth\/signups\/policy)$/);
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
async function tenantless(parity, server) {
  const seed = async (route) => {
    await parity.page.evaluate(() => {
      const session = JSON.parse(sessionStorage.getItem('in-falcone.console-shell-session'));
      session.principal.platformRoles = ['superadmin']; session.principal.tenantIds = [];
      sessionStorage.setItem('in-falcone.console-shell-session', JSON.stringify(session));
    });
    await route.fallback();
  };
  await parity.page.route(`**/${entry}`, seed);
  try { await parity.page.goto(server.url('console/my-plan/allocation')); }
  finally { await parity.page.unroute(`**/${entry}`, seed); }
}

for (const role of manifest.roles) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-tenant-allocation-summary-page | ${role} | ${locale} | ${width}`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    const copy = bundles[locale];
    test('data', async ({ parity }) => {
      await open(parity, 'allocation-summary-mixed');
      const table = surface(parity).getByRole('table', { name: copy.tableTitle });
      await expect(table.getByRole('columnheader')).toHaveCount(5);
      await expect(table.getByRole('rowheader')).toHaveCount(3);
      for (const dimension of allocationMixed.dimensions) await expect(table.getByRole('rowheader').getByText(dimension.displayLabel, { exact: true })).toBeVisible();
      for (const text of [copy.unlimited, copy.dash, copy.fullyAllocated, copy.sharedPool, 'Synthetic Production', locale === 'es' ? 'Área de trabajo 2' : 'Workspace 2']) await expect(table.getByText(text, { exact: true })).toBeVisible();
      await expect(table.getByText(locale === 'es' ? '2,0 KB' : '2.0 KB', { exact: true })).toHaveCount(2);
      await expect(table.getByText(`${new Intl.NumberFormat(locale).format(12345)} requests`, { exact: true })).toBeVisible();
      await expect(table.getByRole('meter')).toHaveCount(2);
      await expect(surface(parity).getByText(locale === 'es' ? '3 dimensiones' : '3 dimensions', { exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('searchbox')).toHaveCount(0);
      await expect(surface(parity).getByRole('checkbox')).toHaveCount(0);
      await assertRequests(parity, 1);
      await check.assertLocale(parity);
    });
    test('action', async ({ parity }) => {
      await open(parity, ['500', 'success']);
      await surface(parity).getByRole('button', { name: copy.retry, exact: true }).click();
      await expect(surface(parity).getByRole('table')).toBeVisible();
      await assertRequests(parity, 2);
      // Observe the refreshed request's real headers; the shared recorder omits headers.
      const tokens = [];
      const observe = (request) => { if (new URL(request.url()).pathname === '/v1/tenant/plan/allocation-summary') tokens.push(request.headers().authorization); };
      parity.page.on('request', observe);
      const before = requests(parity).length;
      const refreshBefore = parity.network.requests.filter((request) => request.method === 'POST').length;
      await open(parity, 'allocation-summary-401');
      await expect(surface(parity).getByRole('table')).toBeVisible();
      expect(requests(parity).length - before).toBe(2);
      expect(parity.network.requests.filter((request) => request.method === 'POST').length - refreshBefore).toBe(1);
      expect(parity.network.requests.filter((request) => request.method === 'POST').at(-1)).toEqual({ method: 'POST', path: '/v1/auth/login-sessions/synthetic-session/refresh', body: { refreshToken: 'synthetic-refresh-token' } });
      expect(tokens).toEqual(['Bearer synthetic-access-token', 'Bearer synthetic-refreshed-access-token']);
      parity.page.off('request', observe);
      const back = surface(parity).getByRole('link', { name: copy.myPlan, exact: true });
      await expect(back).toHaveAttribute('href', '/console/my-plan');
      // Capture Enter's default navigation before deliberately containing the legacy exit.
      await parity.page.evaluate(() => document.body.addEventListener('click', (event) => {
        if (event.target.closest('a')?.getAttribute('href') === '/console/my-plan') {
          window.__allocationBackPrevented = event.defaultPrevented; event.preventDefault();
        }
      }));
      await keyboardActivate(parity.page, back);
      expect(await parity.page.evaluate(() => window.__allocationBackPrevented)).toBe(false);
    });
    test('error-empty', async ({ parity, server }) => {
      for (const state of manifest.states) {
        await open(parity, state.variant);
        await expect(parity.page.locator(typeof state.locator === 'string' ? state.locator : state.locator[locale])).toBeVisible();
        if (['403', '404', 'empty'].includes(state.variant)) await expect(surface(parity).getByRole('button', { name: copy.retry, exact: true })).toHaveCount(0);
        if (state.variant === '404') {
          const links = surface(parity).getByRole('link', { name: copy.myPlan, exact: true });
          await expect(links).toHaveCount(2);
          for (const link of await links.all()) await expect(link).toHaveAttribute('href', '/console/my-plan');
        }
        if (state.variant === '500') await expect(surface(parity).getByText('req_synthetic_alloc_500', { exact: true })).toBeVisible();
        if (state.variant === 'network') {
          await expect(surface(parity).getByText(copy.requestId, { exact: true })).toHaveCount(0);
          await expect(surface(parity).getByRole('table')).toHaveCount(0);
          await expect(surface(parity).getByRole('button', { name: copy.retry, exact: true })).toBeVisible();
        }
      }
      parity.network.setVariants(variant('allocation-summary-loading-delayed'));
      await parity.page.goto(server.url('console/my-plan/allocation'));
      await expect(surface(parity).getByRole('status', { name: copy.loading })).toBeVisible();
      await expect(surface(parity).getByRole('table')).toBeVisible();
      const before = requests(parity).length;
      await tenantless(parity, server);
      await expect(surface(parity).getByRole('heading', { name: copy.tenantlessTitle })).toBeVisible();
      expect(requests(parity)).toHaveLength(before);
      const refreshBefore = parity.network.requests.filter((request) => request.method === 'POST').length;
      parity.network.setVariants({ allocationSummary: 'allocation-summary-401-refresh-rejected', refresh: '401' });
      const url = server.url('console/my-plan/allocation');
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
      await expect(surface(parity).getByRole('heading', { level: 1 })).toBeFocused();
      await expect(surface(parity).locator('[aria-current="page"]')).toHaveText(copy.title);
      for (const meter of await surface(parity).getByRole('meter').all()) {
        await expect(meter).toHaveAttribute('aria-label', /.+/);
        await expect(meter).toHaveAttribute('aria-valuetext', /.+/);
      }
      await check.assertAccessibility(parity);
      await check.assertLocale(parity);
      for (const state of ['empty', '403', '404', '500', 'network']) {
        await open(parity, state); await check.assertAccessibility(parity);
      }
    });
    test('runtime-health', async ({ parity }) => {
      for (const origin of ['/console/my-plan', '/console/overview']) {
        await parity.open(origin);
        await parity.page.evaluate(() => { window.__allocationDocument = true; });
        const link = parity.page.getByRole('link', { name: copy.title, exact: true });
        if (!await link.first().isVisible()) await parity.page.getByRole('button', { name: locale === 'es' ? 'Abrir navegación' : 'Open navigation', exact: true }).last().click();
        await parity.page.getByRole('link', { name: copy.title, exact: true }).last().click();
        await expect(surface(parity).getByRole('table')).toBeVisible();
        expect(await parity.page.evaluate(() => window.__allocationDocument)).toBe(true);
        await expect(surface(parity).getByRole('heading', { level: 1 })).not.toBeFocused();
        await check.assertRuntimeHealth(parity);
      }
      await open(parity);
      await expect(surface(parity).getByRole('heading', { level: 1 })).not.toBeFocused();
      await check.assertRuntimeHealth(parity);
    });
    test('responsive', async ({ parity }) => {
      await open(parity); await check.assertResponsive(parity, width);
      const row = surface(parity).getByRole('rowheader').first();
      expect(await row.evaluate((node) => getComputedStyle(node).display)).toBe(width === 375 ? 'block' : 'table-cell');
    });
    test('visual-review', async ({ parity }, info) => {
      for (const state of ['success', 'empty', '500']) {
        await open(parity, state);
        const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
        const hash = createHash('sha256').update(body).digest('hex');
        await info.attach(`${state}-${locale}-${width}-sha256-${hash}`, { body, contentType: 'image/png' });
      }
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
  });
}
