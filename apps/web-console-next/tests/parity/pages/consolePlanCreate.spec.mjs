import { createHash } from 'node:crypto';
import manifest, { planPath, planBody } from './consolePlanCreate.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';
import es from '../../../src/locales/es/pages.console-plan-create-page.json' with { type: 'json' };
import en from '../../../src/locales/en/pages.console-plan-create-page.json' with { type: 'json' };

const copy = (parity) => parity.locale === 'es' ? es : en;
const button = (parity, key) => parity.page.getByRole('button', { name: copy(parity)[key], exact: true });
const field = (parity, key) => parity.page.getByLabel(copy(parity)[key], { exact: true });
const calls = (parity) => parity.network.requests.filter((request) => request.path === planPath);
async function fill(parity) {
  await field(parity, 'slug').fill(planBody.slug);
  await field(parity, 'displayName').fill('  Starter  ');
  await field(parity, 'description').fill(planBody.description);
}
async function open(parity, variant = 'success', extra = {}) {
  await parity.open(manifest.route, { tenants: 'empty', 'plans.create': variant, ...extra });
  await expect(field(parity, 'slug')).toBeVisible();
}
async function fail(parity, variant = '500') {
  await open(parity, variant); await fill(parity); await button(parity, 'create').click();
  await expect(parity.page.getByTestId('error-panel')).toBeVisible();
}
async function snapshot(parity, info, name) {
  await check.assertLocale(parity);
  const image = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
  const digest = createHash('sha256').update(image).digest('hex');
  await info.attach(`${name}-${parity.locale}-sha256-${digest}`, { body: image, contentType: 'image/png' });
}

for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`consolePlanCreate | ${locale} | ${width}`, () => {
    test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity }) => {
      // Match the approved first-visit fixture and retain the real shared session transport.
      await parity.page.route(/\/assets\/app-[^/]+\.js$/, async (route) => {
        // Init scripts have completed before the app entry is allowed to execute.
        await parity.page.evaluate(() => {
          const key = 'in-falcone.console-shell-session';
          const session = JSON.parse(sessionStorage.getItem(key));
          session.principal.tenantIds = []; session.principal.workspaceIds = [];
          sessionStorage.setItem(key, JSON.stringify(session));
        });
        await route.fallback();
      });
      // The shared harness only consumes diagnostics for its original endpoint set.
      // Page-local filtering accounts for deliberately injected create failures without
      // suppressing application console errors, CSP errors or unhandled rejections.
      const injected = [];
      parity.page.on('response', (response) => {
        if (new URL(response.url()).pathname === planPath && response.request().method() === 'POST' && [400, 401, 403, 404, 409, 500].includes(response.status())) {
          injected.push({ url: response.url(), kind: String(response.status()) });
        }
      });
      parity.page.on('requestfailed', (request) => {
        if (new URL(request.url()).pathname === planPath && request.method() === 'POST' && request.failure()?.errorText === 'net::ERR_FAILED') injected.push({ url: request.url(), kind: 'network' });
      });
      parity.page.on('console', (message) => {
        if (message.type() !== 'error' || !consumeResourceDiagnostic(message.text(), message.location().url, injected)) return;
        const index = parity.faults.indexOf(`console.error: ${message.text()}`);
        if (index >= 0) parity.faults.splice(index, 1);
      });
    });
    test('data', async ({ parity }) => {
      await open(parity);
      await expect(parity.page.locator('main h1')).toHaveText(copy(parity).title);
      await expect(parity.page.getByRole('heading', { name: copy(parity).firstTitle, exact: true })).toBeVisible();
      for (const key of ['slug', 'displayName', 'description']) await expect(field(parity, key)).toHaveValue('');
      // The kit prepends a numbered marker to each item's translated text.
      const checklist = parity.page.getByRole('list').filter({ hasText: copy(parity).stepSlug }).getByRole('listitem');
      await expect(checklist).toHaveCount(4);
      await expect(checklist).toContainText(['stepSlug', 'stepName', 'stepDescription', 'stepLimits'].map((key) => copy(parity)[key]));
      for (const item of await checklist.all()) await expect(item).toBeVisible();
      expect(parity.network.requests).toEqual([{ method: 'GET', path: '/v1/tenants?page%5Bsize%5D=100&sort=displayName', body: undefined }]);
      await button(parity, 'start').click();
      await expect(field(parity, 'slug')).toBeFocused();
      expect(calls(parity)).toHaveLength(0);
      await field(parity, 'slug').fill('starter-2026');
      await expect(parity.page.getByRole('heading', { name: copy(parity).firstTitle, exact: true })).toHaveCount(0);
      await expect(parity.page.getByRole('link', { name: copy(parity).discard, exact: true })).toHaveAttribute('href', '/console/plans');
      await expect(parity.page.locator('main').getByRole('link', { name: copy(parity).catalog, exact: true })).toHaveAttribute('href', '/console/plans');
    });
    test('action', async ({ parity, server }) => {
      for (const variant of ['success', '500-then-success', 'network-then-success']) {
        await open(parity, variant);
        const start = calls(parity).length;
        await fill(parity); await button(parity, 'create').click();
        if (variant !== 'success') {
          await expect(button(parity, 'retry')).toBeVisible();
          await button(parity, 'retry').click();
        }
        await expect(parity.page).toHaveURL(server.url('console/plans/p1'));
        const sent = calls(parity).slice(start);
        expect(sent).toHaveLength(variant === 'success' ? 1 : 2);
        for (const request of sent) expect(request).toEqual({ method: 'POST', path: planPath, body: planBody });
        await expect(parity.page.locator('[aria-live="assertive"]').filter({ hasText: copy(parity).success })).toHaveCount(1);
      }
      await open(parity);
      // Model the unchanged legacy catalog document so Discard can be exercised offline.
      await parity.page.route((url) => url.pathname === '/console/plans', (route) => route.fulfill({ contentType: 'text/html', body: `<html lang="${locale}"><body><main><h1>${copy(parity).catalog}</h1></main></body></html>` }));
      const start = calls(parity).length;
      await parity.page.getByRole('link', { name: copy(parity).discard, exact: true }).click();
      await expect(parity.page).toHaveURL(`${server.origin}/console/plans`);
      expect(calls(parity)).toHaveLength(start);
    });
    test('error-empty', async ({ parity }) => {
      for (const variant of ['500', 'network']) {
        await fail(parity, variant);
        const start = calls(parity).length;
        await parity.page.waitForTimeout(5000);
        expect(calls(parity)).toHaveLength(start);
        await expect(button(parity, 'create')).toBeDisabled();
        if (variant === 'network') {
          await expect(parity.page.getByText(copy(parity).outcomeUnknown, { exact: true })).toBeVisible();
          await expect(parity.page.getByRole('link', { name: copy(parity).back, exact: true })).toHaveAttribute('href', '/console/plans');
        }
        await button(parity, 'retry').click();
        await expect(button(parity, 'retry')).toBeEnabled();
        expect(calls(parity)).toHaveLength(start + 1);
        expect(calls(parity).at(-1).body).toEqual(calls(parity).at(-2).body);
        await field(parity, 'description').fill('Edited');
        await expect(button(parity, 'create')).toBeEnabled();
      }
      for (const [variant, heading] of [['403', 'noAccess'], ['404', 'notFound']]) {
        await fail(parity, variant);
        await expect(parity.page.getByRole('heading', { name: copy(parity)[heading], exact: true })).toBeVisible();
        await expect(field(parity, 'displayName')).toHaveValue('  Starter  ');
        await expect(button(parity, 'retry')).toHaveCount(0);
        await expect(parity.page.getByRole('link', { name: copy(parity).back, exact: true })).toHaveAttribute('href', '/console/plans');
        if (variant === '403') for (const key of ['slug', 'displayName', 'description']) await expect(field(parity, key)).toHaveAttribute('readonly', '');
        await expect(parity.page.getByText(copy(parity).success, { exact: true })).toHaveCount(0);
      }
      for (const [variant, message] of [['400', 'badRequest'], ['409', 'conflict'], ['correlation', 'errorMessage']]) {
        await fail(parity, variant);
        await expect(parity.page.getByText(copy(parity)[message], { exact: true })).toBeVisible();
        if (variant === 'correlation') await expect(parity.page.getByText('corr_synthetic', { exact: true })).toBeVisible();
        await expect(parity.page.getByText('PRIVATE_MARKER')).toHaveCount(0);
      }
    });
    test('accessibility', async ({ parity }) => {
      await open(parity);
      await check.assertAccessibility(parity);
      await button(parity, 'start').click();
      await expect(field(parity, 'slug')).toBeFocused();
      await parity.page.keyboard.press('Tab'); await expect(field(parity, 'displayName')).toBeFocused();
      await parity.page.keyboard.press('Tab'); await expect(field(parity, 'description')).toBeFocused();
      await parity.page.keyboard.press('Tab'); await expect(parity.page.getByRole('link', { name: copy(parity).discard, exact: true })).toBeFocused();
      await parity.page.keyboard.press('Tab'); await expect(button(parity, 'create')).toBeFocused();
      await parity.page.keyboard.press('Enter');
      const summary = parity.page.getByTestId('validation-summary').getByRole('region');
      await expect(summary).toBeFocused();
      await check.assertAccessibility(parity);
      await field(parity, 'slug').fill(planBody.slug); await button(parity, 'create').click();
      await expect(field(parity, 'displayName')).toBeFocused();
      await expect(field(parity, 'displayName')).toHaveAttribute('aria-invalid', 'true');
      await field(parity, 'displayName').fill('Starter');
      await expect(field(parity, 'displayName')).toBeFocused();
      await expect(parity.page.getByTestId('validation-summary').getByRole('region')).toHaveCount(0);
      await fail(parity);
      await expect(parity.page.getByTestId('error-panel')).toBeFocused();
      await check.assertAccessibility(parity);
      await button(parity, 'retry').click();
      await expect(button(parity, 'retry')).toBeFocused();
      // Retry follows the retained fields; Shift+Tab returns through the panel controls.
      await parity.page.keyboard.press('Shift+Tab');
      await expect(parity.page.getByRole('button', { name: copy(parity).details, exact: true })).toBeFocused();
      await parity.page.keyboard.press('Shift+Tab');
      await expect(parity.page.getByRole('button', { name: copy(parity).copyRequestId, exact: true })).toBeFocused();
      await parity.page.keyboard.press('Shift+Tab'); await expect(field(parity, 'description')).toBeFocused();
      await fail(parity, '403'); await check.assertAccessibility(parity);
      await check.assertLocale(parity);
    });
    test('runtime-health', async ({ parity, server }) => {
      for (const variant of ['success', '500-then-success']) {
        await open(parity, variant); await button(parity, 'create').click();
        await fill(parity); await button(parity, 'create').click();
        if (variant !== 'success') await button(parity, 'retry').click();
        await expect(parity.page).toHaveURL(server.url('console/plans/p1'));
        await check.assertRuntimeHealth(parity);
      }
    });
    test('responsive', async ({ parity }) => {
      await open(parity); await check.assertResponsive(parity, width);
      const actionBar = parity.page.getByRole('region', { name: copy(parity).actions, exact: true });
      const assertUncovered = async (target) => {
        // Intersection-based scrolling ignores sticky overlays; honor the page's scroll margin.
        await target.evaluate((element) => element.scrollIntoView({ block: 'end', behavior: 'instant' }));
        await expect(actionBar).toBeInViewport({ ratio: 1 });
        const content = await target.boundingBox();
        const bar = await actionBar.boundingBox();
        const main = await parity.page.getByRole('main').boundingBox();
        expect(content.y).toBeGreaterThanOrEqual(main.y);
        expect(content.y + content.height).toBeLessThanOrEqual(bar.y);
      };
      await assertUncovered(field(parity, 'description'));
      await fail(parity); await check.assertResponsive(parity, width);
      await assertUncovered(parity.page.getByTestId('error-panel'));
    });
    test('visual-review', async ({ parity }, info) => {
      await open(parity); await snapshot(parity, info, 'pristine');
      await button(parity, 'create').click(); await snapshot(parity, info, 'invalid');
      for (const variant of ['403', '500']) { await fail(parity, variant); await snapshot(parity, info, variant); }
      // Hold saving and bootstrap responses so screenshots do not depend on CI timing.
      for (const state of ['loading', 'saving']) {
        let release;
        const held = new Promise((resolve) => { release = resolve; });
        const url = state === 'loading' ? '**/v1/tenants?*' : `**${planPath}`;
        const hold = async (route) => { await held; await route.fallback(); };
        await parity.page.route(url, hold);
        try {
          parity.network.setVariants({ tenants: 'empty', 'plans.create': 'slow' });
          await parity.page.goto(parity.page.url().replace(/console\/.*$/, 'console/plans/new'));
          if (state === 'saving') { await fill(parity); await button(parity, 'create').click(); await expect(button(parity, 'saving')).toBeDisabled(); }
          else await expect(parity.page.getByRole('status', { name: copy(parity).loading, exact: true })).toBeVisible();
          await snapshot(parity, info, state);
        } finally { release(); await parity.page.unroute(url, hold); }
        if (state === 'loading') await expect(field(parity, 'slug')).toBeVisible();
      }
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
    test('401 refresh success and non-retryable refresh rejection preserve the exact intent', async ({ parity, server }) => {
      for (const rejected of [false, true]) {
        await open(parity, rejected ? '401' : '401-then-success', { refresh: rejected ? '401' : 'success' });
        const start = calls(parity).length;
        const refreshStart = parity.network.requests.filter((request) => request.path.endsWith('/refresh')).length;
        await fill(parity); await button(parity, 'create').click();
        await expect(parity.page).toHaveURL(server.url(rejected ? 'login' : 'console/plans/p1'));
        expect(calls(parity)).toHaveLength(start + (rejected ? 1 : 2));
        expect(parity.network.requests.filter((request) => request.path.endsWith('/refresh'))).toHaveLength(refreshStart + 1);
        if (rejected) expect(await parity.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(server.url('console/plans/new')).pathname);
      }
    });
  });
}
for (const role of ['tenant_owner', 'member']) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`consolePlanCreate denied | ${role} | ${locale} | ${width}`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test('superadmin guard renders forbidden without a POST', async ({ parity, server }) => {
      parity.network.setVariants({ tenants: 'empty' });
      // Guard's StatusLayout owns a nested main; parity.open assumes a single main.
      await parity.page.goto(server.url('console/plans/new'));
      await expect(parity.page.locator('#route-status').getByText('403', { exact: true })).toBeVisible();
      expect(calls(parity)).toHaveLength(0);
      await expect(field(parity, 'slug')).toHaveCount(0);
      await check.assertRuntimeHealth(parity);
    });
  });
}
