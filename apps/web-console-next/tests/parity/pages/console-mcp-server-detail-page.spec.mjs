import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { detailPath, callPath, detailResponse, server, toolResult } from './console-mcp-server-detail-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';

const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale,
  JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-mcp-server-detail-page.json`, import.meta.url), 'utf8')),
]));
const copy = (parity) => bundles[parity.locale];
const surface = (parity) => parity.page.getByTestId('console-mcp-server-detail-page');
const button = (parity, key) => surface(parity).getByRole('button', { name: copy(parity)[key], exact: true });
const tab = (parity, key) => surface(parity).getByRole('tab', { name: copy(parity)[key], exact: true });
const calls = (parity) => parity.network.requests.filter(({ path }) => path.startsWith(detailPath));
const state = new WeakMap();
async function ready(parity) { await expect(surface(parity).getByRole('heading', { name: 'Acme Orders', exact: true })).toBeVisible(); }
async function open(parity, variant = 'success', shell = {}) {
  state.set(parity, { variant, reads: 0, posts: 0, toolFailure: false });
  await parity.open(manifest.route, shell);
}
async function snapshot(parity, info, name) {
  await check.assertLocale(parity);
  const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
  await info.attach(`${name}-${parity.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}
for (const role of manifest.roles) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`MCP ${role} ${locale} ${width}`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity }) => {
      const injected = [];
      await parity.page.route((url) => [detailPath, callPath].includes(url.pathname), async (route) => {
        const request = route.request(), url = new URL(request.url());
        const body = request.postDataJSON() ?? undefined;
        parity.network.requests.push({ method: request.method(), path: url.pathname + url.search, body });
        const current = state.get(parity);
        if (!current || url.search || (url.pathname === detailPath ? request.method() !== 'GET' || body : request.method() !== 'POST' || !body || Object.keys(body).sort().join(',') !== 'arguments,name')) {
          parity.faults.push(`Unmatched MCP request ${request.method()} ${url.pathname}${url.search}`);
          await route.abort(); return;
        }
        let response;
        if (url.pathname === callPath) {
          current.posts++;
          response = current.toolFailure ? { status: 500, body: { message: 'synthetic-backend-reason' } } : { status: 200, body: toolResult };
        } else {
          const attempt = current.reads++;
          const variant = current.variant === '401-ok' ? (attempt === 0 ? '401' : 'success') : current.variant === '401-rejected' ? '401' : current.variant;
          response = detailResponse(variant);
        }
        if (response.delayMs) await new Promise((resolve) => setTimeout(resolve, response.delayMs));
        if (response.network || response.status >= 400) injected.push({ url: request.url(), kind: response.network ? 'network' : String(response.status) });
        if (response.network) await route.abort('failed');
        else await route.fulfill({ status: response.status ?? 200, json: response.body });
      });
      // Consume only diagnostics for exact injected MCP failures; application faults stay fatal.
      parity.page.on('console', (message) => {
        if (message.type() !== 'error' || !consumeResourceDiagnostic(message.text(), message.location().url, injected)) return;
        const index = parity.faults.indexOf(`console.error: ${message.text()}`);
        if (index >= 0) parity.faults.splice(index, 1);
      });
    });
    test.describe(`console-mcp-server-detail-page | ${role} | ${locale} | ${width}`, () => {
    test('data', async ({ parity }) => {
      await open(parity); await ready(parity);
      await expect(surface(parity).getByTestId('mcp-detail-endpoint')).toHaveText(server.endpointUrl);
      await expect(surface(parity).getByText('v3', { exact: true })).toBeVisible();
      await expect(surface(parity).getByText('running', { exact: true })).toBeVisible();
      await expect(surface(parity).getByTestId('mcp-detail-tools').locator('li')).toHaveCount(2);
      await expect(surface(parity).getByText(copy(parity).mutates, { exact: true })).toBeVisible();
      await expect(surface(parity).getByText(locale === 'es' ? '2 publicadas' : '2 published', { exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('region', { name: copy(parity).history, exact: true })).toHaveText(copy(parity).emptyHistory);
      await expect(surface(parity).getByRole('region', { name: copy(parity).history, exact: true }).locator('li')).toHaveCount(0);
      await expect(surface(parity).getByTestId('mcp-connect-panel').locator('a[href]')).toHaveCount(0);
      const code = surface(parity).getByRole('region', { name: copy(parity).cursor, exact: true });
      await expect(code).toHaveText(`cursor://anysphere.cursor-deeplink/mcp/install?name=acme-orders&config=${Buffer.from(JSON.stringify({ url: server.endpointUrl })).toString('base64')}`);
      expect(calls(parity)).toEqual([{ method: 'GET', path: detailPath, body: undefined }]);
      await check.assertLocale(parity);
    });
    test('action', async ({ parity }) => {
      await open(parity); await ready(parity); await tab(parity, 'playground').click();
      const args = surface(parity).getByLabel(copy(parity).arguments, { exact: true });
      await args.fill('{invalid'); await button(parity, 'invoke').click();
      await expect(args).toHaveAttribute('aria-invalid', 'true'); await expect(surface(parity).locator('#mcp-invoke-error')).toHaveText(copy(parity).invalidJson);
      expect(calls(parity)).toHaveLength(1);
      await args.fill(''); await button(parity, 'invoke').click();
      await expect(surface(parity).getByRole('tree', { name: copy(parity).result, exact: true })).toContainText('synthetic-tool-result');
      expect(calls(parity)).toEqual([{ method: 'GET', path: detailPath, body: undefined }, { method: 'POST', path: callPath, body: { name: 'list_orders', arguments: {} } }]);
      await expect(button(parity, 'invoke')).toBeFocused();
      await expect(parity.page.locator('[aria-live="polite"]').filter({ hasText: copy(parity).resultAnnouncement })).toHaveCount(1);
      await check.assertLocale(parity);
      state.get(parity).toolFailure = true; await button(parity, 'invoke').click();
      await expect(surface(parity).locator('#mcp-invoke-error')).toHaveText(copy(parity).invokeError);
      await expect(button(parity, 'invoke')).toBeFocused();
      await expect(parity.page.locator('[aria-live="assertive"]').filter({ hasText: copy(parity).invokeError })).toHaveCount(1);
    });
    test('error-empty', async ({ parity }) => {
      for (const variant of ['empty', 'no-endpoint', 'runtime-not-ready', '403', '404', '500', 'network']) {
        await open(parity, variant);
        if (['empty', 'no-endpoint', 'runtime-not-ready'].includes(variant)) {
          await ready(parity); await tab(parity, 'playground').click();
          if (variant === 'empty') await expect(surface(parity).getByRole('heading', { name: copy(parity).playgroundEmpty, exact: true })).toBeVisible();
          else { await expect(button(parity, 'invoke')).toBeDisabled(); await expect(surface(parity).getByText(copy(parity)[variant === 'no-endpoint' ? 'noEndpointDescription' : 'runtimeUnavailable'], { exact: true })).toBeVisible(); }
        } else {
          await expect(surface(parity).getByRole('heading', { name: copy(parity)[variant === '403' ? 'noAccess' : variant === '404' ? 'notFound' : 'errorTitle'], exact: true })).toBeVisible();
          await expect(surface(parity).getByTestId('mcp-server-detail')).toHaveCount(0);
          await expect(surface(parity).getByText('synthetic-backend-reason', { exact: true })).toHaveCount(0);
          if (variant === '404') await expect(surface(parity).getByRole('link', { name: copy(parity).backOverview, exact: true })).toHaveAttribute('href', '/console/overview');
          if (variant === '500') await expect(surface(parity).getByText('req_synthetic_mcp', { exact: true })).toBeVisible();
          if (variant === '500' || variant === 'network') { state.get(parity).variant = 'success'; await button(parity, 'retry').click(); await ready(parity); expect(state.get(parity).reads).toBe(2); }
        }
        await check.assertLocale(parity);
      }
      await open(parity, 'success', { workspaces: 'empty' });
      await expect(surface(parity).getByRole('heading', { name: copy(parity).workspaceRequired, exact: true })).toBeVisible();
      expect(state.get(parity).reads).toBe(0); await check.assertLocale(parity);
    });
    test('accessibility', async ({ parity }) => {
      await open(parity); await ready(parity); await check.assertAccessibility(parity);
      await tab(parity, 'connect').focus();
      for (const [key, selected] of [['ArrowRight', 'playground'], ['Home', 'connect'], ['End', 'playground'], ['ArrowLeft', 'connect']]) {
        await parity.page.keyboard.press(key); await expect(tab(parity, selected)).toBeFocused(); await expect(tab(parity, selected)).toHaveAttribute('aria-selected', 'true');
      }
      await parity.page.evaluate(() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value) => { window.__copied.push(value); } } }); });
      const control = surface(parity).locator('#mcp-cursor').locator('..').getByRole('button');
      await expect(control).toHaveText((locale === 'es' ? 'Copiar ' : 'Copy ') + copy(parity).cursor);
      await control.focus(); await parity.page.keyboard.press('Enter'); await expect(control).toBeFocused();
      expect(await parity.page.evaluate(() => window.__copied)).toEqual([`cursor://anysphere.cursor-deeplink/mcp/install?name=acme-orders&config=${Buffer.from(JSON.stringify({ url: server.endpointUrl })).toString('base64')}`]);
      await expect(parity.page.locator('[aria-live="polite"]').filter({ hasText: copy(parity).copyAnnouncement })).toHaveCount(1);
      await tab(parity, 'playground').click(); await check.assertAccessibility(parity); await check.assertLocale(parity);
    });
    test('runtime-health', async ({ parity }) => {
      await open(parity); await ready(parity); await tab(parity, 'playground').click(); await button(parity, 'invoke').click();
      await expect(surface(parity).getByRole('tree', { name: copy(parity).result, exact: true })).toBeVisible();
      await check.assertRuntimeHealth(parity);
    });
    test('responsive', async ({ parity }) => {
      await open(parity); await ready(parity); await check.assertResponsive(parity, width);
      await tab(parity, 'playground').click(); await check.assertResponsive(parity, width);
      // Long endpoint and scope data must wrap at every approved viewport.
      await parity.page.route((url) => url.pathname === detailPath, (route) => route.fulfill({ json: { ...server, endpointUrl: server.endpointUrl + '/'.repeat(180), activeVersion: { ...server.activeVersion, tools: [{ name: 'long', scope: 'scope'.repeat(80) }] } } }));
      await parity.open(manifest.route); await ready(parity); await check.assertResponsive(parity, width);
      const metadata = surface(parity).locator('.mcp-description > div:last-child');
      expect(await metadata.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(width < 768 ? 1 : 3);
    });
    test('visual-review', async ({ parity }, info) => {
      await open(parity); await ready(parity); await snapshot(parity, info, 'connect-empty-history');
      await tab(parity, 'playground').click(); await button(parity, 'invoke').click();
      await expect(surface(parity).getByRole('tree', { name: copy(parity).result, exact: true })).toBeVisible(); await snapshot(parity, info, 'playground-result');
      await open(parity, 'empty'); await ready(parity); await snapshot(parity, info, 'no-tools');
      await open(parity, '500'); await expect(surface(parity).getByRole('heading', { name: copy(parity).errorTitle, exact: true })).toBeVisible(); await snapshot(parity, info, 'load-error');
    });
    test('kit-conformance', async ({ parity }) => {
      await open(parity); await ready(parity); await check.kitConformance(manifest);
      await expect(surface(parity).getByText(/api-gateway-prod|Production deployment|Show earlier|Policies/, { exact: true })).toHaveCount(0);
      await check.assertLocale(parity);
    });
    });
    for (const variant of ['401-ok', '401-rejected']) test(`refresh ${variant}`, async ({ parity, server: localServer }) => {
      await open(parity, variant, variant === '401-rejected' ? { refresh: '401' } : {});
      if (variant === '401-ok') await ready(parity);
      else {
        await expect(parity.page).toHaveURL(localServer.url('login'));
        expect(await parity.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(localServer.url(manifest.route.slice(1))).pathname);
      }
      expect(state.get(parity).reads).toBe(variant === '401-ok' ? 2 : 1);
      expect(parity.network.requests.filter(({ path }) => path.endsWith('/refresh'))).toHaveLength(1);
    });
  });
}
