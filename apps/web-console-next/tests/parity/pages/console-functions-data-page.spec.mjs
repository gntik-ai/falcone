import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { actionsPath, activationsPath, deployPath, invokePath } from './console-functions-data-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';
import { seedHistoryPrincipal } from './console-flow-history-page.session.mjs';
const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-functions-data-page.json`, import.meta.url), 'utf8'))]));
const copy = (parity) => bundles[parity.locale];
const surface = (parity) => parity.page.getByTestId('console-functions-data-page');
const field = (parity, key) => surface(parity).getByRole('textbox', { name: copy(parity)[key], exact: true });
const button = (parity, key) => surface(parity).getByRole('button', { name: copy(parity)[key], exact: true });
const radio = (parity, name) => surface(parity).getByRole('radio', { name });
const billing = 'synthetic-billing (python:3.12)';
const functionCalls = (parity) => parity.network.requests.filter(({ path }) => path.startsWith('/v1/functions'));
const mutations = (parity) => functionCalls(parity).filter(({ method }) => method === 'POST');
async function ready(parity) { await expect(surface(parity).getByRole('table', { name: copy(parity).listLegend, exact: true })).toBeVisible(); }
async function screenshot(parity, info, name) {
  const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
  await info.attach(`${name}-${parity.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}
const defaultSpec = '{"name":"hello","runtime":"nodejs","code":"module.exports=async()=>({ok:true})"}';
const defaultBody = {
  tenantId: 'synthetic-tenant', workspaceId: 'synthetic-workspace', actionName: 'hello',
  source: { kind: 'inline_code', language: 'javascript', inlineCode: 'module.exports=async()=>({ok:true})', entryFile: 'index.js' },
  execution: { runtime: 'nodejs:20', entrypoint: 'main', parameters: {}, environment: {}, limits: { timeoutSeconds: 60, memoryMb: 256 }, webAction: { enabled: false, requireAuthentication: true, rawHttpResponse: false } },
  activationPolicy: { logsAccess: 'workspace_developers', resultAccess: 'workspace_developers', rerunPolicy: 'manual_only', retentionHours: 168 },
};
for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-functions-data-page | superadmin | ${locale} | ${width}`, () => {
    test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity }) => {
      const injected = [];
      const scoped = (url) => new URL(url).pathname.startsWith('/v1/functions') || new URL(url).pathname === '/v1/workspaces';
      parity.page.on('response', (response) => { if (scoped(response.url()) && response.status() >= 400) injected.push({ url: response.url(), kind: String(response.status()) }); });
      parity.page.on('requestfailed', (request) => { if (scoped(request.url())) injected.push({ url: request.url(), kind: 'network' }); });
      parity.page.on('console', (message) => {
        if (message.type() !== 'error' || !consumeResourceDiagnostic(message.text(), message.location().url, injected)) return;
        const index = parity.faults.indexOf(`console.error: ${message.text()}`);
        if (index >= 0) parity.faults.splice(index, 1);
      });
    });
    test('data', async ({ parity }) => {
      await parity.open(manifest.route); await ready(parity);
      const table = surface(parity).getByRole('table', { name: copy(parity).listLegend, exact: true });
      await expect(surface(parity).getByRole('heading', { name: copy(parity).listTitle.replace('{count}', '2'), exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('radio')).toHaveCount(2);
      for (const [name, runtime, id] of [['synthetic-user-hook', 'nodejs:20', 'synthetic-function-1'], ['synthetic-billing', 'python:3.12', 'synthetic-function-2']]) {
        const row = table.getByRole('row').filter({ hasText: name });
        await expect(row).toContainText(runtime); await expect(row).toContainText(id);
      }
      await radio(parity, billing).check();
      await button(parity, 'viewActivations').click();
      const activations = surface(parity).getByRole('table', { name: copy(parity).activationsLabel, exact: true });
      await expect(activations).toBeVisible();
      for (const [id, status, duration] of [['synthetic-activation-1', 'success', '12 ms'], ['synthetic-activation-2', 'failed', '340 ms'], ['synthetic-activation-3', 'running', null]]) {
        const row = activations.getByRole('row').filter({ hasText: id });
        await expect(row).toContainText(status); if (duration) await expect(row).toContainText(duration);
      }
      expect(functionCalls(parity)).toEqual([{ method: 'GET', path: actionsPath, body: undefined }, { method: 'GET', path: activationsPath, body: undefined }]);
      await check.assertLocale(parity);
      await parity.open(manifest.route, { 'functions-data-list': 'actions-60' }); await ready(parity);
      await expect(surface(parity).getByRole('radio')).toHaveCount(60);
      await expect(surface(parity).getByRole('heading', { name: copy(parity).listTitle.replace('{count}', '60'), exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('navigation', { name: /pagin/i })).toHaveCount(0);
    });
    test('action', async ({ parity }) => {
      await parity.open(manifest.route, { 'functions-data-list': ['actions-2', 'actions-3'] }); await ready(parity);
      await radio(parity, billing).check();
      await expect(surface(parity).getByRole('radio', { checked: true })).toHaveCount(1);
      await button(parity, 'invoke').click();
      await expect(surface(parity).getByRole('tree', { name: copy(parity).resultLabel, exact: true })).toBeVisible();
      await expect(surface(parity).getByText('synthetic-hello', { exact: false }).first()).toBeVisible();
      await radio(parity, 'synthetic-user-hook (nodejs:20)').check();
      await expect(surface(parity).getByText(copy(parity).resultEmpty, { exact: true })).toBeVisible();
      await button(parity, 'deploy').click();
      await expect(surface(parity).getByRole('radio')).toHaveCount(3);
      await expect(radio(parity, 'hello (nodejs:20)')).toBeChecked();
      await expect(surface(parity).getByRole('radio', { checked: true })).toHaveCount(1);
      await expect(parity.page.getByText(copy(parity).deployed, { exact: true }).first()).toBeAttached();
      expect(functionCalls(parity)).toEqual([
        { method: 'GET', path: actionsPath, body: undefined },
        { method: 'POST', path: invokePath, body: { parameters: {} } },
        { method: 'POST', path: deployPath, body: defaultBody },
        { method: 'GET', path: actionsPath, body: undefined },
      ]);
    });
    test('error-empty', async ({ parity }) => {
      await parity.open(manifest.route, { tenants: 'empty' });
      await expect(surface(parity).getByRole('heading', { name: copy(parity).blockedTitle, exact: true })).toBeVisible(); expect(functionCalls(parity)).toHaveLength(0);
      // The pinned kit WorkspaceSwitcher in the shell header hard-codes "Select workspace" when none is active, so assert the page copy instead of the whole document.
      await expect(surface(parity).getByText(copy(parity).blockedDescription, { exact: true })).toBeVisible();
      await parity.open(manifest.route, { workspaces: 'empty' });
      await expect(surface(parity).getByRole('heading', { name: copy(parity).workspaceRequired, exact: true })).toBeVisible(); expect(functionCalls(parity)).toHaveLength(0);
      for (const variant of ['actions-empty', 'actions-403', 'actions-500', 'actions-network']) {
        await parity.open(manifest.route, { 'functions-data-list': variant });
        if (variant === 'actions-empty') {
          for (const key of ['listEmpty', 'resultEmpty', 'activationsIdle']) await expect(surface(parity).getByText(copy(parity)[key], { exact: true })).toBeVisible();
        } else {
          await expect(surface(parity).getByRole('heading', { name: copy(parity)[variant === 'actions-403' ? 'noAccess' : 'listError'], exact: true })).toBeVisible();
          if (variant === 'actions-403') await expect(button(parity, 'deploy')).toHaveCount(0);
          if (variant === 'actions-500') await expect(surface(parity).getByText('req_synthetic_actions_500', { exact: true })).toBeVisible();
        }
        await expect(surface(parity).getByRole('table')).toHaveCount(0); await check.assertLocale(parity); await check.assertAccessibility(parity);
      }
      await parity.open(manifest.route, { 'functions-data-activations': 'activations-empty' }); await ready(parity);
      await radio(parity, billing).check(); await button(parity, 'viewActivations').click();
      await expect(surface(parity).getByText(copy(parity).activationsEmpty, { exact: true })).toBeVisible();
      // Invalid input never reaches the network.
      await parity.open(manifest.route); await ready(parity);
      const start = functionCalls(parity).length;
      await field(parity, 'deploySpecLabel').fill('{'); await button(parity, 'deploy').click();
      await expect(surface(parity).getByText(`${copy(parity).specPrefix}: ${copy(parity).jsonInvalid}`, { exact: true })).toBeVisible();
      await expect(field(parity, 'deploySpecLabel')).toHaveAttribute('aria-invalid', 'true');
      await field(parity, 'deploySpecLabel').fill('[1]'); await button(parity, 'deploy').click();
      await expect(surface(parity).getByText(`${copy(parity).specPrefix}: ${copy(parity).jsonObjectExpected}`, { exact: true })).toBeVisible();
      await field(parity, 'deploySpecLabel').fill('{"runtime":"nodejs"}'); await button(parity, 'deploy').click();
      await expect(surface(parity).getByText(copy(parity).actionNameRequired, { exact: true })).toBeVisible();
      await button(parity, 'invoke').click(); await expect(surface(parity).getByText(copy(parity).selectToInvoke, { exact: true })).toBeVisible();
      await button(parity, 'viewActivations').click(); await expect(surface(parity).getByText(copy(parity).selectForActivations, { exact: true })).toBeVisible();
      await radio(parity, billing).check(); await field(parity, 'inputLabel').fill('{'); await button(parity, 'invoke').click();
      await expect(surface(parity).getByText(copy(parity).inputInvalid, { exact: true })).toBeVisible();
      await expect(field(parity, 'inputLabel')).toHaveAttribute('aria-invalid', 'true');
      expect(functionCalls(parity).length).toBe(start);
      // Deploy failure keeps the spec and Reintentar resends the same POST.
      await parity.open(manifest.route, { 'functions-data-deploy': ['deploy-500', 'deploy-accepted'], 'functions-data-list': ['actions-2', 'actions-3'] }); await ready(parity);
      await button(parity, 'deploy').click();
      await expect(surface(parity).getByText('req_synthetic_deploy_500', { exact: true })).toBeVisible();
      await expect(field(parity, 'deploySpecLabel')).toHaveValue(defaultSpec); await expect(button(parity, 'deploy')).toBeFocused();
      await check.assertAccessibility(parity);
      await button(parity, 'retry').click(); await expect(surface(parity).getByRole('radio')).toHaveCount(3);
      expect(mutations(parity)).toEqual([{ method: 'POST', path: deployPath, body: defaultBody }, { method: 'POST', path: deployPath, body: defaultBody }]);
      // Invoke and activations failures keep the typed JSON and show earlier output only as stale.
      for (const variant of ['invoke-500', 'invoke-network']) {
        await parity.open(manifest.route, { 'functions-data-invoke': ['invoke-result', variant, 'invoke-result'] }); await ready(parity);
        await radio(parity, billing).check(); await field(parity, 'inputLabel').fill('{"a":1}');
        await button(parity, 'invoke').click(); await expect(surface(parity).getByText('synthetic-hello', { exact: false }).first()).toBeVisible();
        await button(parity, 'invoke').click();
        await expect(surface(parity).getByRole('heading', { name: copy(parity).invokeError, exact: true })).toBeVisible();
        await expect(surface(parity).getByText(copy(parity).resultStale, { exact: true })).toBeVisible();
        if (variant === 'invoke-500') await expect(surface(parity).getByText('req_synthetic_invoke_500', { exact: true })).toBeVisible();
        await expect(field(parity, 'inputLabel')).toHaveValue('{"a":1}'); await expect(button(parity, 'invoke')).toBeFocused();
        await button(parity, 'retry').click(); await expect(surface(parity).getByText(copy(parity).resultStale, { exact: true })).toHaveCount(0);
      }
      await parity.open(manifest.route, { 'functions-data-invoke': 'invoke-404' }); await ready(parity);
      await radio(parity, billing).check(); await button(parity, 'invoke').click();
      await expect(surface(parity).getByRole('heading', { name: copy(parity).notFound, exact: true })).toBeVisible();
      await surface(parity).getByRole('button', { name: copy(parity).backToList, exact: true }).click(); await expect(surface(parity).getByRole('radio', { checked: true })).toHaveCount(0);
      for (const variant of ['activations-500', 'activations-network']) {
        const before = functionCalls(parity).filter(({ path }) => path === activationsPath).length;
        await parity.open(manifest.route, { 'functions-data-activations': ['activations-3', variant, 'activations-3-refreshed'] }); await ready(parity);
        await radio(parity, billing).check(); await field(parity, 'inputLabel').fill('{"keep":true}');
        await button(parity, 'viewActivations').click(); await expect(surface(parity).getByText('synthetic-activation-1', { exact: true })).toBeVisible();
        await button(parity, 'viewActivations').click();
        await expect(surface(parity).getByRole('heading', { name: copy(parity).activationsError, exact: true })).toBeVisible();
        await expect(surface(parity).getByText(copy(parity).activationsStale, { exact: true })).toBeVisible();
        if (variant === 'activations-500') await expect(surface(parity).getByText('req_synthetic_activations_500', { exact: true })).toBeVisible();
        await expect(field(parity, 'inputLabel')).toHaveValue('{"keep":true}'); await expect(field(parity, 'deploySpecLabel')).toHaveValue(defaultSpec);
        await button(parity, 'retry').click();
        await expect(surface(parity).getByText('synthetic-activation-4', { exact: true })).toBeVisible();
        await expect(surface(parity).getByText(copy(parity).activationsStale, { exact: true })).toHaveCount(0);
        // The request log accumulates across opens within a test: count only this iteration's activations calls.
        expect(functionCalls(parity).filter(({ path }) => path === activationsPath)).toHaveLength(before + 3);
      }
    });
    test('accessibility', async ({ parity }) => {
      await parity.open(manifest.route); await ready(parity); await check.assertAccessibility(parity);
      // Tab enters the selection column once; the arrow keys move the single choice.
      await surface(parity).getByRole('radio').first().focus();
      await parity.page.keyboard.press('ArrowDown');
      await expect(radio(parity, billing)).toBeChecked(); await expect(radio(parity, billing)).toBeFocused();
      await expect(surface(parity).getByRole('radio', { checked: true })).toHaveCount(1);
      await parity.page.keyboard.press('Tab');
      await expect(surface(parity).getByRole('radio', { checked: true })).toHaveCount(1);
      await button(parity, 'invoke').focus(); await parity.page.keyboard.press('Enter');
      await expect(surface(parity).getByRole('tree', { name: copy(parity).resultLabel, exact: true })).toBeVisible();
      await expect(button(parity, 'invoke')).toBeFocused();
      await check.assertAccessibility(parity);
      parity.network.setVariants({ 'functions-data-invoke': 'invoke-500' });
      await parity.page.keyboard.press('Enter');
      await expect(surface(parity).getByRole('heading', { name: copy(parity).invokeError, exact: true })).toBeVisible();
      await expect(button(parity, 'invoke')).toBeFocused();
      await expect(parity.page.locator('[aria-live="assertive"]').filter({ hasText: copy(parity).invokeError })).toHaveCount(1);
      await check.assertAccessibility(parity); await check.assertLocale(parity);
      parity.network.setVariants({ 'functions-data-invoke': 'invoke-500' });
      await button(parity, 'retry').focus(); await parity.page.keyboard.press('Enter');
      await expect(button(parity, 'retry')).toBeFocused();
      await parity.open(manifest.route, { 'functions-data-list': 'actions-500' });
      await expect(surface(parity).getByRole('heading', { name: copy(parity).listError, exact: true })).toBeVisible(); await check.assertAccessibility(parity);
    });
    test('runtime-health', async ({ parity }) => {
      await parity.open('/console/overview');
      if (width < 1024) await parity.page.getByRole('button', { name: locale === 'es' ? 'Abrir navegación' : 'Open navigation', exact: true }).click();
      const link = parity.page.getByRole('link', { name: copy(parity).title, exact: true }).first();
      await expect(link).toHaveAttribute('href', /\/console\/functions\/data$/);
      let documents = 0;
      parity.page.on('request', (request) => { if (request.isNavigationRequest() && request.frame() === parity.page.mainFrame()) documents++; });
      await link.click(); await ready(parity); expect(documents).toBe(0); await check.assertRuntimeHealth(parity);
      await parity.open(manifest.route, { 'functions-data-deploy': 'deploy-500', 'functions-data-activations': 'activations-500' }); await ready(parity);
      await button(parity, 'deploy').click(); await expect(surface(parity).getByRole('heading', { name: copy(parity).deployError, exact: true })).toBeVisible();
      await radio(parity, billing).check(); await button(parity, 'viewActivations').click();
      await expect(surface(parity).getByRole('heading', { name: copy(parity).activationsError, exact: true })).toBeVisible();
      await parity.open(manifest.route, { 'functions-data-list': ['actions-401', 'actions-2'] }); await ready(parity);
      expect(functionCalls(parity).slice(-2)).toEqual(Array(2).fill({ method: 'GET', path: actionsPath, body: undefined }));
      expect(parity.network.requests.filter(({ path }) => path.endsWith('/refresh'))).toHaveLength(1);
      await parity.open(manifest.route, { 'functions-data-list': 'actions-401', refresh: '401' });
      await expect(parity.page.getByRole('heading', { name: locale === 'es' ? 'Accede a In Falcone Console' : 'Sign in to In Falcone Console', exact: true })).toBeVisible();
    });
    test('responsive', async ({ parity }) => {
      await parity.open(manifest.route); await ready(parity); await check.assertResponsive(parity, width);
      await radio(parity, billing).check(); await button(parity, 'invoke').click(); await button(parity, 'viewActivations').click();
      await expect(surface(parity).getByRole('table', { name: copy(parity).activationsLabel, exact: true })).toBeVisible(); await check.assertResponsive(parity, width);
      for (const name of [copy(parity).listLegend, copy(parity).activationsLabel]) {
        const table = surface(parity).getByRole('table', { name, exact: true });
        expect(await table.evaluate((node) => { let parent = node.parentElement; while (parent) { if (/auto|scroll/.test(getComputedStyle(parent).overflowX)) return parent.scrollWidth >= parent.clientWidth; parent = parent.parentElement; } return false; })).toBe(true);
      }
      const columns = await surface(parity).locator('section[aria-label]').first().evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length);
      expect(columns).toBe(width >= 1280 ? 5 : 1);
    });
    test('visual-review', async ({ parity }, info) => {
      const cases = [
        ['invoke-result', { 'functions-data-invoke': 'invoke-result' }, async () => { await radio(parity, billing).check(); await button(parity, 'invoke').click(); await expect(surface(parity).getByRole('tree', { name: copy(parity).resultLabel, exact: true })).toBeVisible(); }],
        ['invoke-500', { 'functions-data-invoke': ['invoke-result', 'invoke-500'] }, async () => { await radio(parity, billing).check(); await button(parity, 'invoke').click(); await expect(surface(parity).getByRole('tree', { name: copy(parity).resultLabel, exact: true })).toBeVisible(); await button(parity, 'invoke').click(); await expect(surface(parity).getByText(copy(parity).resultStale, { exact: true })).toBeVisible(); }],
        ['activations-500', { 'functions-data-activations': ['activations-3', 'activations-500'] }, async () => { await radio(parity, billing).check(); await button(parity, 'viewActivations').click(); await expect(surface(parity).getByRole('table', { name: copy(parity).activationsLabel, exact: true })).toBeVisible(); await button(parity, 'viewActivations').click(); await expect(surface(parity).getByText(copy(parity).activationsStale, { exact: true })).toBeVisible(); }],
        ['actions-empty', { 'functions-data-list': 'actions-empty' }, async () => { await expect(surface(parity).getByText(copy(parity).listEmpty, { exact: true })).toBeVisible(); }],
        ['actions-500', { 'functions-data-list': 'actions-500' }, async () => { await expect(surface(parity).getByRole('heading', { name: copy(parity).listError, exact: true })).toBeVisible(); await expect(surface(parity).getByText('req_synthetic_actions_500', { exact: true })).toBeVisible(); }],
      ];
      for (const [name, variants, act] of cases) {
        await parity.open(manifest.route, variants); await act();
        await check.assertLocale(parity); await screenshot(parity, info, name);
      }
    });
    test('kit-conformance', async ({ parity }) => {
      await check.kitConformance(manifest); await parity.open(manifest.route); await ready(parity);
      await expect(surface(parity).getByRole('searchbox')).toHaveCount(0);
      await expect(surface(parity).getByRole('checkbox')).toHaveCount(0); await check.assertLocale(parity);
    });
    test('workspace retry, picker and activation', async ({ parity }) => {
      await parity.page.addInitScript(seedHistoryPrincipal, { workspaceIds: ['synthetic-workspace', 'synthetic-other'] });
      let attempts = 0;
      await parity.page.route((url) => url.pathname === '/v1/workspaces', async (route) => {
        const url = new URL(route.request().url()); parity.network.requests.push({ method: 'GET', path: url.pathname + url.search, body: undefined });
        if (++attempts === 1) return route.fulfill({ status: 500, json: {} });
        await route.fulfill({ json: { items: [{ workspaceId: 'synthetic-workspace', tenantId: 'synthetic-tenant', displayName: 'Synthetic Workspace', slug: 'synthetic-workspace' }, { workspaceId: 'synthetic-other', tenantId: 'synthetic-tenant', displayName: 'Other workspace', slug: 'synthetic-other' }] } });
      });
      await parity.open(manifest.route); const before = parity.network.requests.length;
      await surface(parity).getByRole('button', { name: copy(parity).retry, exact: true }).click();
      const picker = surface(parity).getByRole('combobox', { name: copy(parity).workspaceLabel, exact: true });
      await expect(picker).toBeVisible(); expect(parity.network.requests.slice(before).map(({ path }) => path.split('?')[0])).toEqual(['/v1/workspaces']); expect(functionCalls(parity)).toHaveLength(0);
      await picker.click(); await parity.page.getByRole('option', { name: 'Synthetic Workspace', exact: true }).click(); await ready(parity);
      expect(functionCalls(parity)).toEqual([{ method: 'GET', path: actionsPath, body: undefined }]);
    });
    test('workspace loading sends no functions request', async ({ parity, server }) => {
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      await parity.page.route((url) => url.pathname === '/v1/workspaces', async (route) => {
        const url = new URL(route.request().url()); parity.network.requests.push({ method: 'GET', path: url.pathname + url.search, body: undefined });
        await held; await route.fulfill({ json: { items: [] } });
      });
      await parity.page.goto(server.url('console/functions/data'));
      await expect(surface(parity).getByRole('status', { name: copy(parity).workspaceLoading, exact: true })).toBeVisible();
      expect(functionCalls(parity)).toHaveLength(0); release();
      await expect(surface(parity).getByRole('heading', { name: copy(parity).workspaceRequired, exact: true })).toBeVisible();
    });
    test('workspace create and denial send no functions request', async ({ parity }) => {
      await parity.open(manifest.route, { workspaces: 'empty' });
      await expect(surface(parity).getByRole('link', { name: copy(parity).createWorkspace, exact: true })).toHaveAttribute('href', '/console/workspaces'); expect(functionCalls(parity)).toHaveLength(0);
      await parity.page.addInitScript(seedHistoryPrincipal, { platformRoles: ['tenant_viewer'] });
      await parity.open(manifest.route, { workspaces: 'empty' });
      await expect(surface(parity).getByText(copy(parity).workspaceDenied, { exact: true })).toBeVisible(); expect(functionCalls(parity)).toHaveLength(0);
    });
  });
}
