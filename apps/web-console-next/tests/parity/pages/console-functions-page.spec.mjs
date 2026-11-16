import manifest, { activationPath, counts, createPath, functions3, inventoryPath } from './console-functions-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { activationsPath, button, calls, copy, detailPath, functionCalls, get, openTab, pane, radio, ready, screenshot, select, surface, tab, trackKeys, versionsPath, failureText } from './console-functions-page.support.mjs';

const sections = [
  ['functions-detail', 'detail', detailPath], ['functions-versions', 'versions', versionsPath], ['functions-activations', 'activations', activationsPath],
  ['functions-activation', 'activation', activationPath()], ['functions-logs', 'logs', `${activationPath()}/logs`], ['functions-result', 'result', `${activationPath()}/result`],
];
const writeStates = ['provisioning', 'degraded', 'suspended', 'unavailable', 'deletion_pending'];
const selectActivation = async (parity) => { await openTab(parity, 'activations'); await surface(parity).getByTestId('functions-activations').getByRole('radio').first().check(); };
const alertWith = (parity, text) => surface(parity).getByRole('alert').filter({ hasText: text });

for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-functions-page | superadmin | ${locale} | ${width}`, () => {
    test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });

    test('data', { tag: '@legacy-parity' }, async ({ parity }) => {
      const c = copy(parity);
      await parity.open(manifest.route); await ready(parity);
      await expect(surface(parity).getByRole('heading', { level: 1, name: c.title, exact: true })).toBeVisible();
      const kpi = surface(parity).locator(`dl[aria-label="${c.kpi.label}"]`);
      for (const [key, value] of Object.entries({ actions: counts.actions, packages: counts.packages, triggers: counts.triggers, httpExposures: counts.httpExposures })) await expect(kpi).toContainText(`${c.kpi[key]}${value}`);
      for (const fn of functions3) { const row = surface(parity).getByRole('row').filter({ hasText: fn.actionName }); await expect(row).toBeVisible(); await expect(row).toContainText('nodejs:20'); }
      for (const [variant, level, value, remaining] of [['quota-available', 'ok', 3, 47], ['quota-near-limit', 'warning', 46, 4], ['quota-exhausted', 'critical', 50, 0], ['quota-remaining-only', 'warning', 46, 4]]) {
        await parity.open(manifest.route, { 'functions-inventory': variant }); await ready(parity);
        const meter = surface(parity).getByRole('meter');
        await expect(meter).toHaveAttribute('data-level', level); await expect(meter).toHaveAttribute('aria-valuenow', String(value));
        await expect(meter).toContainText(c.quota.value.replace('{remaining}', String(remaining)).replace('{limit}', '50'));
      }
      await parity.open(manifest.route, { 'functions-inventory': '500', 'functions-actions': 'actions-60' }); await ready(parity);
      await expect(surface(parity).getByRole('radio')).toHaveCount(60); await expect(surface(parity).getByRole('navigation', { name: /pagin/i })).toHaveCount(0);
      await parity.open(manifest.route); await select(parity);
      for (const text of ['synthetic-package', 'synthetic-namespace', 'sha256:synthetic-digest', 'https://synthetic.example.test/hello', 'synthetic-secret']) await expect(pane(parity)).toContainText(text);
      await expect(surface(parity).getByRole('list', { name: c.history.label, exact: true }).getByRole('listitem')).toHaveCount(3);
      await openTab(parity, 'versions'); await expect(surface(parity).getByTestId('functions-versions').getByRole('radio')).toHaveCount(3);
      await parity.open(manifest.route, { 'functions-activations': 'activations-50' }); await select(parity); await openTab(parity, 'activations');
      await expect(surface(parity).getByTestId('functions-activations').getByRole('radio')).toHaveCount(50);
      await expect(surface(parity).getByRole('heading', { name: c.activations.title, exact: true })).toBeVisible();
      await surface(parity).getByTestId('functions-activations').getByRole('radio').first().check();
      await expect(surface(parity).getByTestId('functions-activation-result')).toContainText('synthetic-hello'); await expect(surface(parity).getByTestId('functions-activation-logs')).toContainText('synthetic log line one');
      await check.assertLocale(parity);
    });

    test('action', { tag: '@legacy-parity' }, async ({ parity }) => {
      const c = copy(parity), keys = trackKeys(parity);
      await parity.open(manifest.route, { 'functions-inventory': ['success', 'success', 'created'], 'functions-detail': 'action-detail', 'functions-update': 'update-accepted', 'functions-invoke': 'invoke-accepted', 'functions-rollback': 'rollback-accepted', 'functions-delete': 'delete-accepted' });
      await select(parity); await openTab(parity, 'deploy');
      const entry = surface(parity).getByLabel(c.form.entrypoint, { exact: true });
      await entry.fill('main2'); await expect(surface(parity).getByText(c.form.dirty, { exact: true })).toBeVisible();
      const before = functionCalls(parity).length;
      await button(parity, c.form.discard).click(); await expect(entry).toHaveValue('main'); expect(functionCalls(parity)).toHaveLength(before);
      await entry.fill('main2'); await button(parity, c.form.update).click();
      await expect(surface(parity).getByTestId('functions-deploy-result')).toBeVisible();
      expect(calls(parity)).toContainEqual({ method: 'PATCH', path: detailPath, body: { tenantId: 'synthetic-tenant', workspaceId: 'synthetic-workspace', actionName: 'synthetic-hello', activationPolicy: { mode: 'workspace_default', retentionDays: 7 }, execution: { runtime: 'nodejs:20', entrypoint: 'main2', limits: { timeoutMs: 30000, memoryMb: 256 } }, source: { kind: 'inline_code', inlineCode: 'exports.main = () => ({ ok: true })', entryFile: 'index.js' } } });
      await openTab(parity, 'versions'); await button(parity, c.versions.rollback).click(); await expect(surface(parity).getByTestId('functions-rollback-result')).toBeVisible();
      expect(calls(parity)).toContainEqual({ method: 'POST', path: `${detailPath}/rollback`, body: { versionId: 'synthetic-version-1', reason: 'Reversión iniciada desde la consola' } });
      await openTab(parity, 'invoke'); await button(parity, c.invoke.action).click();
      await expect(tab(parity, 'activations')).toHaveAttribute('aria-selected', 'true');
      expect(calls(parity)).toContainEqual({ method: 'POST', path: `${detailPath}/invocations`, body: { parameters: {}, responseMode: 'accepted', idempotencyScope: 'request' } });
      await button(parity, c.delete.aria.replace('{name}', 'synthetic-hello')).click();
      const dialog = parity.page.getByRole('alertdialog'); const confirm = dialog.getByRole('button', { name: c.delete.confirm, exact: true });
      await expect(confirm).toBeDisabled(); await dialog.getByRole('textbox', { name: c.delete.typed, exact: true }).fill('synthetic-hello'); await expect(confirm).toBeEnabled(); await confirm.click();
      await expect(surface(parity).getByTestId('functions-notice')).toContainText(c.deleted.message.replace('{name}', 'synthetic-hello'));
      expect(calls(parity)).toContainEqual({ method: 'DELETE', path: detailPath, body: undefined });
      expect(keys.every(({ key }) => typeof key === 'string' && key.length > 0)).toBe(true);
      await parity.open(manifest.route, { 'functions-create': 'create-accepted', 'functions-detail-4': 'success' });
      await ready(parity); await button(parity, c.deploy).click(); await expect(tab(parity, 'deploy')).toHaveAttribute('aria-selected', 'true');
      await surface(parity).getByLabel(c.form.actionName, { exact: true }).fill('synthetic-new'); await surface(parity).getByLabel(c.form.entrypoint, { exact: true }).fill('main');
      await button(parity, c.form.create).click();
      await expect(surface(parity).getByRole('region', { name: c.form.validationTitle })).toBeFocused();
      expect(calls(parity).some(({ method, path }) => method === 'POST' && path === createPath)).toBe(false);
      await surface(parity).getByRole('combobox', { name: c.form.runtime, exact: true }).click(); await parity.page.getByRole('option', { name: 'nodejs:20', exact: true }).click();
      await button(parity, c.form.create).click();
      await expect.poll(() => calls(parity).filter(({ method, path }) => method === 'POST' && path === createPath).length).toBe(1);
      expect(calls(parity).find(({ method, path }) => method === 'POST' && path === createPath).body).toMatchObject({ tenantId: 'synthetic-tenant', workspaceId: 'synthetic-workspace', actionName: 'synthetic-new', execution: { runtime: 'nodejs:20', entrypoint: 'main' }, source: { kind: 'inline_code' } });
    });

    test('error-empty', { tag: '@legacy-parity' }, async ({ parity }) => {
      const c = copy(parity);
      await parity.open(manifest.route, { workspaces: 'empty' }); await expect(surface(parity).getByRole('heading', { name: c.gate.title, exact: true })).toBeVisible(); await expect(surface(parity).getByText(c.gate.description, { exact: true })).toBeVisible(); expect(functionCalls(parity)).toHaveLength(0);
      await parity.open(manifest.route, { tenants: 'empty' }); expect(functionCalls(parity)).toHaveLength(0);
      await parity.open(manifest.route, { 'functions-inventory': 'empty' }); await expect(surface(parity).getByText(c.inventory.empty, { exact: true })).toBeVisible(); await expect(surface(parity).getByText(c.detail.empty, { exact: true })).toBeVisible();
      await parity.open(manifest.route, { 'functions-versions': 'empty', 'functions-activations': 'empty', 'functions-detail': 'success' }); await select(parity);
      await openTab(parity, 'versions'); await expect(surface(parity).getByText(c.versions.empty, { exact: true })).toBeVisible();
      await openTab(parity, 'activations'); await expect(surface(parity).getByText(c.activations.empty, { exact: true })).toBeVisible();
      await openTab(parity, 'triggers'); await expect(surface(parity).getByTestId('functions-triggers')).toContainText('synthetic-bucket');
      await parity.open(manifest.route, { 'functions-activation': 'running', 'functions-logs': 'none', 'functions-result': 'none' }); await select(parity); await selectActivation(parity);
      await expect(surface(parity).getByText(c.activations.logsRunning, { exact: true })).toBeVisible(); await expect(surface(parity).getByText(c.activations.resultRunning, { exact: true })).toBeVisible();
      await parity.open(manifest.route, { 'functions-logs': 'empty', 'functions-result': 'no-result' }); await select(parity); await selectActivation(parity);
      await expect(surface(parity).getByText(c.activations.logsEmpty, { exact: true })).toBeVisible(); await expect(surface(parity).getByText(c.activations.resultNone, { exact: true })).toBeVisible();
      for (const state of writeStates) {
        await parity.open(manifest.route, { 'functions-detail': state }); await select(parity);
        const notice = surface(parity).getByTestId('functions-write-disabled'); await expect(notice).toContainText(c.write[state]);
        const del = button(parity, c.delete.aria.replace('{name}', 'synthetic-hello')); await expect(del).toBeDisabled(); await expect(del).toHaveAttribute('aria-describedby', 'functions-write-disabled-reason');
        await openTab(parity, 'versions'); await expect(button(parity, c.versions.rollback)).toBeDisabled();
        await openTab(parity, 'invoke'); await expect(button(parity, c.invoke.action)).toBeDisabled();
        await openTab(parity, 'deploy'); await surface(parity).getByLabel(c.form.entrypoint, { exact: true }).fill('changed'); await expect(button(parity, c.form.update)).toBeDisabled();
      }
      await parity.open(manifest.route, { 'functions-inventory': '403', 'functions-actions': '403' }); await expect(surface(parity).getByText(c.noAccess.inventory, { exact: true })).toBeVisible();
      await parity.open(manifest.route, { 'functions-detail': '403' }); await ready(parity); await radio(parity, 'synthetic-hello').check(); await expect(surface(parity).getByText(c.noAccess.detail, { exact: true })).toBeVisible(); await expect(surface(parity).getByRole('table', { name: c.inventory.caption, exact: true })).toBeVisible();
      await parity.open(manifest.route, { 'functions-logs': '403' }); await select(parity); await selectActivation(parity);
      await expect(surface(parity).getByText(c.errors.logsForbidden, { exact: true })).toBeVisible(); await expect(surface(parity).getByTestId('functions-activation-result')).toBeVisible();
      await parity.open(manifest.route, { 'functions-detail': '404' }); await ready(parity); await radio(parity, 'synthetic-hello').check(); await expect(surface(parity).getByRole('heading', { name: c.notFound.title, exact: true })).toBeVisible(); await expect(button(parity, c.notFound.back)).toBeVisible();
      await parity.open(manifest.route, { 'functions-activation': '404' }); await select(parity); await selectActivation(parity); await expect(surface(parity).getByText(c.errors.activationGone, { exact: true })).toBeVisible();
      await parity.open(manifest.route, { 'functions-inventory': '500', 'functions-actions': '500' }); await expect(alertWith(parity, c.errors['5xx'])).toContainText('req_synthetic_functions_500');
      await expect(surface(parity).getByText(c.errors.inventory, { exact: true })).toHaveCount(0);
      const start = functionCalls(parity).length; await alertWith(parity, c.errors['5xx']).getByRole('button', { name: c.retry, exact: true }).click(); await expect.poll(() => functionCalls(parity).length).toBeGreaterThan(start);
      await parity.open(manifest.route, { 'functions-inventory': '500', 'functions-actions': 'actions-60' }); await ready(parity); await expect(surface(parity).getByRole('radio')).toHaveCount(60);
      await parity.open(manifest.route, { 'functions-inventory': ['network', 'success'], 'functions-actions': 'network' }); await expect(surface(parity).getByText(c.errors.inventory, { exact: true })).toBeVisible();
      await button(parity, c.retry).click(); await ready(parity);
      for (const [name, section, path] of sections.slice(0, 3)) {
        const variants = { 'functions-detail': 'success', [name]: ['500', 'success'] };
        await parity.open(manifest.route, variants); await ready(parity); await radio(parity, 'synthetic-hello').check();
        if (name === 'functions-activations') await openTab(parity, 'activations');
        await expect(alertWith(parity, c.errors['5xx'])).toContainText('req_synthetic_functions_500'); await expect(surface(parity).getByText(c.errors[section], { exact: true })).toHaveCount(0);
        const before = calls(parity).length; await alertWith(parity, c.errors['5xx']).getByRole('button', { name: c.retry, exact: true }).click(); await expect.poll(() => calls(parity).length).toBe(before + 1);
        expect(calls(parity).at(-1)).toEqual(get(path));
      }
      for (const [name, , path] of sections.slice(3)) {
        await parity.open(manifest.route, { [name]: ['500', 'success'] }); await select(parity); await selectActivation(parity);
        await expect(alertWith(parity, c.errors['5xx'])).toContainText('req_synthetic_functions_500');
        const before = calls(parity).length; await alertWith(parity, c.errors['5xx']).getByRole('button', { name: c.retry, exact: true }).click(); await expect.poll(() => calls(parity).length).toBe(before + 1);
        expect(calls(parity).at(-1)).toEqual(get(path));
      }
      await parity.open(manifest.route, { 'functions-detail': ['success', 'network'] }); await select(parity); await openTab(parity, 'versions');
      await parity.open(manifest.route, { 'functions-detail': 'network' }); await ready(parity); await radio(parity, 'synthetic-hello').check();
      await expect(surface(parity).getByText(c.errors.detail, { exact: true })).toBeVisible(); await expect(surface(parity).getByTestId('functions-detail')).toHaveCount(0);
      await parity.open(manifest.route, { 'functions-invoke': 'invoke-429' }); await select(parity); await openTab(parity, 'invoke'); await button(parity, c.invoke.action).click();
      await expect(surface(parity).getByText(c.errors['429'], { exact: true })).toBeVisible(); await expect(surface(parity).getByText(c.errors.limitsHint, { exact: true })).toBeVisible();
      for (const [variant, hint] of [['invoke-quota-exceeded', true], ['500', false], ['invoke-quota-message-400', false]]) {
        await parity.open(manifest.route, { 'functions-invoke': variant }); await select(parity); await openTab(parity, 'invoke'); await button(parity, c.invoke.action).click();
        await expect(surface(parity).getByTestId('functions-invoke').getByRole('alert')).toBeVisible(); await expect(surface(parity).getByText(c.errors.limitsHint, { exact: true })).toHaveCount(hint ? 1 : 0);
      }
    });

    test('accessibility', async ({ parity, server }) => {
      const c = copy(parity);
      let release; const pending = new Promise((resolve) => { release = resolve; });
      await parity.page.route(`**${inventoryPath}`, async (route) => { await pending; await route.fallback(); }, { times: 1 });
      try {
        await parity.page.goto(server.url(manifest.route.replace(/^\//, '')));
        await expect(surface(parity).getByTestId('functions-inventory')).toHaveAttribute('aria-busy', 'true');
        await check.assertAccessibility(parity);
      } finally { release(); }
      await ready(parity); await check.assertAccessibility(parity);
      await select(parity); await check.assertAccessibility(parity);
      await tab(parity, 'detail').focus();
      await parity.page.keyboard.press('ArrowRight'); await expect(tab(parity, 'versions')).toBeFocused();
      await parity.page.keyboard.press('End'); await expect(tab(parity, 'deploy')).toBeFocused();
      await parity.page.keyboard.press('Home'); await expect(tab(parity, 'detail')).toBeFocused();
      await openTab(parity, 'versions'); await check.assertAccessibility(parity);
      const versionRadios = surface(parity).getByTestId('functions-versions').getByRole('radio');
      await versionRadios.first().focus(); await parity.page.keyboard.press('ArrowDown'); await expect(versionRadios.nth(1)).toBeChecked();
      await parity.page.keyboard.press('ArrowDown'); await expect(versionRadios.nth(0)).toBeChecked();
      await openTab(parity, 'deploy'); await surface(parity).getByLabel(c.form.entrypoint, { exact: true }).fill('');
      await surface(parity).getByLabel(c.form.entrypoint, { exact: true }).fill('x'); await surface(parity).getByLabel(c.form.entrypoint, { exact: true }).fill('');
      await button(parity, c.form.update).click(); await expect(surface(parity).getByRole('region', { name: c.form.validationTitle })).toBeFocused();
      await surface(parity).getByRole('region', { name: c.form.validationTitle }).getByRole('link').first().click(); await expect(surface(parity).getByLabel(c.form.entrypoint, { exact: true })).toBeFocused();
      await check.assertAccessibility(parity);
      await button(parity, c.delete.aria.replace('{name}', 'synthetic-hello')).click();
      await parity.page.getByRole('alertdialog').getByRole('button', { name: c.delete.cancel, exact: true }).click();
      await expect(button(parity, c.delete.aria.replace('{name}', 'synthetic-hello'))).toBeFocused();
      await parity.open(manifest.route, { 'functions-detail': 'provisioning' }); await select(parity); await check.assertAccessibility(parity);
      await parity.open(manifest.route, { 'functions-versions': ['500', 'success'] }); await ready(parity); await radio(parity, 'synthetic-hello').check();
      const retry = alertWith(parity, c.errors['5xx']).getByRole('button', { name: c.retry, exact: true }); await retry.focus(); await parity.page.keyboard.press('Enter');
      await expect(surface(parity).getByRole('list', { name: c.history.label, exact: true })).toBeVisible(); await check.assertAccessibility(parity);
      await check.assertLocale(parity);
    });

    test('runtime-health', async ({ parity }) => {
      await parity.open('/console/overview');
      if (width < 1024) await parity.page.getByRole('button', { name: locale === 'es' ? 'Abrir navegación' : 'Open navigation', exact: true }).click();
      const link = parity.page.locator('a[href$="/console/functions"]:visible');
      await expect(link).toHaveCount(1);
      let documents = 0;
      parity.page.on('request', (request) => { if (request.isNavigationRequest() && request.frame() === parity.page.mainFrame()) documents++; });
      await link.click(); await ready(parity); expect(documents).toBe(0); await check.assertRuntimeHealth(parity);
      await select(parity); for (const key of ['versions', 'activations', 'triggers', 'invoke', 'deploy', 'detail']) await openTab(parity, key);
      await openTab(parity, 'activations'); await surface(parity).getByTestId('functions-activations').getByRole('radio').first().check(); await expect(surface(parity).getByTestId('functions-activation-result')).toBeVisible();
      await openTab(parity, 'deploy'); await surface(parity).getByLabel(copy(parity).form.entrypoint, { exact: true }).fill('changed'); await button(parity, copy(parity).form.discard).click();
      await check.assertRuntimeHealth(parity);
      for (const [name, , path] of sections) {
        await parity.open(manifest.route, { [name]: '500' }); await ready(parity); await radio(parity, 'synthetic-hello').check();
        if (name === 'functions-activations' || name === 'functions-activation' || name === 'functions-logs' || name === 'functions-result') { await openTab(parity, 'activations'); if (name !== 'functions-activations') await surface(parity).getByTestId('functions-activations').getByRole('radio').first().check(); }
        await expect(alertWith(parity, copy(parity).errors['5xx']).first()).toBeVisible(); expect(functionCalls(parity).some((request) => request.path === path)).toBe(true);
        await check.assertRuntimeHealth(parity);
      }
      // The harness keeps one request list per test, so each auth scenario counts only the requests made after its own open.
      const since = (mark) => ({ refreshes: parity.network.requests.slice(mark).filter(({ path }) => path.endsWith('/refresh')), inventory: functionCalls(parity).filter(({ path }) => path === inventoryPath).length - inventoryBefore });
      let mark = parity.network.requests.length; let inventoryBefore = functionCalls(parity).filter(({ path }) => path === inventoryPath).length;
      await parity.open(manifest.route, { 'functions-inventory': ['401-then-ok'] }); await ready(parity);
      expect(since(mark).refreshes).toHaveLength(1); expect(since(mark).inventory).toBe(2);
      mark = parity.network.requests.length; inventoryBefore = functionCalls(parity).filter(({ path }) => path === inventoryPath).length;
      await parity.open(manifest.route, { 'functions-inventory': '401', refresh: '401' });
      await expect(parity.page.getByRole('heading', { name: locale === 'es' ? 'Accede a In Falcone Console' : 'Sign in to In Falcone Console', exact: true })).toBeVisible();
      expect(since(mark).refreshes).toHaveLength(1); expect(since(mark).inventory).toBe(1);
    });

    test('responsive', async ({ parity }) => {
      await parity.open(manifest.route); await ready(parity); await check.assertResponsive(parity, width);
      await select(parity); await check.assertResponsive(parity, width);
      await openTab(parity, 'versions'); await check.assertResponsive(parity, width);
      await openTab(parity, 'activations'); await surface(parity).getByTestId('functions-activations').getByRole('radio').first().check(); await expect(surface(parity).getByTestId('functions-activation-logs')).toBeVisible(); await check.assertResponsive(parity, width);
      await openTab(parity, 'deploy'); await surface(parity).getByLabel(copy(parity).form.entrypoint, { exact: true }).fill('changed'); await check.assertResponsive(parity, width);
      const bar = surface(parity).getByRole('region', { name: copy(parity).form.actionBar, exact: true }); const box = await bar.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
    });

    test('kit-conformance', async ({ parity }) => {
      await check.kitConformance(manifest);
      await parity.open(manifest.route); await select(parity);
      await expect(surface(parity).getByText(/Guardrails applied|vs\. previous/)).toHaveCount(0);
      await expect(surface(parity).getByRole('list', { name: copy(parity).history.label, exact: true }).getByRole('listitem')).toHaveCount(3);
      await check.assertLocale(parity);
    });

    test('visual-review', async ({ parity }, info) => {
      const c = copy(parity);
      const cases = [
        ['inventory-detail', { 'functions-inventory': 'quota-available' }, async () => { await select(parity); }],
        ['versions', {}, async () => { await select(parity); await openTab(parity, 'versions'); }],
        ['activations-logs', {}, async () => { await select(parity); await selectActivation(parity); await expect(surface(parity).getByTestId('functions-activation-logs')).toBeVisible(); }],
        ['deploy-validation-unsaved', {}, async () => { await select(parity); await openTab(parity, 'deploy'); await surface(parity).getByLabel(c.form.entrypoint, { exact: true }).fill(''); await button(parity, c.form.update).click(); }],
        ['quota-near-limit', { 'functions-inventory': 'quota-near-limit' }, async () => { await ready(parity); }],
        ['quota-exhausted', { 'functions-inventory': 'quota-exhausted' }, async () => { await ready(parity); }],
        ['write-disabled', { 'functions-detail': 'suspended' }, async () => { await select(parity); }],
        ['delete-confirmation', {}, async () => { await select(parity); await button(parity, c.delete.aria.replace('{name}', 'synthetic-hello')).click(); await expect(parity.page.getByRole('alertdialog')).toBeVisible(); }],
      ];
      for (const [name, variants, steps] of cases) {
        await parity.open(manifest.route, variants); await steps();
        await check.assertLocale(parity); await check.assertAccessibility(parity); await screenshot(parity, info, name);
      }
    });
  });

  // Supplemental behaviour cases are outside the eight-check report group.
  test.describe(`console-functions-page supplemental ${locale} ${width}`, () => {
    test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });

    // Each write: a failed attempt (HTTP 500, then no response) is retried with the same Idempotency-Key, and the next
    // submit after the success gets a new one.
    const writes = {
      invoke: { endpoint: 'functions-invoke', suffix: '/invocations', method: 'POST', alert: (parity) => surface(parity).getByTestId('functions-invoke'), done: async (parity) => { await expect(tab(parity, 'activations')).toHaveAttribute('aria-selected', 'true'); },
        submit: async (parity, c) => { await openTab(parity, 'invoke'); await button(parity, c.invoke.action).click(); } },
      rollback: { endpoint: 'functions-rollback', suffix: '/rollback', method: 'POST', alert: (parity) => surface(parity).getByTestId('functions-versions'), done: async (parity) => { await expect(surface(parity).getByTestId('functions-rollback-result')).toBeVisible(); },
        submit: async (parity, c) => { await openTab(parity, 'versions'); await expect(button(parity, c.versions.rollback)).toBeEnabled(); await button(parity, c.versions.rollback).click(); } },
      update: { endpoint: 'functions-update', suffix: '', method: 'PATCH', alert: (parity) => surface(parity).getByTestId('functions-deploy'), done: async (parity) => { await expect(surface(parity).getByTestId('functions-deploy-result')).toBeVisible(); },
        submit: async (parity, c, round) => { await openTab(parity, 'deploy'); await surface(parity).getByLabel(c.form.entrypoint, { exact: true }).fill(`changed-${round}`); await button(parity, c.form.update).click(); } },
      create: { endpoint: 'functions-create', suffix: '', method: 'POST', alert: (parity) => surface(parity).getByTestId('functions-deploy'), done: async (parity) => { await expect(surface(parity).getByRole('heading', { name: 'synthetic-new', level: 2 })).toBeVisible(); }, create: true,
        submit: async (parity, c, round) => {
          await button(parity, c.deploy).click();
          await surface(parity).getByLabel(c.form.actionName, { exact: true }).fill(`synthetic-new-${round}`);
          await surface(parity).getByRole('combobox', { name: c.form.runtime }).click(); await parity.page.getByRole('option', { name: 'nodejs:20', exact: true }).click();
          await surface(parity).getByLabel(c.form.entrypoint, { exact: true }).fill('main'); await button(parity, c.form.create).click();
        } },
    };
    for (const [operation, spec] of Object.entries(writes)) for (const variant of ['500-then-ok', 'network-then-ok']) {
      test(`${operation} retry after ${variant.split('-')[0]} resends the failed attempt key and a success rotates it`, { tag: '@migration-behavior' }, async ({ parity }) => {
        const c = copy(parity), keys = trackKeys(parity), mine = () => keys.filter(({ method, path }) => method === spec.method && (spec.suffix ? path.endsWith(spec.suffix) : /^\/v1\/functions\/actions(\/synthetic-function-1)?$/.test(path)));
        await parity.open(manifest.route, { [spec.endpoint]: variant, 'functions-detail-4': 'success', 'functions-versions-4': 'success' });
        if (!spec.create) await select(parity); else await ready(parity);
        await spec.submit(parity, c, 1);
        const failed = spec.alert(parity).getByRole('alert'); await expect(failed).toBeVisible();
        await failed.getByRole('button', { name: c.retry, exact: true }).click();
        await spec.done(parity, c);
        expect(mine()).toHaveLength(2); expect(mine()[0].key).toBeTruthy(); expect(mine()[1].key).toBe(mine()[0].key);
        await spec.submit(parity, c, 2);
        await expect.poll(() => mine().length).toBe(3); expect(mine()[2].key).toBeTruthy(); expect(mine()[2].key).not.toBe(mine()[1].key);
      });
    }

    for (const variant of ['500', 'network']) {
      test(`delete retry after ${variant} resends the key, a success rotates it and another resource gets a new one`, { tag: '@migration-behavior' }, async ({ parity }) => {
        const c = copy(parity), keys = trackKeys(parity), dialog = parity.page.getByRole('alertdialog');
        const confirm = async (name) => { await dialog.getByRole('textbox', { name: c.delete.typed, exact: true }).fill(name); await dialog.getByRole('button', { name: c.delete.confirm, exact: true }).click(); };
        await parity.open(manifest.route, { 'functions-delete': [variant, 'success'], 'functions-delete-2': 'success', 'functions-detail-2': 'success' });
        await select(parity); await button(parity, c.delete.aria.replace('{name}', 'synthetic-hello')).click(); await confirm('synthetic-hello');
        await expect(dialog.getByRole('alert')).toBeVisible(); await dialog.getByRole('alert').getByRole('button', { name: c.retry, exact: true }).click();
        await expect.poll(() => keys.length).toBe(2); expect(keys[0].key).toBeTruthy(); expect(keys[0].key).toBe(keys[1].key);
        await expect(dialog).toHaveCount(0);
        // The same resource deleted again after the success gets a new key.
        await select(parity); await button(parity, c.delete.aria.replace('{name}', 'synthetic-hello')).click(); await confirm('synthetic-hello');
        await expect.poll(() => keys.length).toBe(3); expect(keys[2].key).not.toBe(keys[1].key);
        await expect(dialog).toHaveCount(0);
        await radio(parity, 'synthetic-billing').check(); await expect(surface(parity).getByRole('heading', { name: 'synthetic-billing', level: 2 })).toBeVisible();
        await button(parity, c.delete.aria.replace('{name}', 'synthetic-billing')).click(); await confirm('synthetic-billing');
        await expect.poll(() => keys.length).toBe(4); expect(keys[3].key).not.toBe(keys[2].key);
      });
    }

    test('delete key follows the resource across a failed attempt on another one', { tag: '@migration-behavior' }, async ({ parity }) => {
      const c = copy(parity), keys = trackKeys(parity);
      await parity.open(manifest.route, { 'functions-delete': ['500', '500'], 'functions-delete-2': 'success', 'functions-detail-2': 'success' });
      await select(parity); await button(parity, c.delete.aria.replace('{name}', 'synthetic-hello')).click();
      const dialog = parity.page.getByRole('alertdialog'); await dialog.getByRole('textbox', { name: c.delete.typed, exact: true }).fill('synthetic-hello'); await dialog.getByRole('button', { name: c.delete.confirm, exact: true }).click();
      await expect(dialog.getByRole('alert')).toContainText(c.errors['5xx']); await dialog.getByRole('alert').getByRole('button', { name: c.retry, exact: true }).click();
      await expect.poll(() => keys.length).toBe(2); expect(keys[0].key).toBe(keys[1].key);
      await dialog.getByRole('button', { name: c.delete.cancel, exact: true }).click();
      await radio(parity, 'synthetic-billing').check(); await expect(surface(parity).getByRole('heading', { name: 'synthetic-billing', level: 2 })).toBeVisible();
      await button(parity, c.delete.aria.replace('{name}', 'synthetic-billing')).click();
      await dialog.getByRole('textbox', { name: c.delete.typed, exact: true }).fill('synthetic-billing'); await dialog.getByRole('button', { name: c.delete.confirm, exact: true }).click();
      await expect.poll(() => keys.length).toBe(3); expect(keys[2].key).not.toBe(keys[1].key);
    });

    test('no definition export or import request is ever sent', { tag: '@migration-behavior' }, async ({ parity }) => {
      await parity.open(manifest.route); await select(parity); for (const key of ['versions', 'activations', 'triggers', 'invoke', 'deploy']) await openTab(parity, key);
      expect(functionCalls(parity).filter(({ path }) => /definition-(export|import)/.test(path))).toEqual([]);
      expect(functionCalls(parity).map(({ method, path }) => `${method} ${path}`)).toEqual(expect.arrayContaining([`GET ${inventoryPath}`, `GET ${detailPath}`, `GET ${versionsPath}`, `GET ${activationsPath}`]));
    });
  });
}
