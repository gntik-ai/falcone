import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { flowPath, taskTypesPath, versionPath, triggerPath, flowRecord, designerResponse } from './console-flow-designer-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';
import { seedDesignerPrincipal } from './console-flow-designer-page.session.mjs';

const copies = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-flow-designer-page.json`, import.meta.url), 'utf8'))]));
const state = new WeakMap();
const copy = (parity) => copies[parity.locale];
const surface = (parity) => parity.page.getByTestId('console-flow-designer-page');
const calls = (parity) => parity.network.requests.filter(({ path }) => path === flowPath || path === taskTypesPath || path === versionPath || path === triggerPath);
async function open(parity, variant = 'success', shell = {}) {
  state.set(parity, { variant, attempts: 0, authorizations: [] });
  await parity.open(manifest.route, { ...shell, ...(variant === '401-refresh-rejected' ? { refresh: '401' } : {}) });
}
async function ready(parity) { await expect(parity.page.getByRole('heading', { name: flowRecord.name, exact: true })).toBeVisible(); await expect(parity.page.getByTestId('flow-palette-item-synthetic-task')).toBeAttached(); }
async function tab(parity, mode) { await parity.page.getByRole('tab', { name: copy(parity)[mode], exact: true }).click(); }
async function palette(parity) {
  const item = parity.page.getByTestId('flow-palette-item-synthetic-task');
  if (!await item.isVisible()) await surface(parity).getByRole('button', { name: copy(parity).palette, exact: true }).click();
  return item;
}
async function screenshot(parity, info, name) {
  const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
  await info.attach(`${name}-${parity.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}
for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-flow-designer-page | superadmin | ${locale} | ${width}`, () => {
    test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity }) => {
      const injected = [];
      await parity.page.route((url) => url.pathname === flowPath && !url.search, async (route) => {
        const request = route.request(), current = state.get(parity) ?? { variant: 'success', attempts: 0, authorizations: [] };
        if (request.method() !== 'GET') { injected.push({ url: request.url(), kind: '422' }); injected.push({ url: request.url(), kind: '403' }); return route.fallback(); }
        parity.network.requests.push({ method: 'GET', path: flowPath, body: undefined });
        current.authorizations.push(request.headers().authorization);
        const attempt = current.attempts++;
        const variant = current.variant.startsWith('401-') ? attempt === 0 ? '401' : 'success' : current.variant;
        const response = designerResponse(variant);
        if (response.delayMs) await new Promise((done) => setTimeout(done, response.delayMs));
        if (response.network || response.status >= 400) injected.push({ url: request.url(), kind: response.network ? 'network' : String(response.status) });
        if (response.network) await route.abort('failed'); else await route.fulfill({ status: response.status, json: response.body });
      });
      // Match only browser diagnostics associated with the fixture failures in this test.
      parity.page.on('console', (message) => {
        if (message.type() !== 'error' || !consumeResourceDiagnostic(message.text(), message.location().url, injected)) return;
        const index = parity.faults.indexOf(`console.error: ${message.text()}`); if (index >= 0) parity.faults.splice(index, 1);
      });
    });
    test('data', async ({ parity }) => {
      await open(parity); await ready(parity);
      await expect(parity.page.locator('.react-flow__node')).toHaveCount(7);
      await expect(parity.page.locator('.react-flow__edge')).toHaveCount(9);
      expect(calls(parity)).toEqual([{ method: 'GET', path: flowPath, body: undefined }, { method: 'GET', path: taskTypesPath, body: undefined }]);
      await tab(parity, 'yaml'); await expect(parity.page.locator('.monaco-editor')).toBeVisible();
      await expect(parity.page.getByTestId('flow-yaml-editor')).toHaveAttribute('data-yaml-valid', 'true');
      await check.assertLocale(parity);
    });
    test('action', async ({ parity }) => {
      // Mirror the legacy draft -> save -> publish -> revert journey against the same fixtures.
      await open(parity); await ready(parity);
      const item = await palette(parity); await item.focus(); await parity.page.keyboard.press('Enter');
      await expect(parity.page.locator('.react-flow__node[data-id="synthetic-task-1"]')).toBeFocused();
      await parity.page.getByTestId('save-draft-button').click(); await expect(parity.page.getByTestId('saved-indicator')).toBeVisible();
      const patch = calls(parity).find(({ method }) => method === 'PATCH');
      expect(patch.body.definition.nodes).toContainEqual({ id: 'synthetic-task-1', type: 'task', taskType: 'synthetic-task', input: {} });
      parity.network.setVariants({ 'flows.patch': 'success', 'flows.versions.post': 'success' });
      await parity.page.getByTestId('publish-button').click(); await expect(parity.page.getByTestId('published-version-badge')).toContainText('2');
      expect(calls(parity).slice(-2).map(({ method, path }) => [method, path])).toEqual([['PATCH', flowPath], ['POST', versionPath]]);
      await surface(parity).getByRole('button', { name: copy(parity).revert, exact: true }).click();
      await expect(parity.page.locator('.react-flow__node')).toHaveCount(7);
      await tab(parity, 'yaml'); await expect(parity.page.locator('.monaco-editor')).toBeVisible();
      const editor = parity.page.locator('.monaco-editor').first(); await editor.click(); await parity.page.keyboard.press('ControlOrMeta+A'); await parity.page.keyboard.insertText('nodes: [broken');
      await expect(parity.page.getByTestId('designer-yaml-degraded-banner')).toBeVisible();
      const before = calls(parity).filter(({ method }) => method === 'PATCH').length;
      await parity.page.getByTestId('save-draft-button').click(); expect(calls(parity).filter(({ method }) => method === 'PATCH')).toHaveLength(before);
    });
    test('error-empty', async ({ parity }) => {
      for (const variant of ['403', '404', '500', 'network']) {
        await open(parity, variant);
        await expect(parity.page.getByRole('heading', { name: copy(parity)[variant === '403' ? 'noAccess' : variant === '404' ? 'notFound' : 'errorTitle'], exact: true })).toBeVisible();
        if (variant === '500') await expect(parity.page.getByText('req_synthetic_designer', { exact: true })).toBeVisible();
      }
      await open(parity, 'empty-draft', { 'flows.task-types': 'empty' });
      await expect(parity.page.getByRole('heading', { name: copy(parity).emptyCanvas })).toBeVisible(); const panel = surface(parity).getByRole('complementary', { name: copy(parity).palette, exact: true }); if (!await panel.isVisible()) await surface(parity).getByRole('button', { name: copy(parity).palette, exact: true }).click(); await expect(parity.page.getByText(copy(parity).paletteEmpty)).toBeVisible();
      const checkpoint = calls(parity).length; await open(parity, 'success', { workspaces: 'empty' }); await expect(parity.page.getByRole('heading', { name: copy(parity).blocked })).toBeVisible();
      // Only traffic after this navigation belongs to the no-workspace assertion.
      await parity.page.waitForTimeout(50); expect(calls(parity)).toHaveLength(checkpoint);
    });
    test('accessibility', async ({ parity }) => {
      await open(parity, 'published'); await ready(parity);
      for (const mode of ['canvas', 'yaml', 'side-by-side']) { await tab(parity, mode); if (mode !== 'canvas') await expect(parity.page.locator('.monaco-editor')).toBeVisible(); await check.assertAccessibility(parity); await check.assertLocale(parity); }
      await tab(parity, 'canvas'); const item = await palette(parity); await item.focus(); await parity.page.keyboard.press('Space');
      const node = parity.page.locator('.react-flow__node[data-id="synthetic-task-1"]'); await expect(node).toBeFocused();
      await parity.page.keyboard.press('Enter'); await expect(parity.page.locator('#flow-inspector-heading')).toBeFocused();
      await parity.page.getByLabel(copy(parity).name, { exact: true }).fill('Synthetic edited task'); await parity.page.keyboard.press('Escape'); await expect(node).toBeFocused();
      const before = await node.getAttribute('style'); await parity.page.keyboard.press('ArrowRight'); await expect(node).not.toHaveAttribute('style', before);
      await tab(parity, 'yaml'); await parity.page.locator('.monaco-editor').click(); await parity.page.keyboard.press('Control+M'); await parity.page.keyboard.press('Tab');
      expect(await parity.page.evaluate(() => !document.activeElement.closest('.monaco-editor'))).toBe(true);
      await tab(parity, 'canvas'); const run = parity.page.getByTestId('flow-run-now-button'); await run.click();
      await parity.page.getByTestId('confirm-action-cancel').click(); await expect(run).toBeFocused();
    });
    test('runtime-health', async ({ parity }) => {
      const assets = [], workers = [];
      parity.page.on('request', (request) => { if (/monaco-chunk/.test(request.url())) assets.push(request.url()); });
      parity.page.on('worker', (worker) => workers.push(worker.url()));
      await open(parity); await ready(parity); expect(assets).toHaveLength(0); expect(workers).toHaveLength(0);
      await tab(parity, 'yaml'); await expect(parity.page.locator('.monaco-editor')).toBeVisible();
      await expect.poll(() => workers.length).toBeGreaterThan(0);
      for (const url of workers) expect(url.startsWith('blob:') || new URL(url).origin === new URL(parity.page.url()).origin).toBe(true);
      await check.assertRuntimeHealth(parity);
    });
    test('responsive', async ({ parity }) => {
      await open(parity); await ready(parity);
      for (const mode of ['canvas', 'yaml', 'side-by-side']) { await tab(parity, mode); await check.assertResponsive(parity, width); }
      if (width === 1280) { await expect(surface(parity).getByRole('complementary', { name: copy(parity).palette })).toBeVisible(); await expect(surface(parity).getByRole('complementary', { name: copy(parity).inspector })).toBeVisible(); }
    });
    test('visual-review', async ({ parity }, info) => {
      await open(parity); await ready(parity);
      for (const mode of ['canvas', 'yaml', 'side-by-side']) { await tab(parity, mode); if (mode !== 'canvas') await expect(parity.page.locator('.monaco-editor')).toBeVisible(); await screenshot(parity, info, mode); }
      for (const variant of ['403', '500']) { await open(parity, variant); await screenshot(parity, info, variant); }
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
    test('PATCH 422 remains raw; versions 422 decorates nodes and lists flow errors', async ({ parity }) => {
      await open(parity); await ready(parity); parity.network.setVariants({ 'flows.patch': '422-node-errors' });
      await parity.page.getByTestId('publish-button').click(); await expect(parity.page.getByTestId('designer-error-banner')).toBeVisible();
      await expect(parity.page.getByTestId('flow-node-error-badge')).toHaveCount(0); expect(calls(parity).some(({ path }) => path === versionPath)).toBe(false);
      await expect(parity.page.getByTestId('unsaved-changes-indicator')).toBeVisible();
      parity.network.setVariants({ 'flows.patch': 'success', 'flows.versions.post': '422-node-errors' });
      await parity.page.getByTestId('publish-button').click(); await expect(parity.page.getByTestId('flow-node-error-badge')).toBeVisible();
      await expect(parity.page.getByTestId('flow-problems-panel')).toContainText('FLW-E007');
      await check.assertAccessibility(parity);
    });
    for (const variant of ['401-refresh-ok', '401-refresh-rejected']) test(variant, async ({ parity, server }) => {
      await open(parity, variant);
      if (variant === '401-refresh-ok') await ready(parity); else {
        await expect(parity.page).toHaveURL(server.url('login'));
        expect(await parity.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(server.url('console/flows/f1')).pathname);
      }
      expect(parity.network.requests.filter(({ path }) => path.endsWith('/refresh'))).toHaveLength(1);
      expect(calls(parity).filter(({ method, path }) => method === 'GET' && path === flowPath)).toHaveLength(variant === '401-refresh-ok' ? 2 : 1);
      if (variant === '401-refresh-ok') expect(state.get(parity).authorizations).toEqual(['Bearer synthetic-access-token', 'Bearer synthetic-refreshed-access-token']);
    });
  });
}
