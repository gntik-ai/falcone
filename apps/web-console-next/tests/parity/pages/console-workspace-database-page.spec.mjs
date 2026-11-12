import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import manifest, { databasePath, dsn, hint, password, reason, record, requestId, rotationPath, sharedDsn, unknownReason } from './console-workspace-database-page.manifest.ts';
import { createDatabaseHarness } from './console-workspace-database-page.support.mjs';
import { needles, scanTree } from '../artifact-scan.mjs';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';

process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
// Response secrets must never enter traces, videos, error-context snapshots or matcher metadata.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-workspace-database-page.json`, import.meta.url), 'utf8'))]));
const harnesses = new WeakMap();
const harness = (parity) => harnesses.get(parity);
const copy = (parity) => bundles[parity.locale];
const surface = (parity) => parity.page.getByTestId('workspace-database-page');
const outcome = (parity) => parity.page.getByTestId('database-outcome');
const button = (parity, key, scope = parity.page) => scope.getByRole('button', { name: copy(parity)[key], exact: true });
const dialog = (parity) => parity.page.getByRole('alertdialog');
const typed = (parity) => dialog(parity).getByLabel(copy(parity).typedName, { exact: true });
const result = (parity) => parity.page.locator('[data-database-result]');
const ready = (parity) => expect(surface(parity).getByText(record.database_name, { exact: true })).toBeVisible();
const writes = (parity) => harness(parity).calls().filter(({ method, path }) => method === 'POST' && !path.endsWith('/refresh'));
async function open(parity, server, id) {
  await harness(parity).use(id, server);
  if (id.endsWith('loading') || id.endsWith('delayed')) { await parity.page.goto(server.url('console/database')); await expect(surface(parity).getByRole('heading', { level: 1 })).toBeVisible(); }
  else await parity.open(manifest.route);
}
async function provision(parity) { await button(parity, 'provision').click(); }
async function rotate(parity) {
  await button(parity, 'rotate').click(); await typed(parity).fill(record.database_name); await button(parity, 'confirm', dialog(parity)).click();
  await expect(dialog(parity)).toHaveCount(0);
}
async function masked(parity) {
  // Only a boolean leaves the page; protected values are never matcher inputs.
  expect(await parity.page.evaluate(({ dsn, password }) => {
    const fields = ['database-dsn', 'database-password'].map((id) => document.querySelector(`[data-testid="${id}"]`));
    return fields.every((field) => field?.getAttribute('data-masked') === 'true' && !field.value.includes(dsn) && !field.value.includes(password));
  }, { dsn, password }), 'both one-time values are masked').toBe(true);
}
async function safeAnnouncements(parity) {
  expect(await parity.page.evaluate((forbidden) => [...document.querySelectorAll('[data-live-announcer], [role="region"][aria-live="polite"]')].every((node) => forbidden.every((value) => !node.textContent.includes(value))), [dsn, password, record.username, hint, reason, unknownReason]), 'announcements contain no protected or server values').toBe(true);
}
async function scan(parity) {
  await check.awaitTransitions(parity.page);
  const result = await new AxeBuilder({ page: parity.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  // axe HTML can contain a revealed value, so failure output is limited to rule ids and selectors.
  expect(result.violations.filter((item) => ['serious', 'critical'].includes(item.impact)).map((item) => ({ id: item.id, targets: item.nodes.map((node) => node.target) }))).toEqual([]);
}
async function screenshot(parity, info, name) {
  await check.assertLocale(parity); await parity.page.evaluate(() => document.fonts.ready);
  const image = await parity.page.screenshot({ animations: 'disabled', caret: 'hide', mask: [parity.page.locator('[data-testid="database-dsn"], [data-testid="database-password"]')] });
  await info.attach(`${name}-${parity.locale}-sha256-${createHash('sha256').update(image).digest('hex')}`, { body: image, contentType: 'image/png' });
}
for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) test.describe(`console-workspace-database-page | superadmin | ${locale} | ${width}`, () => {
  test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
  test.beforeEach(async ({ parity }) => { harnesses.set(parity, createDatabaseHarness(parity)); await harness(parity).install(); });
  test.afterEach(async ({ parity }, info) => {
    const protectedValues = [password, dsn, sharedDsn];
    const consoleBytes = Buffer.from(harness(parity).messages.join('\n'));
    expect(protectedValues.flatMap(needles).every(([, needle]) => !consoleBytes.includes(needle)), 'console output contains no one-time value').toBe(true);
    if (existsSync(info.outputDir)) expect(scanTree(info.outputDir, protectedValues).hits, 'page artifacts contain no one-time value').toEqual([]);
    await check.assertRuntimeHealth(parity);
  });
  test('data', async ({ parity, server }) => {
    await open(parity, server, 'workspace-database.get.success'); await ready(parity);
    for (const value of [record.host, String(record.port), record.username]) await expect(surface(parity).getByText(value, { exact: true })).toBeVisible();
    for (const key of ['engine', 'mode', 'status']) await expect(surface(parity).getByLabel(`${copy(parity)[key]}: ${record[key]}`, { exact: true })).toBeVisible();
    await parity.page.getByRole('tab', { name: copy(parity).history, exact: true }).click();
    const history = parity.page.getByRole('list', { name: copy(parity).history });
    await expect(history.getByRole('listitem')).toHaveCount(1); await expect(history.getByText(copy(parity).created, { exact: true })).toBeVisible();
    await expect(history.locator('time')).toHaveAttribute('datetime', new Date(record.created_at).toISOString());
    await expect(surface(parity).getByText(copy(parity).historyUnavailable, { exact: true })).toBeVisible();
    for (const [fixture, key, raw] of [['workspace-database.provision.shared', 'shared', hint], ['workspace-database.rotate.not-rotated', 'notRotated', reason], ['workspace-database.rotate.not-rotated-unknown-reason', 'notRotatedFallback', unknownReason]]) {
      await open(parity, server, fixture);
      if (fixture.includes('.provision.')) await provision(parity); else { await ready(parity); await rotate(parity); }
      await expect(result(parity).getByText(copy(parity)[key], { exact: true })).toBeVisible();
      await expect(button(parity, 'details')).toHaveAttribute('aria-expanded', 'false');
      await expect(parity.page.getByText(raw, { exact: true })).toHaveCount(0);
      await button(parity, 'details').click(); await expect(parity.page.getByText(raw, { exact: true })).toBeVisible(); await safeAnnouncements(parity);
    }
    await check.assertLocale(parity);
  });
  test('action', async ({ parity, server }) => {
    await open(parity, server, 'workspace-database.provision.dedicated'); await button(parity, 'provision').dblclick();
    await expect(result(parity)).toBeFocused(); await masked(parity); await safeAnnouncements(parity);
    expect(writes(parity)).toEqual([{ method: 'POST', path: databasePath, body: {} }]);
    for (const method of ['cancel', 'escape']) {
      await button(parity, 'rotate').click(); await typed(parity).fill(`${record.database_name} `);
      await expect(button(parity, 'confirm', dialog(parity))).toBeDisabled();
      if (method === 'cancel') await button(parity, 'cancel', dialog(parity)).click(); else await parity.page.keyboard.press('Escape');
      await expect(dialog(parity)).toHaveCount(0); await expect(button(parity, 'rotate')).toBeFocused();
      expect(writes(parity)).toHaveLength(1);
    }
    await button(parity, 'rotate').click(); await typed(parity).fill(record.database_name); await button(parity, 'confirm', dialog(parity)).dblclick();
    await expect(result(parity)).toBeFocused(); await masked(parity); await safeAnnouncements(parity);
    expect(writes(parity)).toEqual([{ method: 'POST', path: databasePath, body: {} }, { method: 'POST', path: rotationPath, body: {} }]);
    for (const operation of ['provision', 'rotate']) {
      await open(parity, server, `workspace-database.${operation}.500-then-success`);
      if (operation === 'provision') await provision(parity); else { await ready(parity); await rotate(parity); }
      await expect(button(parity, 'retry', outcome(parity))).toBeFocused(); await button(parity, 'retry', outcome(parity)).click();
      if (operation === 'rotate') { await expect(typed(parity)).toHaveValue(''); await expect(button(parity, 'confirm', dialog(parity))).toBeDisabled(); await typed(parity).fill(record.database_name); await button(parity, 'confirm', dialog(parity)).click(); }
      await expect(result(parity)).toBeFocused(); await masked(parity); expect(writes(parity)).toHaveLength(2);
    }
  });
  test('error-empty', async ({ parity, server }) => {
    test.slow();
    await open(parity, server, 'workspace-database.get.delayed');
    await expect(surface(parity).getByLabel(copy(parity).loading, { exact: true })).toHaveAttribute('aria-busy', 'true');
    await ready(parity);
    for (const status of [403, 404, 500, 'network']) {
      await open(parity, server, `workspace-database.get.${status}`);
      await expect(surface(parity).getByRole('tab')).toHaveCount(0);
      if (status === 404) await expect(button(parity, 'provision')).toBeVisible(); else await expect(surface(parity).getByRole('alert')).toBeVisible();
      if (status === 500) await expect(surface(parity).getByText(requestId, { exact: true })).toBeVisible();
      for (const operation of ['provision', 'rotate']) {
        await open(parity, server, `workspace-database.${operation}.${status}`);
        if (operation === 'provision') await provision(parity); else { await ready(parity); await rotate(parity); }
        await expect(outcome(parity).getByRole('alert')).toBeVisible();
        await expect(parity.page.getByTestId('database-password')).toHaveCount(0);
        if (status === 403 || status === 404) {
          await expect(outcome(parity).getByRole('heading', { level: 2 })).toBeFocused();
          const count = harness(parity).calls().length; await button(parity, 'reload', outcome(parity)).click();
          await expect.poll(() => harness(parity).calls().length).toBe(count + 1);
          expect(harness(parity).calls().at(-1)).toEqual({ method: 'GET', path: databasePath, body: undefined });
          if (operation === 'provision') await expect(button(parity, 'provision')).toBeFocused(); else await expect(surface(parity).getByRole('heading', { level: 1 })).toBeFocused();
        } else await expect(button(parity, 'retry', outcome(parity))).toBeFocused();
      }
    }
    await open(parity, server, 'workspace-database.rotate.409-db-shared-mode'); await ready(parity); await rotate(parity);
    await expect(parity.page.locator('[data-database-message]')).toBeFocused(); await expect(outcome(parity).getByText(copy(parity).sharedConflict)).toBeVisible();
    for (const rejected of [false, true]) {
      await open(parity, server, `workspace-database.get.401-refresh-${rejected ? 'rejected' : 'ok'}`);
      if (rejected) {
        await expect(parity.page).toHaveURL(server.url('login'));
        expect(await parity.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(server.url('console/database')).pathname);
      } else await ready(parity);
      expect(harness(parity).calls().map(({ method, path }) => `${method} ${path}`)).toEqual([`GET ${databasePath}`, 'POST /v1/auth/login-sessions/synthetic-session/refresh', ...(rejected ? [] : [`GET ${databasePath}`])]);
    }
  });
  test('accessibility', async ({ parity, server }) => {
    await open(parity, server, 'workspace-database.get.success'); await ready(parity); await scan(parity);
    const summary = parity.page.getByRole('tab', { name: copy(parity).summary, exact: true });
    await summary.focus(); await parity.page.keyboard.press('ArrowRight');
    await expect(parity.page.getByRole('tab', { name: copy(parity).history, exact: true })).toHaveAttribute('aria-selected', 'true');
    await button(parity, 'rotate').click(); await expect(typed(parity)).toBeFocused(); await scan(parity);
    for (let index = 0; index < 8; index++) { await parity.page.keyboard.press('Tab'); expect(await dialog(parity).evaluate((node) => node.contains(document.activeElement))).toBe(true); }
    await parity.page.keyboard.press('Escape'); await expect(button(parity, 'rotate')).toBeFocused();
    await open(parity, server, 'workspace-database.provision.dedicated'); await button(parity, 'provision').focus(); await parity.page.keyboard.press('Enter'); await expect(result(parity)).toBeFocused();
    await masked(parity); await scan(parity);
    const secret = parity.page.getByTestId('database-dsn');
    const field = secret.locator('..'); await field.getByRole('button', { name: copy(parity).show, exact: true }).click();
    expect(await parity.page.evaluate((dsn) => document.querySelector('[data-testid="database-dsn"]').value === dsn, dsn), 'revealed value matches in memory').toBe(true);
    await field.getByRole('button', { name: copy(parity).hide, exact: true }).click(); await masked(parity);
    await parity.page.context().grantPermissions(['clipboard-read', 'clipboard-write']); await field.getByRole('button', { name: copy(parity).copy, exact: true }).click();
    await expect(parity.page.locator('[data-live-announcer="polite"]')).toContainText(copy(parity).copied); await safeAnnouncements(parity); await check.assertLocale(parity);
  });
  test('runtime-health', async ({ parity, server }) => {
    test.slow();
    await open(parity, server, 'workspace-database.rotate.success'); await ready(parity); await rotate(parity); await masked(parity);
    await parity.page.reload(); await ready(parity); await expect(parity.page.getByTestId('database-password')).toHaveCount(0);
    await open(parity, server, 'shell.workspace-switch'); await ready(parity); await rotate(parity); await masked(parity);
    // The shell's context setter also backs the page's picker.
    const switcher = parity.page.getByRole('button', { name: /Synthetic Workspace/ });
    await switcher.click(); await parity.page.getByRole('menuitemradio', { name: 'Other Workspace', exact: true }).click();
    await expect(parity.page.getByTestId('database-password')).toHaveCount(0);
    await expect(button(parity, 'provision')).toBeVisible();
    expect(harness(parity).calls().filter(({ path }) => path === '/v1/workspaces/synthetic-other/database')).toHaveLength(1);
    await harness(parity).use('workspace-database.get.success', server); await parity.page.goto(server.url('console/postgres'));
    await parity.page.getByRole('link', { name: locale === 'es' ? 'DB del área de trabajo' : 'Workspace database', exact: true }).click(); await ready(parity);
    expect(harness(parity).calls()).toEqual([{ method: 'GET', path: databasePath, body: undefined }]);
    for (const id of ['shell.workspaces-loading', 'shell.workspaces-error', 'shell.no-active-workspace', 'shell.no-workspaces-owner', 'shell.no-workspaces-viewer']) {
      await open(parity, server, id);
      expect(harness(parity).calls()).toEqual([]);
      if (id.endsWith('loading')) await expect(surface(parity).getByRole('status', { name: copy(parity).workspace.loading })).toBeVisible();
      else if (id.endsWith('error')) {
        await expect(surface(parity).getByRole('alert')).toBeVisible(); const before = harness(parity).state.workspaceReads; harness(parity).state.recovered = true;
        await surface(parity).getByRole('button', { name: copy(parity).retry, exact: true }).click();
        await expect(surface(parity).getByRole('combobox', { name: copy(parity).workspace.label })).toBeVisible(); expect(harness(parity).state.workspaceReads).toBe(before + 1);
      } else if (id.endsWith('owner')) await expect(surface(parity).getByRole('link', { name: copy(parity).workspace.create })).toHaveAttribute('href', '/console/workspaces');
      else if (id.endsWith('viewer')) { await expect(surface(parity).getByText(copy(parity).workspace.denied)).toBeVisible(); await expect(surface(parity).getByRole('link')).toHaveCount(0); }
      else {
        await surface(parity).getByRole('combobox', { name: copy(parity).workspace.label }).click(); await parity.page.getByRole('option', { name: 'Synthetic Workspace', exact: true }).click(); await ready(parity);
        expect(harness(parity).calls()).toEqual([{ method: 'GET', path: databasePath, body: undefined }]);
      }
    }
    await check.assertRuntimeHealth(parity);
  });
  test('responsive', async ({ parity, server }) => {
    for (const id of ['workspace-database.get.success', 'workspace-database.provision.dedicated', 'workspace-database.provision.shared', 'workspace-database.rotate.403']) {
      await open(parity, server, id);
      if (id.includes('.provision.')) { await provision(parity); await expect(result(parity)).toBeVisible(); }
      else { await ready(parity); if (id.endsWith('403')) await rotate(parity); }
      if (id.endsWith('shared')) await button(parity, 'details').click();
      await check.assertResponsive(parity, width);
    }
    await open(parity, server, 'workspace-database.get.success'); await ready(parity); await button(parity, 'rotate').click(); await expect(dialog(parity)).toBeVisible(); await check.assertResponsive(parity, width);
  });
  test('visual-review', async ({ parity, server }, info) => {
    test.slow();
    for (const id of ['workspace-database.get.404', 'workspace-database.get.success', 'workspace-database.get.403', 'workspace-database.get.500', 'workspace-database.provision.dedicated', 'workspace-database.provision.shared', 'workspace-database.provision.404', 'workspace-database.rotate.403']) {
      await open(parity, server, id);
      if (id.includes('.provision.')) { await provision(parity); await expect(outcome(parity).locator('[data-database-result], [data-database-failure]')).toBeVisible(); }
      if (id.includes('.rotate.')) { await ready(parity); await rotate(parity); await expect(outcome(parity).getByRole('alert')).toBeVisible(); }
      await screenshot(parity, info, id);
    }
    await open(parity, server, 'workspace-database.get.success'); await ready(parity); await parity.page.getByRole('tab', { name: copy(parity).history, exact: true }).click(); await screenshot(parity, info, 'history');
    await button(parity, 'rotate').click(); await expect(dialog(parity)).toBeVisible(); await screenshot(parity, info, 'confirm');
    // The checker and operator assess these candidates; the maker cannot approve visual baselines.
  });
  test('kit-conformance', async ({ parity, server }) => {
    await check.kitConformance(manifest); await open(parity, server, 'workspace-database.get.success'); await ready(parity);
    for (const sample of ['acme-web', 'billing-dashboard', 'Guardrails applied', 'Add policy']) await expect(parity.page.getByText(sample, { exact: true })).toHaveCount(0);
    await check.assertLocale(parity);
  });
});
