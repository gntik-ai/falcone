import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import manifest from './console-mongo-page.manifest.ts';
import { installMongoHarness, paths, readUrl, submitPath } from './console-mongo-page.support.mjs';

const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-mongo-page.json`, import.meta.url), 'utf8'))]));
const text = (p, key) => key.split('.').reduce((value, part) => value?.[part], bundles[p.locale]);
const button = (p, key, scope = p.page) => scope.getByRole('button', { name: text(p, key), exact: true });
const tab = (p, key) => p.page.getByRole('tab', { name: text(p, key), exact: true });
const surface = (p) => p.page.getByTestId('mongo-page');
const row = (p, name) => p.page.getByRole('button', { name, exact: true });
const KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const sections = { databases: 'mongo-databases', collections: 'mongo-collections', views: 'mongo-views', indexes: 'mongo-indexes', validation: 'mongo-validation', documents: 'mongo-documents' };
const sectionOf = (p, kind) => p.page.locator(`[id="${sections[kind === 'detail' ? 'validation' : kind]}"]`);
const bytes = (p, value) => new Intl.NumberFormat(p.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);

async function ready(p) { await expect(row(p, 'catalog')).toBeVisible(); }
async function database(p) { await ready(p); await row(p, 'catalog').click(); await expect(row(p, 'orders')).toBeVisible(); }
async function collection(p) { await database(p); await row(p, 'orders').click(); await expect(p.page.getByText('status_1', { exact: true })).toBeVisible(); }
async function activate(p, kind) {
  if (kind === 'databases') { await ready(p); return; }
  if (kind === 'collections') { await database(p); return; }
  if (kind === 'views') { await database(p); await tab(p, 'views').click(); return; }
  await collection(p);
  if (kind !== 'indexes') await tab(p, kind === 'detail' ? 'validation' : kind).click();
}
const shown = (p, kind) => sectionOf(p, kind);
async function capture(p, info, name) {
  await check.assertLocale(p); await p.page.evaluate(() => document.fonts.ready);
  const body = await p.page.screenshot({ animations: 'disabled', caret: 'hide' });
  await info.attach(`${name}-${p.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}
async function wizard(p, { name = 'ventas', items = ['users'], upto = 'review' } = {}) {
  await button(p, 'newDatabase').click(); const dialog = p.page.getByTestId('mongo-wizard'); await expect(dialog).toBeVisible();
  await button(p, 'next', dialog).click(); if (upto === 'workspace') return dialog;
  await dialog.getByLabel(text(p, 'wizard.name'), { exact: true }).fill(name); if (upto === 'engine') return dialog;
  await button(p, 'next', dialog).click(); for (const item of items) await dialog.getByRole('checkbox', { name: item, exact: true }).click(); if (upto === 'config') return dialog;
  await button(p, 'next', dialog).click(); await expect(button(p, 'wizard.confirm', dialog)).toBeVisible(); return dialog;
}
const posts = (h) => h.calls.filter(({ method, path }) => method === 'POST' && path === submitPath);
const failures = [403, 404, 500, 'network'];

for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) test.describe(`console-mongo-page | tenant_owner | ${locale} | ${width}`, () => {
  test.use({ role: 'tenant_owner', locale, viewport: { width, height: 900 }, pageEndpoints: {} });
  let h;
  test.beforeEach(async ({ parity, server }) => { h = await installMongoHarness(parity, server); });
  test.afterEach(async ({ parity }) => { expect(h.unmatched).toEqual([]); await check.assertRuntimeHealth(parity); });

  test('data', async ({ parity: p }) => {
    test.setTimeout(180000);
    await h.open({ cursors: ['databases'] }); await ready(p);
    const table = surface(p).getByRole('table', { name: text(p, 'tableLabels.databases'), exact: true });
    await expect(table.getByText(`${bytes(p, 2)} KB`, { exact: true }).first()).toBeVisible(); await expect(button(p, 'loadMore')).toBeVisible(); await expect(surface(p).getByText(text(p, 'loaded').replace('{count}', '2'), { exact: true })).toBeVisible();
    await row(p, 'catalog').click();
    for (const name of ['orders', 'events', 'users']) await expect(row(p, name)).toBeVisible();
    await tab(p, 'views').click(); await expect(p.page.getByText('orders_view', { exact: true })).toBeVisible(); await tab(p, 'collections').click();
    await row(p, 'orders').click(); await expect(p.page.getByText('status_1', { exact: true })).toBeVisible(); await expect(p.page.getByText('failed', { exact: true })).toBeVisible();
    await tab(p, 'validation').click(); await expect(p.page.getByText(text(p, 'validationLevel').replace('{value}', 'strict'), { exact: true })).toBeVisible();
    await tab(p, 'documents').click(); await expect(p.page.getByText('doc-1', { exact: true })).toBeVisible();
    const toggle = button(p, 'showJson').first(); await expect(toggle).toHaveAttribute('aria-expanded', 'false'); await toggle.click(); await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await check.assertLocale(p);
    const gets = h.calls.map(({ path }) => path);
    for (const kind of ['databases', 'collections', 'views', 'detail', 'indexes', 'documents']) expect(gets).toContain(readUrl(kind));
  });
  test('action', async ({ parity: p }) => {
    test.setTimeout(240000);
    for (const kind of ['databases', 'collections', 'views', 'indexes', 'documents']) {
      await h.open({ cursors: [kind] }); await activate(p, kind); const region = sectionOf(p, kind);
      await button(p, 'loadMore', region).click(); await expect(button(p, 'loadMore', region)).toHaveCount(0);
      expect(h.calls.filter(({ path }) => path.startsWith(paths[kind] + '?')).map(({ path }) => path)).toEqual([readUrl(kind), readUrl(kind, `next-${kind}`)]);
    }
    await h.open(); await ready(p); await button(p, 'refresh').click(); await expect.poll(() => h.calls.filter(({ path }) => path === readUrl('databases')).length).toBe(2);
    await h.open({ noWorkspace: 'two' }); await ready(p); await row(p, 'catalog').click(); await surface(p).getByRole('combobox', { name: text(p, 'workspacePicker'), exact: true }).click(); await p.page.getByRole('option', { name: 'Synthetic Workspace', exact: true }).click(); await expect(row(p, 'orders')).toBeVisible();
    expect(h.calls.filter(({ path }) => path === readUrl('collections')).length).toBeGreaterThan(0);
    // Mongo create: one POST, legacy body, one key, success links to /console/mongo.
    await h.open(); await ready(p); let dialog = await wizard(p); await button(p, 'wizard.confirm', dialog).click();
    await expect(dialog.getByRole('link', { name: text(p, 'wizard.openMongo') })).toHaveAttribute('href', '/console/mongo');
    expect(posts(h)).toHaveLength(1); expect(posts(h)[0].body).toEqual({ engine: 'mongodb', name: 'ventas', extensions: [], collections: ['users'] }); expect(posts(h)[0].key).toMatch(KEY);
    // 500 and network failures: error panel with request id, Reintentar re-sends the identical body with the same key.
    for (const first of ['create-500', 'network']) {
      await h.open({ create: [first, 'create-success'] }); await ready(p); dialog = await wizard(p); await button(p, 'wizard.confirm', dialog).click();
      const panel = dialog.getByTestId('mongo-wizard-outcome'); await expect(panel).toBeVisible(); await expect(dialog.getByTestId('mongo-wizard-result')).toHaveCount(0);
      if (first === 'create-500') await expect(panel).toContainText('req-mongo-500');
      await button(p, 'retry', panel).click(); await expect(dialog.getByTestId('mongo-wizard-result')).toBeVisible();
      expect(posts(h)).toHaveLength(2); expect(posts(h)[1].body).toEqual(posts(h)[0].body); expect(posts(h)[1].key).toBe(posts(h)[0].key);
    }
    // An Anterior edit gets a new key.
    await h.open({ create: ['create-500', 'create-success'] }); await ready(p); dialog = await wizard(p); await button(p, 'wizard.confirm', dialog).click(); await expect(dialog.getByTestId('mongo-wizard-outcome')).toBeVisible();
    await button(p, 'previous', dialog).click(); await dialog.getByRole('checkbox', { name: 'orders', exact: true }).click(); await button(p, 'next', dialog).click(); await button(p, 'wizard.confirm', dialog).click(); await expect(dialog.getByTestId('mongo-wizard-result')).toBeVisible();
    expect(posts(h)[1].key).not.toBe(posts(h)[0].key);
    // PostgreSQL branch.
    await h.open({ create: ['create-postgres-credential'] }); await ready(p); dialog = await wizard(p, { upto: 'engine' });
    await dialog.getByRole('combobox').click(); await p.page.getByRole('option', { name: 'PostgreSQL', exact: true }).click(); await button(p, 'next', dialog).click(); await dialog.getByRole('checkbox', { name: 'pgcrypto', exact: true }).click(); await button(p, 'next', dialog).click(); await button(p, 'wizard.confirm', dialog).click();
    await expect(dialog.getByRole('link', { name: text(p, 'wizard.openPostgres') })).toHaveAttribute('href', '/console/postgres');
    expect(posts(h)[0].body).toEqual({ engine: 'postgresql', name: 'ventas', extensions: ['pgcrypto'], collections: [] }); expect(await p.page.content()).not.toContain('synthetic-one-time-secret');
    // Quota exhausted blocks the Motor step.
    await h.open({ quota: true }); await ready(p); dialog = await wizard(p, { upto: 'engine' }); await expect(dialog.getByText(text(p, 'wizard.quotaExhausted'))).toBeVisible(); await expect(button(p, 'next', dialog)).toBeDisabled();
  });
  test('error-empty', async ({ parity: p }) => {
    test.setTimeout(300000);
    for (const kind of ['databases', 'collections', 'views', 'indexes', 'detail', 'documents']) {
      await h.open({ empty: [kind] }); await activate(p, kind);
      const empty = { databases: 'empty.databases', collections: 'empty.collections', views: 'empty.views', indexes: 'empty.indexes', detail: 'empty.validation', documents: 'empty.documents' }[kind];
      await expect(surface(p).getByText(text(p, empty), { exact: true })).toBeVisible();
      for (const failure of failures) {
        await h.open({ errors: { [kind]: failure } }); await activate(p, kind); const panel = surface(p).getByTestId(`mongo-failure-${kind === 'detail' ? 'validation' : kind}`); await expect(panel).toBeVisible();
        if (failure === 500 || failure === 'network') { const count = h.calls.length; h.state.recovered = true; await button(p, 'retry', panel).click(); await expect(panel).toHaveCount(0); expect(h.calls.slice(count)).toEqual([{ method: 'GET', path: readUrl(kind), body: undefined }]); }
      }
    }
    // A views failure never takes the collections of the same database down.
    await h.open({ errors: { views: 500 } }); await database(p); await tab(p, 'views').click(); await expect(surface(p).getByTestId('mongo-failure-views')).toBeVisible(); await tab(p, 'collections').click(); await expect(row(p, 'orders')).toBeVisible();
    // A failed Cargar más keeps the loaded rows and resends the same cursor.
    await h.open({ cursors: ['databases'], errors: { databases: 500 }, errorsOnNext: 'databases' }); await ready(p); await button(p, 'loadMore').click(); const more = surface(p).getByTestId('mongo-failure-more'); await expect(more).toBeVisible(); await expect(row(p, 'catalog')).toBeVisible();
    h.state.recovered = true; await button(p, 'retry', more).click(); await expect(row(p, 'archive')).toBeVisible(); expect(h.calls.filter(({ path }) => path === readUrl('databases', 'next-databases'))).toHaveLength(2);
    for (const refresh of ['success', 'rejected']) {
      await h.open({ errors: { databases: 401 }, refresh });
      if (refresh === 'success') await ready(p); else await expect(p.page).toHaveURL(/\/login$/);
      expect(h.calls.filter(({ path }) => path.endsWith('/refresh'))).toHaveLength(1); expect(h.calls.filter(({ path }) => path === readUrl('databases'))).toHaveLength(refresh === 'success' ? 2 : 1);
    }
    await h.open({ noTenant: true }); await expect(surface(p).getByText(text(p, 'noTenant'), { exact: true }).last()).toBeVisible(); expect(h.calls).toEqual([]);
    for (const role of ['tenant_owner', 'tenant_viewer']) {
      await h.open({ role, noWorkspace: 'empty' }); await ready(p); await row(p, 'catalog').click();
      if (role === 'tenant_owner') await expect(surface(p).getByRole('link', { name: text(p, 'workspaceCreate') })).toHaveAttribute('href', '/console/workspaces'); else await expect(surface(p).getByText(text(p, 'workspaceDenied'))).toBeVisible();
      expect(h.calls.filter(({ path }) => path.startsWith(paths.collections) || path.startsWith(paths.views))).toEqual([]);
    }
    for (const name of ['create-500', 'network']) { await h.open({ create: [name] }); await ready(p); const dialog = await wizard(p); await button(p, 'wizard.confirm', dialog).click(); await expect(dialog.getByTestId('mongo-wizard-outcome')).toBeVisible(); await expect(dialog.getByTestId('mongo-wizard-result')).toHaveCount(0); await expect(dialog.getByText('ventas')).toBeVisible(); }
    await h.open({ create: ['create-403'] }); await ready(p); let dialog = await wizard(p); await button(p, 'wizard.confirm', dialog).click(); await expect(dialog.getByText(text(p, 'wizard.submit403'))).toBeVisible(); await expect(button(p, 'wizard.confirm', dialog)).toBeDisabled();
    await h.open({ create: ['create-409'] }); await ready(p); dialog = await wizard(p); await button(p, 'wizard.confirm', dialog).click(); await expect(dialog.getByText(text(p, 'wizard.conflict'))).toBeVisible(); await expect(button(p, 'retry', dialog)).toHaveCount(0);
    await h.open({ create: ['create-replay-unavailable'] }); await ready(p); dialog = await wizard(p); await button(p, 'wizard.confirm', dialog).click(); await expect(dialog.getByText(text(p, 'wizard.replayUnavailable'))).toBeVisible(); await expect.poll(() => h.calls.filter(({ path }) => path === readUrl('databases')).length).toBe(2);
    await h.open({ create: ['create-mismatch', 'create-success'] }); await ready(p); dialog = await wizard(p); await button(p, 'wizard.confirm', dialog).click(); await expect(dialog.getByText(text(p, 'wizard.mismatch'))).toBeVisible(); await button(p, 'wizard.confirm', dialog).click(); await expect(dialog.getByTestId('mongo-wizard-result')).toBeVisible(); expect(posts(h)[1].key).not.toBe(posts(h)[0].key);
    await h.open({ create: ['create-in-progress', 'create-success'] }); await ready(p); dialog = await wizard(p); await button(p, 'wizard.confirm', dialog).click(); await expect(dialog.getByText(text(p, 'wizard.inProgress'))).toBeVisible(); await expect(dialog.getByTestId('mongo-wizard-result')).toBeVisible({ timeout: 8000 }); expect(new Set(posts(h).map(({ key }) => key)).size).toBe(1);
    for (const kind of ['databases', 'collections', 'views', 'indexes', 'detail', 'documents']) {
      await h.open({ delayed: [kind] });
      if (kind === 'databases') { await expect(sectionOf(p, kind)).toHaveAttribute('aria-busy', 'true'); await ready(p); }
      else { await activate(p, kind); await expect(sectionOf(p, kind)).toHaveAttribute('aria-busy', 'false'); }
    }
    await h.open({ role: 'tenant_viewer' }); await ready(p); await button(p, 'newDatabase').click(); await expect(p.page.getByText(text(p, 'wizard.blocked'), { exact: true })).toBeVisible();
  });
  test('accessibility', async ({ parity: p }) => {
    test.setTimeout(240000);
    await h.open({ cursors: ['databases'] }); await ready(p); await check.assertAccessibility(p);
    await database(p); await check.assertAccessibility(p); await tab(p, 'views').click(); await check.assertAccessibility(p); await tab(p, 'collections').click();
    await collection(p); await check.assertAccessibility(p); for (const key of ['validation', 'documents']) { await tab(p, key).click(); await check.assertAccessibility(p); }
    await button(p, 'showJson').first().click(); await check.assertAccessibility(p);
    const crumb = p.page.getByRole('navigation', { name: text(p, 'navigation') }); await expect(crumb.locator('[aria-current="page"]')).toHaveCount(1);
    await row(p, 'orders').focus(); await p.page.keyboard.press('Enter'); await expect(row(p, 'orders')).toHaveAttribute('aria-pressed', 'true');
    await h.open({ create: ['create-500', 'create-success'] }); await ready(p); await button(p, 'newDatabase').click(); const dialog = p.page.getByTestId('mongo-wizard');
    await check.assertAccessibility(p); await button(p, 'next', dialog).click(); await dialog.getByLabel(text(p, 'wizard.name'), { exact: true }).fill('ventas'); await check.assertAccessibility(p); await button(p, 'next', dialog).click(); await check.assertAccessibility(p); await button(p, 'next', dialog).click(); await check.assertAccessibility(p);
    await button(p, 'wizard.confirm', dialog).click(); const panel = dialog.getByTestId('mongo-wizard-outcome'); await expect(panel).toBeFocused(); await check.assertAccessibility(p);
    await button(p, 'retry', panel).click(); await expect(dialog.getByTestId('mongo-wizard-result')).toBeFocused(); await p.page.keyboard.press('Escape'); await expect(button(p, 'newDatabase')).toBeFocused();
    await h.open({ create: ['create-403'] }); await ready(p); const forbidden = await wizard(p); await button(p, 'wizard.confirm', forbidden).click(); await expect(forbidden.getByTestId('mongo-wizard-outcome')).toBeFocused(); await check.assertAccessibility(p);
    await check.assertLocale(p);
  });
  test('runtime-health', async ({ parity: p }) => {
    test.setTimeout(240000);
    await h.open({ cursors: ['databases', 'collections', 'documents'], create: ['create-500', 'create-success'] }); await ready(p);
    if (width < 1024) await p.page.getByRole('button', { name: locale === 'es' ? 'Abrir navegación' : 'Open navigation', exact: true }).click(); await p.page.getByRole('link', { name: /MongoDB/ }).first().click(); await ready(p);
    await button(p, 'loadMore').click(); await row(p, 'catalog').click(); await row(p, 'orders').click();
    for (const key of ['views', 'collections']) await tab(p, key).click();
    await row(p, 'billing').click(); await row(p, 'catalog').click();
    const dialog = await wizard(p); await button(p, 'wizard.confirm', dialog).click(); await expect(dialog.getByTestId('mongo-wizard-outcome')).toBeVisible(); await button(p, 'retry', dialog).click(); await expect(dialog.getByTestId('mongo-wizard-result')).toBeVisible();
  });
  test('responsive', async ({ parity: p }) => {
    await h.open({ cursors: ['databases'], create: ['create-500'] }); await collection(p); await tab(p, 'documents').click(); await check.assertResponsive(p, width);
    await tab(p, 'indexes').click(); await check.assertResponsive(p, width); await button(p, 'loadMore').first().isVisible();
    const dialog = await wizard(p); await button(p, 'wizard.confirm', dialog).click(); await expect(button(p, 'retry', dialog)).toBeVisible(); await check.assertResponsive(p, width);
    const box = await dialog.boundingBox(); expect(box.width).toBeLessThanOrEqual(width);
  });
  test('visual-review', async ({ parity: p }, info) => {
    test.setTimeout(240000);
    await h.open({ cursors: ['databases'] }); await ready(p); await capture(p, info, 'databases');
    await database(p); await capture(p, info, 'database-collections'); await tab(p, 'views').click(); await capture(p, info, 'database-views'); await tab(p, 'collections').click();
    await collection(p); await capture(p, info, 'collection-indexes'); await tab(p, 'validation').click(); await capture(p, info, 'collection-validation'); await tab(p, 'documents').click(); await button(p, 'showJson').first().click(); await capture(p, info, 'collection-documents');
    await h.open({ create: ['create-500'] }); await ready(p); let dialog = await wizard(p, { upto: 'workspace' }); await capture(p, info, 'wizard-workspace'); await dialog.getByLabel(text(p, 'wizard.name'), { exact: true }).fill('ventas'); await capture(p, info, 'wizard-engine'); await button(p, 'next', dialog).click(); await capture(p, info, 'wizard-config'); await button(p, 'next', dialog).click(); await capture(p, info, 'wizard-review');
    await button(p, 'wizard.confirm', dialog).click(); await expect(dialog.getByTestId('mongo-wizard-outcome')).toBeVisible(); await capture(p, info, 'wizard-error');
    await h.open({ create: ['create-403'] }); await ready(p); dialog = await wizard(p); await button(p, 'wizard.confirm', dialog).click(); await expect(dialog.getByTestId('mongo-wizard-outcome')).toBeVisible(); await capture(p, info, 'wizard-no-access');
    await h.open({ empty: ['databases'] }); await capture(p, info, 'empty'); await h.open({ errors: { databases: 500 } }); await capture(p, info, 'error');
    await h.open({ errors: { views: 500 } }); await database(p); await tab(p, 'views').click(); await expect(surface(p).getByTestId('mongo-failure-views')).toBeVisible(); await capture(p, info, 'views-error');
  });
  test('kit-conformance', async () => { await check.kitConformance(manifest); });
});
