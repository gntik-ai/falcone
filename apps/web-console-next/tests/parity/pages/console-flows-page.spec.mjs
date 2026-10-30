import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { flowsPath, triggerPath, flowRows } from './console-flows-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';
import { seedHistoryPrincipal } from './console-flow-history-page.session.mjs';
const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-flows-page.json`, import.meta.url), 'utf8'))]));
const copy = (parity) => bundles[parity.locale];
const surface = (parity) => parity.page.getByTestId('console-flows-page');
const button = (parity, key) => surface(parity).getByRole('button', { name: copy(parity)[key], exact: true });
const calls = (parity) => parity.network.requests.filter(({ path }) => path.startsWith(flowsPath) && !path.endsWith('/executions'));
const writable = (role) => ['superadmin', 'tenant_owner', 'workspace_admin'].includes(role);
async function ready(parity) { await expect(surface(parity).getByTitle(flowRows.items[0].name, { exact: true })).toBeVisible(); }
async function confirm(parity) {
  const name = parity.locale === 'es' ? 'Ejecutar ahora Synthetic published flow' : 'Run now Synthetic published flow';
  await surface(parity).getByRole('button', { name, exact: true }).click();
  const dialog = parity.page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: copy(parity).run, exact: true }).click();
}
async function attach(parity, info, name) {
  await check.assertLocale(parity);
  const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
  await info.attach(`${name}-${parity.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}
for (const role of manifest.roles) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-flows-page | ${role} | ${locale} | ${width}`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity }) => {
      const injected = [];
      const scoped = (url) => new URL(url).pathname.startsWith(flowsPath) || new URL(url).pathname === '/v1/workspaces';
      parity.page.on('response', (response) => { if (scoped(response.url()) && response.status() >= 400) injected.push({ url: response.url(), kind: String(response.status()) }); });
      parity.page.on('requestfailed', (request) => { if (scoped(request.url())) injected.push({ url: request.url(), kind: 'network' }); });
      parity.page.on('console', (message) => {
        if (message.type() !== 'error') return;
        let expected = consumeResourceDiagnostic(message.text(), message.location().url, injected);
        // The shared helper predates the page’s deliberate rate-limit fixture.
        if (!expected && /^Failed to load resource: the server responded with a status of 429(?: \([^\n]*\))?$/.test(message.text())) {
          const failure = injected.findIndex((item) => item.url === message.location().url && item.kind === '429');
          if (failure >= 0) { injected.splice(failure, 1); expected = true; }
        }
        if (!expected) return;
        const index = parity.faults.indexOf(`console.error: ${message.text()}`);
        if (index >= 0) parity.faults.splice(index, 1);
      });
    });
    test('data', async ({ parity }) => {
      await parity.open(manifest.route); await ready(parity);
      const table = surface(parity).getByRole('table', { name: copy(parity).caption, exact: true });
      await expect(table.getByRole('rowheader')).toHaveCount(2);
      await expect(table.getByRole('row')).toHaveCount(3);
      await expect(table.getByText(copy(parity).status.published, { exact: true })).toHaveCount(1);
      await expect(table.locator('time').first()).toHaveAttribute('datetime', '2026-06-30T12:00:00.000Z');
      await expect(table.locator('time').nth(1)).toHaveAttribute('datetime', '2026-01-01T00:00:00.000Z');
      await expect(table.getByRole('group', { name: copy(parity).rowActions.replace('{name}', 'Synthetic published flow'), exact: true })).toBeVisible();
      await expect(table.getByRole('button', { name: copy(parity).runDisabled.replace('{name}', 'Synthetic draft flow'), exact: true })).toBeDisabled();
      expect(calls(parity)).toEqual([{ method: 'GET', path: flowsPath, body: undefined }]);
      if (!writable(role)) { await expect(surface(parity).getByTestId('flows-read-only-indicator')).toBeVisible(); await expect(surface(parity).getByLabel(copy(parity).newName, { exact: true })).toHaveCount(0); }
      await check.assertLocale(parity);
    });
    test('action', async ({ parity, server }) => {
      await parity.open(manifest.route); await ready(parity);
      const designer = surface(parity).getByRole('link', { name: copy(parity).designerNamed.replace('{name}', 'Synthetic published flow'), exact: true });
      await expect(designer).toHaveAttribute('href', '/console/flows/f1');
      const designerTarget = new URL('/console/flows/f1', server.origin).href;
      await parity.page.route(designerTarget, (route) => route.fulfill({ contentType: 'text/html', body: '<main>synthetic-legacy-designer</main>' }));
      await designer.click(); await expect(parity.page).toHaveURL(designerTarget); await parity.page.unroute(designerTarget);
      await parity.open(manifest.route); await ready(parity);
      const history = surface(parity).getByRole('link', { name: copy(parity).historyNamed.replace('{name}', 'Synthetic published flow'), exact: true });
      await expect(history).toHaveAttribute('href', new URL(server.url('console/flows/f1/runs')).pathname);
      let documents = 0;
      parity.page.on('request', (request) => { if (request.isNavigationRequest() && request.frame() === parity.page.mainFrame()) documents++; });
      await history.click(); await expect(parity.page.getByTestId('console-flow-history-page')).toBeVisible(); expect(documents).toBe(0);
      await parity.open(manifest.route); await ready(parity); const before = documents;
      await confirm(parity); await expect(parity.page.getByTestId('flow-trigger-success')).toContainText('synthetic-schedule');
      expect(documents).toBe(before);
      expect(calls(parity).filter(({ method, path }) => method === 'POST' && path === triggerPath)).toEqual([{ method: 'POST', path: triggerPath, body: undefined }]);
      if (writable(role)) {
        await parity.open(manifest.route, { 'flows.list': 'empty' });
        await button(parity, 'emptyAction').click(); await expect(surface(parity).getByLabel(copy(parity).newName, { exact: true })).toBeFocused();
        await surface(parity).getByLabel(copy(parity).newName, { exact: true }).fill('  Trimmed  ');
        await parity.page.keyboard.press('Enter'); expect(calls(parity).filter(({ method, path }) => method === 'POST' && path === flowsPath)).toHaveLength(0);
        const target = new URL('/console/flows/created%2F1', server.origin).href;
        await parity.page.route(target, (route) => route.fulfill({ contentType: 'text/html', body: '<main>synthetic-created-designer</main>' }));
        await button(parity, 'create').click(); await expect(parity.page).toHaveURL(target); await parity.page.unroute(target);
        expect(calls(parity).filter(({ method, path }) => method === 'POST' && path === flowsPath)).toEqual([{ method: 'POST', path: flowsPath, body: { name: 'Trimmed' } }]);
      }
      await check.assertRuntimeHealth(parity);
    });
    test('error-empty', async ({ parity }) => {
      await check.errorEmpty(parity, manifest);
      await expect(surface(parity).getByText('req_synthetic_flows', { exact: true })).toBeVisible();
      parity.network.setVariants({ 'flows.list': 'success' }); await button(parity, 'retry').click(); await ready(parity);
      await parity.open(manifest.route, { 'flows.list': '403-empty' });
      await expect(surface(parity).getByRole('heading', { name: copy(parity).noAccess, exact: true })).toBeVisible();
      await expect(surface(parity).getByText(copy(parity).errors['403'], { exact: true })).toBeVisible();
      await expect(surface(parity).getByText(/^(Forbidden|Request failed|HTTP_403)$/)).toHaveCount(0);
      await expect(surface(parity).getByRole('table')).toHaveCount(0);
      await parity.open(manifest.route, { 'flows.list': 'network' }); await expect(surface(parity).getByRole('heading', { name: copy(parity).errorTitle, exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('table')).toHaveCount(0);
      await parity.open(manifest.route, { 'flows.list': 'empty' });
      await expect(surface(parity).getByRole('heading', { name: copy(parity).empty, exact: true })).toBeVisible();
      if (writable(role)) await expect(button(parity, 'emptyAction')).toBeVisible();
      else { await expect(button(parity, 'emptyAction')).toHaveCount(0); await expect(surface(parity).getByText(copy(parity).emptyReadOnly, { exact: true })).toBeVisible(); }
      const start = calls(parity).length;
      await parity.open(manifest.route, { workspaces: 'empty' });
      await expect(surface(parity).getByRole('heading', { name: copy(parity).workspaceRequired, exact: true })).toBeVisible(); expect(calls(parity)).toHaveLength(start);
      if (writable(role)) await expect(surface(parity).getByRole('link', { name: copy(parity).createWorkspace, exact: true })).toBeVisible();
      else await expect(surface(parity).getByText(copy(parity).workspaceDenied, { exact: true })).toBeVisible();
      await check.assertAccessibility(parity);
    });
    test('accessibility', async ({ parity }) => {
      await parity.open(manifest.route); await ready(parity);
      const run = surface(parity).getByRole('button', { name: copy(parity).runNamed.replace('{name}', 'Synthetic published flow'), exact: true });
      await run.focus(); await parity.page.keyboard.press('Enter');
      const dialog = parity.page.getByRole('alertdialog'); await expect(dialog).toBeVisible(); await check.assertAccessibility(parity);
      await dialog.getByRole('button', { name: copy(parity).cancel, exact: true }).click(); await expect(run).toBeFocused();
      const draft = surface(parity).getByRole('button', { name: copy(parity).runDisabled.replace('{name}', 'Synthetic draft flow'), exact: true });
      const described = await draft.getAttribute('aria-describedby'); await expect(parity.page.locator(`[id="${described}"]`)).toHaveText(copy(parity).disabledReason);
      await check.assertAccessibility(parity); await check.assertLocale(parity);
    });
    test('kit-conformance', async ({ parity }) => {
      await check.kitConformance(manifest); await parity.open(manifest.route); await ready(parity);
      await expect(surface(parity).getByRole('searchbox')).toHaveCount(0); await check.assertLocale(parity);
    });
    test('runtime-health', async ({ parity }) => {
      await parity.open(manifest.route, { 'flows.schedule.trigger': '500' }); await ready(parity); await confirm(parity);
      await expect(surface(parity).getByTestId('flow-run-now-error')).toHaveText('synthetic-backend-reason');
      await expect(parity.page.locator('[aria-live="assertive"], [role="alert"]').filter({ hasText: 'synthetic-backend-reason' })).toContainText('synthetic-backend-reason');
      expect(new URL(parity.page.url()).pathname).toMatch(/\/console\/flows$/);
      if (writable(role)) for (const variant of ['403', '404', '409', '429', '500', 'network']) {
        await parity.open(manifest.route, { 'flows.post': variant }); await ready(parity);
        await surface(parity).getByLabel(copy(parity).newName, { exact: true }).fill('Keep this name'); await button(parity, 'create').click();
        const expected = variant === '403' ? copy(parity).createDenied : variant === '500' ? copy(parity).errors.server : variant === 'network' ? copy(parity).createError : copy(parity).errors[variant];
        await expect(surface(parity).getByText(expected, { exact: true })).toBeVisible();
        await expect(surface(parity).getByLabel(copy(parity).newName, { exact: true })).toHaveValue('Keep this name');
        await expect(parity.page.locator('[aria-live="assertive"], [role="alert"]').filter({ hasText: expected })).toHaveCount(1);
      }
      await check.assertRuntimeHealth(parity);
    });
    test('responsive', async ({ parity }) => {
      await parity.open(manifest.route); await ready(parity); await check.assertResponsive(parity, width);
      await expect(surface(parity).getByRole('columnheader')).toHaveCount(width === 375 ? 2 : 4);
      if (width === 375 && writable(role)) {
        const input = await surface(parity).getByLabel(copy(parity).newName, { exact: true }).locator('..').boundingBox();
        const create = await button(parity, 'create').boundingBox(); expect(create.y).toBeGreaterThan(input.y); expect(Math.abs(create.width - input.width)).toBeLessThan(2);
      }
    });
    test('visual-review', async ({ parity }, info) => {
      for (const variant of ['success', 'empty', '403', '500']) {
        await parity.open(manifest.route, { 'flows.list': variant });
        if (variant === 'success') await ready(parity);
        else await expect(surface(parity).getByRole('heading', { name: copy(parity)[variant === 'empty' ? 'empty' : variant === '403' ? 'noAccess' : 'errorTitle'], exact: true })).toBeVisible();
        await attach(parity, info, variant);
      }
      // The independent checker and operator assess the screenshots.
    });
    test('workspace retry fetches only workspaces then waits for a picker', async ({ parity }) => {
      await parity.page.addInitScript(seedHistoryPrincipal, { workspaceIds: ['synthetic-workspace', 'synthetic-other'] });
      let attempts = 0;
      await parity.page.route((url) => url.pathname === '/v1/workspaces', async (route) => {
        parity.network.requests.push({ method: 'GET', path: new URL(route.request().url()).pathname + new URL(route.request().url()).search, body: undefined });
        await route.fulfill(++attempts === 1 ? { status: 500, json: {} } : { json: { items: [
          { workspaceId: 'synthetic-workspace', tenantId: 'synthetic-tenant', displayName: 'Synthetic Workspace', slug: 'synthetic-workspace' },
          { workspaceId: 'synthetic-other', tenantId: 'synthetic-tenant', displayName: 'Other workspace', slug: 'synthetic-other' },
        ] } });
      });
      await parity.open(manifest.route); await expect(surface(parity).getByRole('heading', { name: copy(parity).workspaceError, exact: true })).toBeVisible();
      await button(parity, 'retry').click();
      await expect(surface(parity).getByRole('combobox', { name: copy(parity).workspaceLabel, exact: true })).toBeVisible();
      expect(attempts).toBe(2); expect(calls(parity)).toHaveLength(0);
      expect(parity.network.requests.filter(({ path }) => path.startsWith('/v1/tenants'))).toHaveLength(1);
      await check.assertRuntimeHealth(parity);
    });
    for (const method of ['GET', 'POST']) for (const refresh of ['success', '401']) test(`${method} 401 refresh ${refresh}`, async ({ parity, server }) => {
      if (method === 'POST' && !writable(role)) return;
      const endpoint = method === 'GET' ? 'flows.list' : 'flows.post';
      const authorizations = [];
      parity.page.on('request', (request) => { if (new URL(request.url()).pathname === flowsPath && request.method() === method) authorizations.push(request.headers().authorization); });
      await parity.open(manifest.route, { refresh, [endpoint]: [{ variant: '401' }, { variant: 'success' }] });
      if (method === 'POST') {
        await ready(parity); await surface(parity).getByLabel(copy(parity).newName, { exact: true }).fill('Trimmed');
        await parity.page.route(new URL('/console/flows/created%2F1', server.origin).href, (route) => route.fulfill({ contentType: 'text/html', body: '<main>synthetic-legacy-designer</main>' }));
        await button(parity, 'create').click();
      }
      if (refresh === '401') {
        await expect(parity.page).toHaveURL(server.url('login'));
        expect(await parity.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(server.url('console/flows')).pathname);
      } else if (method === 'GET') await ready(parity);
      else await expect(parity.page).toHaveURL(new URL('/console/flows/created%2F1', server.origin).href);
      expect(authorizations).toEqual(refresh === '401' ? ['Bearer synthetic-access-token'] : ['Bearer synthetic-access-token', 'Bearer synthetic-refreshed-access-token']);
      expect(parity.network.requests.filter(({ path }) => path.endsWith('/refresh'))).toHaveLength(1);
      await check.assertRuntimeHealth(parity);
    });
  });
}
