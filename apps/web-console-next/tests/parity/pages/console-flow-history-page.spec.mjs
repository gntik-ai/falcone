import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { historyPath, historyResponse, executionId } from './console-flow-history-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';

const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale,
  JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-flow-history-page.json`, import.meta.url), 'utf8')),
]));
const states = new WeakMap();
const calls = (parity) => parity.network.requests.filter((request) => request.path.startsWith(historyPath));
const copy = (parity) => bundles[parity.locale];
const surface = (parity) => parity.page.getByTestId('console-flow-history-page');
const button = (parity, key) => surface(parity).getByRole('button', { name: copy(parity)[key], exact: true });
const heading = (parity, key) => parity.page.getByRole('heading', { name: copy(parity)[key], exact: true });
const cursorPath = historyPath + '?page%5Bafter%5D=tok-2';
async function ready(parity, id = executionId) { await expect(parity.page.getByTitle(id, { exact: true })).toBeVisible(); }
async function select(parity, key, label) {
  await surface(parity).getByRole('combobox', { name: copy(parity)[key], exact: true }).click();
  await parity.page.getByRole('option', { name: label, exact: true }).click();
}
async function open(parity, variant = 'page1-with-token', { trigger = false, ...shell } = {}) {
  states.set(parity, { variant, attempt: 0, authorizations: [] });
  await parity.page.addInitScript((trigger) => {
    // Seed the same router location state as the legacy Ejecutar ahora journey.
    if (location.pathname.endsWith('/console/flows/f1/runs')) history.replaceState({ ...history.state, usr: trigger ? { flowTrigger: { flowId: 'f1', scheduleId: 'synthetic-schedule' } } : null }, '');
  }, trigger);
  await parity.open(manifest.route, { ...shell, ...(variant === '401-rejected' ? { refresh: '401' } : {}) });
}
async function screenshot(parity, info, name) {
  await check.assertLocale(parity);
  const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
  await info.attach(`${name}-${parity.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}
for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`Flow history ${locale} ${width}`, () => {
    test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity }) => {
      const injected = [];
      await parity.page.route((url) => url.pathname === historyPath, async (route) => {
        const request = route.request(), url = new URL(request.url());
        parity.network.requests.push({ method: request.method(), path: url.pathname + url.search, body: undefined });
        if (request.method() !== 'GET' || request.postData() || [...url.searchParams.keys()].some((key) => !['status', 'query', 'page[after]'].includes(key))) {
          parity.faults.push(`Unmatched history request ${request.method()} ${url.pathname}${url.search}`);
          await route.abort(); return;
        }
        const state = states.get(parity) ?? { variant: 'page1-with-token', attempt: 0, authorizations: [] };
        state.authorizations.push(request.headers().authorization);
        const attempt = state.attempt++;
        let variant = state.variant;
        if (variant.startsWith('401-')) variant = variant === '401-repeat' || variant === '401-rejected' || attempt === 0 ? '401' : 'page1-with-token';
        if (variant === 'page1-with-token' && url.searchParams.has('page[after]')) variant = 'page2-last';
        const response = historyResponse(variant);
        if (response.delayMs) await new Promise((resolve) => setTimeout(resolve, response.delayMs));
        if (response.network || response.status >= 400) injected.push({ url: request.url(), kind: response.network ? 'network' : String(response.status) });
        if (response.network) await route.abort('failed');
        else await route.fulfill({ status: response.status, json: response.body });
      });
      parity.page.on('console', (message) => {
        if (message.type() !== 'error' || !consumeResourceDiagnostic(message.text(), message.location().url, injected)) return;
        const index = parity.faults.indexOf(`console.error: ${message.text()}`);
        if (index >= 0) parity.faults.splice(index, 1);
      });
    });
    test.describe(`console-flow-history-page | superadmin | ${locale} | ${width}`, () => {
    test('data', async ({ parity }) => {
      await open(parity); await ready(parity);
      await expect(heading(parity, 'title')).toBeVisible();
      const table = surface(parity).getByRole('table', { name: copy(parity).caption, exact: true });
      await expect(table.getByRole('row')).toHaveCount(2);
      await expect(table.getByTitle(executionId)).toHaveText(executionId.slice(0, 32) + '…');
      await expect(table.getByText(copy(parity).status.Completed, { exact: true })).toHaveCount(1);
      await expect(table.getByText(copy(parity).trigger.manual, { exact: true })).toHaveCount(1);
      await expect(table.getByText('2026-01-01T00:00:00Z', { exact: true })).toHaveCount(1);
      await expect(table.getByRole('link')).toHaveAttribute('href', `/console/flows/f1/runs/${encodeURIComponent(executionId)}`);
      await expect(surface(parity).getByText(locale === 'es' ? '1 ejecuciones' : '1 executions', { exact: true })).toBeVisible();
      expect(calls(parity)).toEqual([{ method: 'GET', path: historyPath, body: undefined }]);
      await check.assertLocale(parity);
    });
    test('action', async ({ parity }) => {
      await open(parity, 'page1-with-token', { trigger: true }); await ready(parity);
      await button(parity, 'next').click(); await ready(parity, 'synthetic-run-page2');
      expect(calls(parity).at(-1).path).toBe(cursorPath);
      await button(parity, 'refresh').click();
      await expect.poll(() => calls(parity).length).toBe(3);
      await expect(button(parity, 'previous')).not.toHaveAttribute('aria-disabled', 'true');
      expect(calls(parity).at(-1).path).toBe(cursorPath);
      await button(parity, 'previous').click(); await ready(parity);
      expect(calls(parity).at(-1).path).toBe(historyPath);
      const fields = { flowVersion: '2', status: 'Failed', triggerType: 'webhook', startedAfter: '2026-01-01T08:15', startedBefore: '2026-01-02T09:20' };
      await surface(parity).getByLabel(copy(parity).version, { exact: true }).fill(fields.flowVersion);
      await expect.poll(() => calls(parity).length).toBe(5);
      await select(parity, 'statusLabel', copy(parity).status.Failed);
      await expect.poll(() => calls(parity).length).toBe(6);
      await select(parity, 'triggerLabel', copy(parity).trigger.webhook);
      await expect.poll(() => calls(parity).length).toBe(7);
      await surface(parity).getByLabel(copy(parity).startedAfter, { exact: true }).fill(fields.startedAfter);
      await expect.poll(() => calls(parity).length).toBe(8);
      await surface(parity).getByLabel(copy(parity).startedBefore, { exact: true }).fill(fields.startedBefore);
      await expect.poll(() => calls(parity).length).toBe(9);
      expect(calls(parity).at(-1).path).toBe(historyPath + '?status=Failed&query=flowVersion+%3D+%272%27+AND+triggerType+%3D+%27webhook%27+AND+StartTime+%3E%3D+%272026-01-01T08%3A15%27+AND+StartTime+%3C%3D+%272026-01-02T09%3A20%27');
      expect(calls(parity).slice(4).every(({ path }) => !path.includes('page%5Bafter%5D'))).toBe(true);
      await expect(button(parity, 'previous')).toHaveAttribute('aria-disabled', 'true');
      states.get(parity).variant = 'filtered-empty';
      await select(parity, 'statusLabel', copy(parity).status.Running);
      await expect(heading(parity, 'noResults')).toBeVisible();
      states.get(parity).variant = 'page1-with-token';
      await button(parity, 'clear').click(); await ready(parity);
      expect(calls(parity).at(-1).path).toBe(historyPath);
      for (const request of calls(parity)) { expect(request.method).toBe('GET'); expect(request.body).toBeUndefined(); }
    });
    test('error-empty', async ({ parity }) => {
      await open(parity, 'empty'); await expect(heading(parity, 'empty')).toBeVisible();
      await expect(surface(parity).getByRole('link', { name: copy(parity).designer, exact: true })).toHaveAttribute('href', '/console/flows/f1');
      for (const [variant, key] of [['403', 'noAccess'], ['404', 'notFound'], ['500', 'errorTitle'], ['network', 'errorTitle']]) {
        await open(parity, variant); await expect(heading(parity, key)).toBeVisible();
        await expect(surface(parity).getByRole('table')).toHaveCount(0);
        if (variant === '403') { await expect(surface(parity).getByText('synthetic-backend-reason')).toBeVisible(); await expect(surface(parity).getByRole('button', { name: /Request access|Solicitar acceso/ })).toHaveCount(0); }
        if (variant === '404') await expect(surface(parity).getByRole('link', { name: copy(parity).back, exact: true })).toHaveAttribute('href', '/console/flows');
        if (variant === '500') await expect(surface(parity).getByText('req_synthetic_history', { exact: true })).toBeVisible();
        await check.assertAccessibility(parity);
      }
      const beforeWorkspace = calls(parity).length;
      await open(parity, 'page1-with-token', { workspaces: 'empty' });
      await expect(heading(parity, 'blocked')).toBeVisible();
      expect(calls(parity)).toHaveLength(beforeWorkspace);
    });
    test('accessibility', async ({ parity }) => {
      await open(parity, 'page1-with-token', { trigger: true }); await ready(parity);
      await expect(parity.page.getByTestId('flow-trigger-success')).toHaveAttribute('role', 'status');
      for (const label of ['version', 'statusLabel', 'triggerLabel', 'startedAfter', 'startedBefore']) await expect(surface(parity).getByLabel(copy(parity)[label], { exact: true })).toBeVisible();
      await button(parity, 'next').focus(); await parity.page.keyboard.press('Enter'); await ready(parity, 'synthetic-run-page2');
      await expect(button(parity, 'next')).toBeFocused(); await expect(button(parity, 'next')).toHaveAttribute('aria-disabled', 'true');
      await parity.page.keyboard.press('ArrowLeft'); await expect(button(parity, 'previous')).toBeFocused();
      await parity.page.keyboard.press('Enter'); await ready(parity); await expect(button(parity, 'previous')).toBeFocused();
      await expect(button(parity, 'previous')).toHaveAttribute('aria-disabled', 'true');
      await check.assertAccessibility(parity); await check.assertLocale(parity);
    });
    test('runtime-health', async ({ parity, server }) => {
      // The pending detail's breadcrumb uses the shell LinkProvider and React Router navigate().
      states.set(parity, { variant: 'page1-with-token', attempt: 0, authorizations: [] });
      await parity.open('/console/flows/f1/runs/e1');
      await parity.page.evaluate(() => {
        const push = history.pushState.bind(history);
        history.pushState = (state, title, url) => push(String(url).endsWith('/console/flows/f1/runs') ? { ...state, usr: { flowTrigger: { flowId: 'f1', scheduleId: 'synthetic-schedule' } } } : state, title, url);
      });
      await parity.page.getByRole('link', { name: locale === 'es' ? 'Ejecuciones' : 'Runs', exact: true }).click();
      await ready(parity); await expect(parity.page.getByTestId('flow-trigger-success')).toBeVisible();
      expect(parity.page.url()).toBe(server.url('console/flows/f1/runs'));
      states.get(parity).variant = 'network';
      await button(parity, 'next').click(); await expect(heading(parity, 'errorTitle')).toBeVisible();
      await expect(parity.page.getByTitle(executionId)).toHaveCount(0);
      states.get(parity).variant = 'page1-with-token';
      await button(parity, 'retry').click(); await ready(parity, 'synthetic-run-page2');
      expect(calls(parity).slice(-2).map(({ path }) => path)).toEqual([cursorPath, cursorPath]);
      await check.assertRuntimeHealth(parity);
    });
    test('responsive', async ({ parity }) => {
      await open(parity); await ready(parity); await check.assertResponsive(parity, width);
      const table = surface(parity).getByRole('table');
      await expect(table.getByRole('columnheader')).toHaveCount(width === 375 ? 2 : 6);
      await expect(table.getByRole('cell')).toHaveCount(width === 375 ? 2 : 6);
      await open(parity, 'filtered-empty'); await select(parity, 'statusLabel', copy(parity).status.Failed);
      await expect(heading(parity, 'noResults')).toBeVisible(); await check.assertResponsive(parity, width);
    });
    test('kit-conformance', async ({ parity }) => {
      await check.kitConformance(manifest); await open(parity); await ready(parity);
      await expect(surface(parity).getByRole('searchbox')).toHaveCount(0); await check.assertLocale(parity);
    });
    test('visual-review', async ({ parity }, info) => {
      for (const [variant, key, trigger] of [['page1-with-token', 'title', false], ['page1-with-token', 'triggerTitle', true], ['filtered-empty', 'noResults', false], ['empty', 'empty', false], ['500', 'errorTitle', false]]) {
        await open(parity, variant, { trigger });
        if (variant === 'page1-with-token') await ready(parity);
        if (variant === 'filtered-empty') await select(parity, 'statusLabel', copy(parity).status.Failed);
        if (trigger) await expect(parity.page.getByTestId('flow-trigger-success')).toBeVisible();
        else await expect(heading(parity, key)).toBeVisible();
        await screenshot(parity, info, trigger ? 'trigger-notice' : variant);
      }
      // The checker and operator assess these artifacts; the maker cannot approve baselines.
    });
    });
    for (const variant of ['401-ok', '401-rejected', '401-repeat']) test(variant, async ({ parity, server }) => {
      await parity.page.addInitScript(() => {
        window.historyInvalidations = 0;
        window.addEventListener('in-falcone:console-session-invalidated', () => window.historyInvalidations++);
      });
      await open(parity, variant);
      if (variant === '401-ok') await ready(parity);
      else if (variant === '401-rejected') {
        await expect(parity.page).toHaveURL(server.url('login'));
        expect(await parity.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(server.url('console/flows/f1/runs')).pathname);
      } else {
        await expect(heading(parity, 'errorTitle')).toBeVisible();
        expect(new URL(parity.page.url()).pathname).toBe(new URL(server.url('console/flows/f1/runs')).pathname);
        expect(await parity.page.evaluate(() => window.historyInvalidations)).toBe(0);
        expect(await parity.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-shell-session')).tokenSet.accessToken)).toBe('synthetic-refreshed-access-token');
      }
      expect(parity.network.requests.filter(({ path }) => path.endsWith('/refresh'))).toHaveLength(1);
      expect(calls(parity)).toHaveLength(variant === '401-rejected' ? 1 : 2);
      if (variant !== '401-rejected') expect(states.get(parity).authorizations).toEqual(['Bearer synthetic-access-token', 'Bearer synthetic-refreshed-access-token']);
      await check.assertRuntimeHealth(parity);
    });
    test('workspace loading, picker and activation', async ({ parity, server }) => {
      let release;
      const waiting = new Promise((resolve) => { release = resolve; });
      await parity.page.route((url) => url.pathname === '/v1/workspaces', async (route) => {
        const url = new URL(route.request().url());
        parity.network.requests.push({ method: 'GET', path: url.pathname + url.search, body: undefined });
        await waiting;
        await route.fulfill({ json: { items: [
          { workspaceId: 'synthetic-workspace', tenantId: 'synthetic-tenant', displayName: 'Synthetic Workspace', slug: 'synthetic-workspace' },
          { workspaceId: 'synthetic-other', tenantId: 'synthetic-tenant', displayName: 'Other workspace', slug: 'synthetic-other' },
        ], page: { after: null } } });
      });
      states.set(parity, { variant: 'page1-with-token', attempt: 0, authorizations: [] });
      await parity.page.goto(server.url('console/flows/f1/runs'));
      await expect(parity.page.getByRole('status', { name: copy(parity).workspaceLoading, exact: true })).toBeVisible();
      expect(calls(parity)).toHaveLength(0);
      release();
      await parity.page.getByRole('combobox', { name: copy(parity).workspaceLabel, exact: true }).click();
      await parity.page.getByRole('option', { name: 'Synthetic Workspace', exact: true }).click();
      await ready(parity);
      expect(calls(parity)).toEqual([{ method: 'GET', path: historyPath, body: undefined }]);
      await check.assertAccessibility(parity); await check.assertRuntimeHealth(parity);
    });
    test('workspace create link and denied explanation', async ({ parity }) => {
      await open(parity, 'page1-with-token', { workspaces: 'empty' });
      await expect(parity.page.getByRole('link', { name: copy(parity).createWorkspace, exact: true })).toHaveAttribute('href', '/console/workspaces');
      expect(calls(parity)).toHaveLength(0);
      await parity.page.addInitScript(() => {
        const key = 'in-falcone.console-shell-session';
        const session = JSON.parse(sessionStorage.getItem(key));
        session.principal.platformRoles = ['tenant_viewer'];
        sessionStorage.setItem(key, JSON.stringify(session));
      });
      await open(parity, 'page1-with-token', { workspaces: 'empty' });
      await expect(parity.page.getByText(copy(parity).workspaceDenied, { exact: true })).toBeVisible();
      await expect(parity.page.getByRole('link', { name: copy(parity).createWorkspace, exact: true })).toHaveCount(0);
      expect(calls(parity)).toHaveLength(0);
    });
  });
}
