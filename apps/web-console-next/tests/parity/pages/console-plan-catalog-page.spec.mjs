import { createHash } from 'node:crypto';
import manifest, { plansPath, catalogResponse, isPlansQuery } from './console-plan-catalog-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';
import { installSession } from '../../browser-session.mjs';
import es from '../../../src/locales/es/pages.console-plan-catalog-page.json' with { type: 'json' };
import en from '../../../src/locales/en/pages.console-plan-catalog-page.json' with { type: 'json' };

const states = new WeakMap();
const copy = (parity) => parity.locale === 'es' ? es : en;
const calls = (parity) => parity.network.requests.filter((request) => request.path.startsWith(`${plansPath}?`));
const filter = (parity) => parity.page.getByRole('combobox', { name: copy(parity).filter, exact: true });
const retry = (parity) => parity.page.getByRole('button', { name: copy(parity).retry, exact: true });
const rows = (parity) => parity.page.getByRole('table').getByRole('row').filter({ has: parity.page.getByRole('cell') });
const heading = (parity, key) => parity.page.getByRole('heading', { name: copy(parity)[key], exact: true });
const path = (status = 'all', page = 1, pageSize = 20) => `/v1/plans?${status === 'all' ? '' : `status=${status}&`}page=${page}&pageSize=${pageSize}`;
async function select(parity, label, option) {
  await parity.page.getByRole('combobox', { name: label, exact: true }).click();
  await parity.page.getByRole('option', { name: option, exact: true }).click();
}
async function open(parity, variant = '45-mixed', extra = {}) {
  states.set(parity, { variant, attempt: 0 });
  await parity.open(manifest.route, { tenants: 'empty', ...extra });
  if (!['loading', '401'].includes(variant)) await expect(parity.page.getByRole('status', { name: copy(parity).loading, exact: true })).toHaveCount(0);
}
async function ready(parity, slug = 'synthetic-plan-1') {
  await expect(parity.page.getByRole('link', { name: slug, exact: true })).toBeVisible();
}
async function snapshot(parity, info, name) {
  await check.assertLocale(parity);
  const screenshot = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
  const digest = createHash('sha256').update(screenshot).digest('hex');
  await info.attach(`${name}-${parity.locale}-sha256-${digest}`, { body: screenshot, contentType: 'image/png' });
}

for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-plan-catalog-page | superadmin | ${locale} | ${width}`, () => {
    test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity }) => {
      const injected = [];
      // Keep query-aware server slicing page-local; do not widen the shared registry.
      await parity.page.route((url) => url.pathname === plansPath, async (route) => {
        const request = route.request(), url = new URL(request.url());
        parity.network.requests.push({ method: request.method(), path: url.pathname + url.search, body: undefined });
        if (!isPlansQuery(request.method(), url)) {
          parity.faults.push(`Unmatched catalog request ${request.method()} ${url.pathname}${url.search}`);
          await route.abort(); return;
        }
        const state = states.get(parity) ?? { variant: '45-mixed', attempt: 0 };
        const response = catalogResponse(state.variant, url, state.attempt++);
        if (response.delayMs) await new Promise((resolve) => setTimeout(resolve, response.delayMs));
        if (response.network || response.status >= 400) injected.push({ url: request.url(), kind: response.network ? 'network' : String(response.status) });
        if (response.network) await route.abort('failed');
        else await route.fulfill({ status: response.status, json: response.body });
      });
      // Consume only the exact resource diagnostic of a deliberately injected failure.
      parity.page.on('console', (message) => {
        if (message.type() !== 'error' || !consumeResourceDiagnostic(message.text(), message.location().url, injected)) return;
        const index = parity.faults.indexOf(`console.error: ${message.text()}`);
        if (index >= 0) parity.faults.splice(index, 1);
      });
    });
    test('data', async ({ parity }) => {
      await open(parity); await ready(parity);
      await expect(heading(parity, 'title')).toBeVisible();
      await expect(rows(parity)).toHaveCount(20);
      const cells = rows(parity).first().getByRole('cell');
      await expect(cells).toHaveCount(6);
      await expect(cells.nth(0).getByRole('link')).toHaveAttribute('href', '/console/plans/synthetic-plan-1');
      await expect(cells.nth(1)).toHaveText('Synthetic Plan 1');
      await expect(cells.nth(2)).toHaveText(copy(parity).status.draft);
      await expect(cells.nth(3)).toHaveText('0');
      await expect(cells.nth(4)).toHaveText('—');
      await expect(rows(parity).nth(1).locator('time')).toHaveAttribute('datetime', '2026-06-01T12:00:00.000Z');
      await expect(parity.page.getByRole('link', { name: locale === 'es' ? 'Abrir plan Synthetic Plan 1' : 'Open plan Synthetic Plan 1', exact: true })).toBeVisible();
      await expect(parity.page.locator('p[aria-live="polite"]')).toHaveText(locale === 'es' ? '45 planes' : '45 plans');
      await expect(parity.page.getByText(locale === 'es' ? '1-20 de 45 · 3 páginas' : '1-20 of 45 · 3 pages', { exact: true })).toBeVisible();
      expect(parity.network.requests).toEqual([
        { method: 'GET', path: '/v1/tenants?page%5Bsize%5D=100&sort=displayName', body: undefined },
        { method: 'GET', path: path(), body: undefined },
      ]);
      await open(parity, 'single'); await ready(parity);
      await expect(parity.page.locator('p[aria-live="polite"]')).toHaveText('1 plan');
      await check.assertLocale(parity);
    });
    test('action', async ({ parity, server }) => {
      await open(parity); await ready(parity);
      await parity.page.getByRole('button', { name: locale === 'es' ? 'Página 2' : 'Page 2', exact: true }).click();
      await ready(parity, 'synthetic-plan-21');
      expect(calls(parity).at(-1)).toEqual({ method: 'GET', path: path('all', 2), body: undefined });
      await select(parity, copy(parity).filter, copy(parity).status.active); await ready(parity, 'synthetic-plan-2');
      expect(calls(parity).at(-1).path).toBe(path('active'));
      await select(parity, copy(parity).filter, copy(parity).status.all); await ready(parity);
      expect(calls(parity).at(-1).path).toBe(path());
      await parity.page.getByRole('button', { name: locale === 'es' ? 'Página 2' : 'Page 2', exact: true }).click(); await ready(parity, 'synthetic-plan-21');
      await select(parity, copy(parity).rowsPerPage, '50'); await ready(parity);
      expect(calls(parity).at(-1).path).toBe(path('all', 1, 50)); await expect(rows(parity)).toHaveCount(45);
      states.get(parity).variant = 'archived-empty';
      await select(parity, copy(parity).filter, copy(parity).status.archived);
      await expect(parity.page.getByRole('button', { name: copy(parity).clear, exact: true })).toBeVisible();
      states.get(parity).variant = '45-mixed';
      await parity.page.getByRole('button', { name: copy(parity).clear, exact: true }).click(); await ready(parity);
      expect(calls(parity).at(-1).path).toBe(path('all', 1, 50));
      for (const action of ['slug', 'open', 'create']) {
        await open(parity); await ready(parity);
        const target = action === 'create' ? parity.page.getByRole('button', { name: copy(parity).create, exact: true }) : parity.page.getByRole('link', { name: action === 'slug' ? 'synthetic-plan-1' : locale === 'es' ? 'Abrir plan Synthetic Plan 1' : 'Open plan Synthetic Plan 1', exact: true });
        await target.focus(); await parity.page.keyboard.press('Enter');
        await expect(parity.page).toHaveURL(server.url(action === 'create' ? 'console/plans/new' : 'console/plans/synthetic-plan-1'));
      }
    });
    test('error-empty', async ({ parity, server }) => {
      await open(parity, 'empty'); await expect(heading(parity, 'empty')).toBeVisible();
      await expect(parity.page.getByRole('button', { name: copy(parity).create, exact: true })).toHaveCount(2);
      await open(parity, 'archived-empty');
      await select(parity, copy(parity).filter, copy(parity).status.archived);
      await expect(parity.page.getByRole('heading', { name: locale === 'es' ? 'No hay planes con estado Archivado' : 'No plans with status Archived', exact: true })).toBeVisible();
      await expect(parity.page.getByRole('button', { name: copy(parity).clear, exact: true })).toBeVisible();
      for (const [variant, key] of [['403', 'noAccess'], ['404', 'notFound'], ['500', 'errorTitle'], ['network', 'errorTitle']]) {
        await open(parity, variant); await expect(heading(parity, key)).toBeVisible();
        await expect(parity.page.getByRole('table')).toHaveCount(0);
        if (variant === '500') await expect(parity.page.getByText('req_synthetic_catalog_500', { exact: true })).toBeVisible();
        if (variant === '404') await expect(parity.page.getByRole('link', { name: copy(parity).overview, exact: true })).toHaveAttribute('href', '/console/overview');
        await expect(retry(parity)).toHaveCount(['500', 'network'].includes(variant) ? 1 : 0);
        await check.assertAccessibility(parity);
      }
      await open(parity, 'loading');
      await expect(parity.page.getByRole('status', { name: copy(parity).loading, exact: true })).toBeVisible(); await ready(parity);
      await open(parity, '401');
      await expect(parity.page).toHaveURL(server.url('login'));
      expect(parity.network.requests.filter((request) => request.path.endsWith('/refresh'))).toHaveLength(1);
      expect(await parity.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(server.url('console/plans')).pathname);
    });
    test('accessibility', async ({ parity }) => {
      await open(parity); await ready(parity); await check.assertAccessibility(parity);
      const control = filter(parity);
      await control.focus(); await parity.page.keyboard.press('ArrowDown');
      await expect(parity.page.getByRole('listbox')).toBeVisible();
      await parity.page.keyboard.press('Escape'); await expect(control).toBeFocused();
      await select(parity, copy(parity).filter, copy(parity).status.active); await ready(parity, 'synthetic-plan-2');
      await expect(control).toBeFocused();
      await select(parity, copy(parity).filter, copy(parity).status.all); await ready(parity);
      const next = parity.page.getByRole('button', { name: copy(parity).next, exact: true });
      await next.focus(); await parity.page.keyboard.press('Enter'); await ready(parity, 'synthetic-plan-21'); await expect(next).toBeFocused();
      await parity.page.keyboard.press('Enter'); await ready(parity, 'synthetic-plan-41');
      await expect(parity.page.getByRole('button', { name: locale === 'es' ? 'Página 3' : 'Page 3', exact: true })).toBeFocused();
      await open(parity, 'archived-empty'); await select(parity, copy(parity).filter, copy(parity).status.archived);
      states.get(parity).variant = '45-mixed';
      await parity.page.getByRole('button', { name: copy(parity).clear, exact: true }).click(); await ready(parity); await expect(filter(parity)).toBeFocused();
      await open(parity, '500-then-success'); await retry(parity).click(); await ready(parity);
      await expect(parity.page.locator('caption')).toBeFocused();
      expect(calls(parity).slice(-2)).toEqual([{ method: 'GET', path: path(), body: undefined }, { method: 'GET', path: path(), body: undefined }]);
      await check.assertAccessibility(parity); await check.assertLocale(parity);
    });
    test('kit-conformance', async ({ parity }) => {
      await check.kitConformance(manifest); await open(parity); await ready(parity);
      await expect(parity.page.getByRole('searchbox')).toHaveCount(0);
      await expect(parity.page.locator('.console-plan-catalog option.bg-card, .console-plan-catalog option.text-foreground')).toHaveCount(0);
      await check.assertLocale(parity);
    });
    test('runtime-health', async ({ parity }) => {
      await open(parity); await ready(parity);
      states.get(parity).variant = 'network';
      await parity.page.getByRole('button', { name: copy(parity).next, exact: true }).click();
      await expect(heading(parity, 'errorTitle')).toBeVisible(); await expect(parity.page.getByRole('table')).toHaveCount(0);
      states.get(parity).variant = '45-mixed';
      await retry(parity).click(); await ready(parity, 'synthetic-plan-21');
      expect(calls(parity).slice(-2).map((request) => request.path)).toEqual([path('all', 2), path('all', 2)]);
      await check.assertRuntimeHealth(parity);
    });
    test('responsive', async ({ parity }) => {
      await open(parity); await ready(parity); await check.assertResponsive(parity, width);
      const scroll = parity.page.getByRole('table').locator('..');
      await expect(scroll).toBeVisible();
      expect(await scroll.evaluate((element) => getComputedStyle(element).overflowX)).toMatch(/auto|scroll/);
      // The kit makes the container a named keyboard stop only when it overflows.
      if (await scroll.evaluate((element) => element.scrollWidth > element.clientWidth + 1)) {
        await expect(scroll).toHaveAttribute('role', 'region');
        await expect(scroll).toHaveAccessibleName(copy(parity).caption);
        await expect(scroll).toHaveAttribute('tabindex', '0');
        await scroll.focus(); await parity.page.keyboard.press('ArrowRight');
        await expect.poll(() => scroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      }
      await open(parity, 'archived-empty'); await select(parity, copy(parity).filter, copy(parity).status.archived); await check.assertResponsive(parity, width);
      if (width === 375) {
        const clear = await parity.page.getByRole('button', { name: copy(parity).clear, exact: true }).boundingBox();
        const create = await parity.page.getByRole('button', { name: copy(parity).create, exact: true }).last().boundingBox();
        expect(create.y).toBeGreaterThanOrEqual(clear.y + clear.height);
      }
    });
    test('visual-review', async ({ parity }, info) => {
      for (const [variant, key] of [['45-mixed', 'title'], ['empty', 'empty'], ['archived-empty', 'empty'], ['500', 'errorTitle']]) {
        await open(parity, variant); await expect(heading(parity, key)).toBeVisible();
        if (variant === '45-mixed') await ready(parity);
        if (variant === 'archived-empty') await select(parity, copy(parity).filter, copy(parity).status.archived);
        await snapshot(parity, info, variant);
      }
      // Artifacts are evidence for the independent checker and operator's visual approval.
    });

  });
}
for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`Catalog CSP negatives ${locale} ${width}`, () => {
    test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test('CSP fixture handler rejects an extra catalog key and unrelated queries', async ({ parity }) => {
      const unmatched = await installSession(parity.page);
      await open(parity); await ready(parity);
      // Requests are caught in the browser so deliberate aborts do not create rejections.
      await parity.page.evaluate(async () => {
        for (const path of ['/v1/plans?page=1&pageSize=20&foo=1', '/v1/platform/runtime/knative?page=1']) {
          try { await fetch(path); } catch { /* Expected fail-closed fixture rejection. */ }
        }
      });
      expect(unmatched).toEqual(['GET /v1/plans?page=1&pageSize=20&foo=1', 'GET /v1/platform/runtime/knative?page=1']);
    });
  });
}

for (const role of ['member', 'tenant_owner', 'platform_auditor']) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`Catalog permission denial ${role} ${locale} ${width}`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test('denies access without a catalog request', async ({ parity, server }) => {
      parity.network.setVariants({ tenants: 'empty' });
      await parity.page.goto(server.url('console/plans'));
      await expect(parity.page.getByRole('heading', { name: locale === 'es' ? 'Acceso denegado' : 'Access denied', exact: true })).toBeVisible();
      expect(calls(parity)).toHaveLength(0);
      await check.assertRuntimeHealth(parity);
    });
  });
}
