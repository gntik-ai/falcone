import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { functionRows, functionsPath } from './console-function-registry-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';
import { seedHistoryPrincipal } from './console-flow-history-page.session.mjs';
const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-function-registry-page.json`, import.meta.url), 'utf8'))]));
const copy = (parity) => bundles[parity.locale];
const surface = (parity) => parity.page.getByTestId('console-function-registry-page');
const input = (parity, key) => surface(parity).getByRole('textbox', { name: copy(parity)[key], exact: true });
const form = (parity) => surface(parity).locator('form');
const calls = (parity) => parity.network.requests.filter(({ path }) => path === functionsPath);
async function ready(parity) { await expect(surface(parity).getByRole('table')).toBeVisible(); }
async function screenshot(parity, info, name) {
  const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
  await info.attach(`${name}-${parity.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}
for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-function-registry-page | superadmin | ${locale} | ${width}`, () => {
    test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity }) => {
      const injected = [];
      const scoped = (url) => [functionsPath, '/v1/workspaces'].includes(new URL(url).pathname);
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
      await expect(surface(parity).getByText('Synthetic Workspace', { exact: true })).toBeVisible();
      for (const fn of functionRows.items) {
        const row = surface(parity).getByRole('row').filter({ hasText: fn.name });
        for (const value of [fn.runtime, fn.handler ?? 'main', fn.status, fn.runtime_status]) await expect(row).toContainText(value);
      }
      expect(calls(parity)).toEqual([{ method: 'GET', path: functionsPath, body: undefined }]);
      await check.assertLocale(parity);
    });
    test('action', async ({ parity }) => {
      await parity.open(manifest.route); await ready(parity);
      await surface(parity).getByRole('toolbar').getByRole('button', { name: copy(parity).register, exact: true }).click();
      await expect(input(parity, 'name')).toBeFocused();
      parity.network.setVariants({ 'function-register': { variant: 'register-accepted', delayMs: 1000 }, 'function-registry': { variant: 'list-4', delayMs: 1000 } });
      await input(parity, 'name').fill('  on-user-created  ');
      await form(parity).getByRole('button', { name: copy(parity).register, exact: true }).click();
      await input(parity, 'name').fill('during-post');
      await expect(form(parity).getByRole('button', { name: copy(parity).registering, exact: true })).toBeDisabled();
      await expect.poll(() => calls(parity).length).toBe(3);
      await input(parity, 'name').fill('during-refetch');
      await expect(form(parity).getByRole('button', { name: copy(parity).registering, exact: true })).toBeDisabled();
      await expect(form(parity).getByRole('button', { name: copy(parity).register, exact: true })).toBeEnabled();
      await expect(input(parity, 'name')).toHaveValue('during-refetch'); await expect(input(parity, 'name')).toBeFocused();
      expect(calls(parity)).toEqual([{ method: 'GET', path: functionsPath, body: undefined }, { method: 'POST', path: functionsPath, body: { name: 'on-user-created', runtime: 'nodejs:20', handler: 'main' } }, { method: 'GET', path: functionsPath, body: undefined }]);
      await expect(surface(parity).getByRole('table')).toContainText('on-user-created');
      await expect(parity.page.getByText(copy(parity).registered, { exact: true }).first()).toBeAttached();
    });
    test('error-empty', async ({ parity }) => {
      for (const variant of ['list-empty', 'list-403', 'list-404', 'list-500', 'list-network']) {
        await parity.open(manifest.route, { 'function-registry': variant });
        if (variant === 'list-empty') { await expect(surface(parity).getByText(copy(parity).empty, { exact: true })).toBeVisible(); await expect(input(parity, 'name')).toBeVisible(); }
        else {
          await expect(surface(parity).getByRole('heading', { name: copy(parity)[variant === 'list-403' ? 'noAccess' : variant === 'list-404' ? 'notFound' : 'listError'], exact: true })).toBeVisible();
          if (variant === 'list-403') await expect(input(parity, 'name')).toHaveCount(0);
          if (variant === 'list-404') await expect(surface(parity).getByRole('link', { name: copy(parity).backOverview, exact: true })).toHaveAttribute('href', /\/console\/overview$/);
          if (variant === 'list-500') await expect(surface(parity).getByText('req_synthetic_functions', { exact: true })).toBeVisible();
        }
        await expect(surface(parity).getByRole('table')).toHaveCount(0); await check.assertLocale(parity); await check.assertAccessibility(parity);
      }
      parity.network.setVariants({ 'function-registry': 'list-3' });
      await surface(parity).getByRole('button', { name: copy(parity).retry, exact: true }).click(); await ready(parity);
      for (const variant of ['register-500', 'register-network']) {
        parity.network.setVariants({ 'function-register': [variant, 'register-accepted'] });
        for (const [key, value] of [['name', 'billing-sync'], ['runtime', 'nodejs:18'], ['handler', 'run']]) await input(parity, key).fill(value);
        const start = calls(parity).length;
        await form(parity).getByRole('button', { name: copy(parity).register, exact: true }).click();
        const retry = surface(parity).getByRole('button', { name: copy(parity).retry, exact: true });
        await expect(retry).toBeFocused();
        for (const [key, value] of [['name', 'billing-sync'], ['runtime', 'nodejs:18'], ['handler', 'run']]) await expect(input(parity, key)).toHaveValue(value);
        // The shell and page each own a live region; exactly one must announce this failure.
        await expect(parity.page.locator('[aria-live="assertive"]').filter({ hasText: copy(parity).registerError })).toHaveCount(1);
        if (variant === 'register-500') await expect(surface(parity).getByText('req_synthetic_register', { exact: true })).toBeVisible();
        await check.assertAccessibility(parity); await retry.click(); await expect(input(parity, 'name')).toHaveValue(''); await expect(input(parity, 'name')).toBeFocused();
        expect(calls(parity).slice(start)).toEqual([{ method: 'POST', path: functionsPath, body: { name: 'billing-sync', runtime: 'nodejs:18', handler: 'run' } }, { method: 'POST', path: functionsPath, body: { name: 'billing-sync', runtime: 'nodejs:18', handler: 'run' } }, { method: 'GET', path: functionsPath, body: undefined }]);
      }
    });
    test('accessibility', async ({ parity }) => {
      await parity.open(manifest.route); await ready(parity); await check.assertAccessibility(parity);
      parity.network.setVariants({ 'function-registry': 'list-4' });
      await input(parity, 'name').focus(); await parity.page.keyboard.type('on-user-created');
      await parity.page.keyboard.press('Tab'); await expect(input(parity, 'runtime')).toBeFocused();
      await parity.page.keyboard.press('Tab'); await expect(input(parity, 'handler')).toBeFocused();
      await parity.page.keyboard.press('Tab'); await parity.page.keyboard.press('Enter');
      await expect(input(parity, 'name')).toHaveValue(''); await expect(input(parity, 'name')).toBeFocused();
      await check.assertAccessibility(parity); await check.assertLocale(parity);
    });
    test('runtime-health', async ({ parity }) => {
      await parity.open('/console/overview');
      if (width < 1024) await parity.page.getByRole('button', { name: locale === 'es' ? 'Abrir navegación' : 'Open navigation', exact: true }).click();
      const link = parity.page.getByRole('link', { name: copy(parity).title, exact: true });
      await expect(link).toHaveAttribute('href', /\/console\/functions-registry$/);
      let documents = 0;
      parity.page.on('request', (request) => { if (request.isNavigationRequest() && request.frame() === parity.page.mainFrame()) documents++; });
      await link.click(); await ready(parity); expect(documents).toBe(0); await check.assertRuntimeHealth(parity);
      await parity.open(manifest.route, { 'function-registry': ['list-401', 'list-3'] }); await ready(parity);
      expect(calls(parity).slice(-2)).toEqual(Array(2).fill({ method: 'GET', path: functionsPath, body: undefined }));
      expect(parity.network.requests.filter(({ path }) => path.endsWith('/refresh'))).toHaveLength(1);
      await parity.open(manifest.route, { 'function-registry': 'list-401', refresh: '401' });
      await expect(parity.page.getByRole('heading', { name: locale === 'es' ? 'Accede a In Falcone Console' : 'Sign in to In Falcone Console', exact: true })).toBeVisible();
    });
    test('responsive', async ({ parity }) => {
      await parity.open(manifest.route); await ready(parity); await check.assertResponsive(parity, width);
      const table = surface(parity).getByRole('table');
      expect(await table.evaluate((node) => { let parent = node.parentElement; while (parent) { if (/auto|scroll/.test(getComputedStyle(parent).overflowX)) return parent.scrollWidth >= parent.clientWidth; parent = parent.parentElement; } return false; })).toBe(true);
    });
    test('visual-review', async ({ parity }, info) => {
      for (const [name, variants] of [['populated', {}], ['empty', { 'function-registry': 'list-empty' }], ['list-500', { 'function-registry': 'list-500' }], ['register-500', { 'function-register': 'register-500' }]]) {
        await parity.open(manifest.route, variants);
        if (name === 'register-500') { await input(parity, 'name').fill('billing-sync'); await form(parity).getByRole('button', { name: copy(parity).register, exact: true }).click(); await expect(surface(parity).getByRole('button', { name: copy(parity).retry, exact: true })).toBeFocused(); }
        await check.assertLocale(parity); await screenshot(parity, info, name);
      }
    });
    test('kit-conformance', async ({ parity }) => {
      await check.kitConformance(manifest); await parity.open(manifest.route); await ready(parity);
      await expect(surface(parity).getByRole('searchbox')).toHaveCount(0); await check.assertLocale(parity);
    });
    test('standalone list loading permits registration', async ({ parity, server }) => {
      parity.network.setVariants({ 'function-registry': 'list-pending' });
      await parity.page.goto(server.url('console/functions-registry'));
      await expect(surface(parity).locator('[aria-busy="true"]').first()).toBeVisible();
      await input(parity, 'name').fill('   '); await expect(form(parity).getByRole('button')).toBeDisabled();
      await input(parity, 'name').fill('new-function'); await expect(form(parity).getByRole('button')).toBeEnabled();
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
      await expect(picker).toBeVisible(); expect(parity.network.requests.slice(before).map(({ path }) => path.split('?')[0])).toEqual(['/v1/workspaces']); expect(calls(parity)).toHaveLength(0);
      await picker.click(); await parity.page.getByRole('option', { name: 'Synthetic Workspace', exact: true }).click(); await ready(parity);
    });
    test('workspace loading sends no functions request', async ({ parity, server }) => {
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      await parity.page.route((url) => url.pathname === '/v1/workspaces', async (route) => {
        const url = new URL(route.request().url()); parity.network.requests.push({ method: 'GET', path: url.pathname + url.search, body: undefined });
        await held; await route.fulfill({ json: { items: [] } });
      });
      await parity.page.goto(server.url('console/functions-registry'));
      await expect(surface(parity).getByRole('status', { name: copy(parity).workspaceLoading, exact: true })).toBeVisible();
      expect(calls(parity)).toHaveLength(0); release();
      await expect(surface(parity).getByRole('heading', { name: copy(parity).workspaceRequired, exact: true })).toBeVisible();
    });
    test('workspace create and denial send no functions request', async ({ parity }) => {
      await parity.open(manifest.route, { workspaces: 'empty' });
      await expect(surface(parity).getByRole('link', { name: copy(parity).createWorkspace, exact: true })).toHaveAttribute('href', '/console/workspaces'); expect(calls(parity)).toHaveLength(0);
      await parity.page.addInitScript(seedHistoryPrincipal, { platformRoles: ['tenant_viewer'] });
      await parity.open(manifest.route, { workspaces: 'empty' });
      await expect(surface(parity).getByText(copy(parity).workspaceDenied, { exact: true })).toBeVisible(); expect(calls(parity)).toHaveLength(0);
    });
  });
}
