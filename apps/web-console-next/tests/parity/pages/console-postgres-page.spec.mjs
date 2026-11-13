import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import manifest, { fixtures, paths, pageUrl, ddlPreviewFixture } from './console-postgres-page.manifest.ts';
import { installPostgresHarness } from './console-postgres-page.support.mjs';
import { assertPostgresLocale } from './console-postgres-page.locale.mjs';
const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-postgres-page.json`, import.meta.url), 'utf8'))]));
const copy = (p) => bundles[p.locale];
const button = (p, key, scope = p.page) => scope.getByRole('button', { name: copy(p)[key], exact: true });
const tab = (p, key) => p.page.getByRole('tab', { name: copy(p)[key], exact: true });
const surface = (p) => p.page.getByTestId('postgres-page');
async function ready(p) { await expect(p.page.getByRole('button', { name: 'app_db', exact: true })).toBeVisible(); }
async function schema(p) { await ready(p); await p.page.getByRole('button', { name: 'app_db', exact: true }).click(); await p.page.getByRole('button', { name: 'public', exact: true }).click(); await expect(p.page.getByRole('button', { name: 'accounts', exact: true })).toBeVisible(); }
async function table(p) { await schema(p); await p.page.getByRole('button', { name: 'accounts', exact: true }).click(); await expect(p.page.getByText('gen_random_uuid()', { exact: true })).toBeVisible(); }
async function activate(p, kind) {
  if (kind === 'databases') return; await ready(p);
  await p.page.getByRole('button', { name: 'app_db', exact: true }).click(); if (kind === 'schemas') return;
  await p.page.getByRole('button', { name: 'public', exact: true }).click();
  if (['tables', 'views', 'matviews'].includes(kind)) { await tab(p, kind).click(); return; }
  await p.page.getByRole('button', { name: 'accounts', exact: true }).click(); await tab(p, kind).click();
}
async function capture(p, info, name) {
  await assertPostgresLocale(p); await p.page.evaluate(() => document.fonts.ready);
  const body = await p.page.screenshot({ animations: 'disabled', caret: 'hide' });
  await info.attach(`${name}-${p.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}
for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) test.describe(`console-postgres-page | tenant_owner | ${locale} | ${width}`, () => {
  test.use({ role: 'tenant_owner', locale, viewport: { width, height: 900 }, pageEndpoints: {} });
  let h;
  test.beforeEach(async ({ parity, server }) => { h = await installPostgresHarness(parity, server); });
  test.afterEach(async ({ parity }) => { expect(h.unmatched).toEqual([]); await check.assertRuntimeHealth(parity); });
  test('data', async ({ parity: p }) => {
    await h.open(); await ready(p);
    await expect(surface(p).getByRole('table', { name: copy(p).tableLabels.databases, exact: true }).getByRole('cell', { name: copy(p).enums.active, exact: true })).toHaveCount(fixtures.databases.items.length);
    for (const name of ['app_db', 'analytics', 'archive']) await expect(p.page.getByRole('button', { name, exact: true })).toBeVisible();
    await table(p); await expect(surface(p).getByRole('columnheader', { name: copy(p).default, exact: true })).toBeVisible(); for (const value of ['id', 'uuid', 'NOT NULL', 'gen_random_uuid()']) await expect(surface(p).getByText(value, { exact: true })).toBeVisible();
    await tab(p, 'indexes').click(); for (const value of ['accounts_pkey', 'btree', 'email']) await expect(surface(p).getByText(value, { exact: true })).toBeVisible();
    await tab(p, 'policies').click(); for (const value of ['accounts_select_policy', 'Permissive', 'SELECT', 'tenant_user']) await expect(surface(p).getByText(value, { exact: true })).toBeVisible();
    await tab(p, 'security').click(); await expect(surface(p).getByText('Review Required', { exact: true })).toBeVisible();
    await tab(p, 'views').click(); await expect(surface(p).getByText('active_accounts', { exact: true })).toBeVisible();
    await tab(p, 'matviews').click(); await expect(surface(p).getByText('daily refresh', { exact: true })).toBeVisible(); await assertPostgresLocale(p);
    expect(h.calls.filter(({ method }) => method === 'GET').map(({ path }) => path)).toEqual(Object.entries(paths).map(([kind, path]) => kind === 'security' ? path : pageUrl(path)));
  });
  test('action', async ({ parity: p }) => {
    test.setTimeout(180000);
    for (const kind of Object.keys(paths).filter((key) => key !== 'security')) {
      await h.open({ cursors: [kind] }); await activate(p, kind); const region = p.page.locator(`[id="pg-${paths[kind]}"]`);
      await button(p, 'next', region).click(); await expect(button(p, 'previous', region)).toBeVisible(); await expect(button(p, 'next', region)).toHaveCount(0); await button(p, 'previous', region).click(); await expect(button(p, 'next', region)).toBeVisible();
      expect(h.calls.filter(({ path }) => path.startsWith(paths[kind] + '?')).map(({ path }) => path)).toEqual([pageUrl(paths[kind]), pageUrl(paths[kind], `next-${kind}`), pageUrl(paths[kind])]);
    }
    for (const kind of ['table', 'view', 'matview']) {
      await h.open(); await schema(p); if (kind === 'table') await p.page.getByRole('button', { name: 'accounts', exact: true }).click(); else await tab(p, kind === 'view' ? 'views' : 'matviews').click();
      await button(p, 'preview').click(); await expect(p.page.getByTestId('pg-preview').getByText('Exclusive lock possible', { exact: true })).toBeVisible();
      for (const category of [copy(p).enums.locks, copy(p).enums.create]) await expect(p.page.getByTestId('pg-preview').getByText(category, { exact: true })).toBeVisible();
      for (const target of ddlPreviewFixture().ddlPreview.lockTargets) await expect(p.page.getByTestId('pg-preview').getByText(target, { exact: true })).toBeVisible();
      const writes = h.calls.filter(({ method }) => method === 'PUT'); expect(writes).toHaveLength(1); expect(writes[0].body).toMatchObject({ tenantId: 'synthetic-tenant', workspaceId: 'synthetic-workspace', databaseName: 'app_db', schemaName: 'public', dryRun: true, executionMode: 'preview' });
      await button(p, 'close', p.page.getByTestId('pg-preview')).click(); await expect(button(p, 'preview')).toBeFocused();
    }
    await h.open(); await schema(p);
    await p.page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (code) => { window.__postgresCopied = code; } } }); });
    await button(p, 'copy').first().click(); await expect(p.page.getByText(copy(p).snippetCopied, { exact: true }).first()).toBeVisible(); expect(await p.page.evaluate(() => window.__postgresCopied)).toContain('postgresql://<PG_USER>:<YOUR_SECRET>@<RESOURCE_HOST>:5432/app_db?sslmode=require');
    for (const engine of ['postgresql', 'mongodb']) {
      await h.open(); await ready(p); await button(p, 'newDatabase').click(); const dialog = p.page.getByRole('dialog'); await button(p, 'next', dialog).click();
      await dialog.getByLabel(copy(p).name, { exact: true }).fill(' '); await expect(button(p, 'next', dialog)).toBeDisabled();
      await dialog.getByLabel(copy(p).name, { exact: true }).fill(' ventas ');
      if (engine === 'mongodb') { await dialog.getByRole('combobox').click(); await p.page.getByRole('option', { name: 'MongoDB', exact: true }).click(); }
      await button(p, 'next', dialog).click(); const items = engine === 'postgresql' ? ['uuid-ossp', 'pgcrypto'] : ['users', 'orders']; for (const item of items) await dialog.getByRole('checkbox', { name: item, exact: true }).click();
      await button(p, 'next', dialog).click(); expect(await dialog.getByText('ventas', { exact: false }).textContent()).toBe(' ventas '); await button(p, 'confirm', dialog).click();
      await expect(dialog.getByRole('link', { name: copy(p).openResource })).toHaveAttribute('href', `/console/${engine === 'postgresql' ? 'postgres' : 'mongo'}`);
      expect(h.calls.filter(({ method }) => method === 'POST')).toEqual([{ method: 'POST', path: '/v1/workspaces/synthetic-workspace/databases', body: { engine, name: ' ventas ', extensions: engine === 'postgresql' ? items : [], collections: engine === 'mongodb' ? items : [] } }]);
    }
  });
  test('error-empty', async ({ parity: p }) => {
    test.setTimeout(180000);
    for (const kind of Object.keys(paths)) {
      await h.open({ empty: [kind] }); await activate(p, kind); await expect(surface(p).getByText(copy(p).empty[kind], { exact: true })).toBeVisible();
      for (const failure of [403, 404, 500, 'network']) {
        await h.open({ errors: { [kind]: failure } }); await activate(p, kind); const panel = p.page.getByTestId(`pg-failure-${kind}`); await expect(panel).toBeVisible();
        if (failure === 500 || failure === 'network') { const count = h.calls.length; h.state.recovered = true; await button(p, 'retry', panel).click(); await expect(panel).toHaveCount(0); expect(h.calls.slice(count)).toEqual([{ method: 'GET', path: kind === 'security' ? paths[kind] : pageUrl(paths[kind]), body: undefined }]); }
      }
    }
    for (const kind of Object.keys(paths)) {
      await h.open({ delayed: [kind] });
      if (kind === 'databases') { await expect(p.page.locator(`[id="pg-${paths[kind]}"]`)).toHaveAttribute('aria-busy', 'true'); await ready(p); }
      else { await activate(p, kind); await expect(p.page.locator(`[id="pg-${paths[kind]}"]`)).toHaveAttribute('aria-busy', 'true'); await expect(p.page.locator(`[id="pg-${paths[kind]}"]`)).toHaveAttribute('aria-busy', 'false'); }
    }
    for (const refresh of ['success', 'rejected']) {
      await h.open({ errors: { databases: 401 }, refresh });
      if (refresh === 'success') await ready(p); else await expect(p.page).toHaveURL(/\/login$/);
      expect(h.calls.filter(({ path }) => path.endsWith('/refresh'))).toHaveLength(1); expect(h.calls.filter(({ path }) => path === pageUrl(paths.databases))).toHaveLength(refresh === 'success' ? 2 : 1);
    }
    await h.open({ noTenant: true }); await expect(surface(p).getByText(copy(p).noTenant, { exact: true }).last()).toBeVisible(); expect(h.calls).toEqual([]);
    for (const role of ['tenant_owner', 'tenant_viewer']) {
      await h.open({ role, noWorkspace: 'empty' }); await ready(p); await p.page.getByRole('button', { name: 'app_db', exact: true }).click();
      if (role === 'tenant_owner') await expect(surface(p).getByRole('link', { name: copy(p).workspaceCreate })).toHaveAttribute('href', '/console/workspaces');
      else await expect(surface(p).getByText(copy(p).workspaceDenied)).toBeVisible();
      expect(h.calls.filter(({ path }) => path.startsWith(paths.schemas))).toEqual([]);
    }
    await h.open({ noWorkspace: 'two' }); await ready(p); await p.page.getByRole('button', { name: 'app_db', exact: true }).click(); await surface(p).getByRole('combobox', { name: copy(p).workspacePicker, exact: true }).click(); await p.page.getByRole('option', { name: 'Synthetic Workspace', exact: true }).click(); await expect(p.page.getByRole('button', { name: 'public', exact: true })).toBeVisible(); expect(h.calls.filter(({ path }) => path === pageUrl(paths.schemas))).toHaveLength(1);
    await h.open({ role: 'tenant_viewer' }); await ready(p); const beforeDenied = h.calls.length; await button(p, 'newDatabase').click(); await expect(p.page.getByText(copy(p).blocked, { exact: true })).toBeVisible(); await expect.poll(() => h.calls.length - beforeDenied).toBe(4); expect(h.calls.slice(beforeDenied).every(({ method, path }) => method === 'GET' && path.startsWith('/v1/metrics/'))).toBe(true);
    await h.open({ missingQuery: true }); await schema(p);
    for (const kind of ['views', 'matviews']) { await tab(p, kind).click(); await button(p, 'preview').click(); await expect(p.page.getByText(copy(p)[kind === 'views' ? 'viewQueryMissing' : 'matviewQueryMissing'], { exact: true })).toBeVisible(); await button(p, 'close', p.page.getByTestId('pg-preview')).click(); }
    expect(h.calls.some(({ method }) => method === 'PUT')).toBe(false);
    await h.open({ missingDdl: true }); await table(p); await button(p, 'preview').click(); await expect(p.page.getByText(copy(p).previewMissing, { exact: true })).toBeVisible();
    await h.open({ quota: true }); await ready(p); await button(p, 'newDatabase').click(); const dialog = p.page.getByRole('dialog'); await button(p, 'next', dialog).click(); await dialog.getByLabel(copy(p).name).fill('ventas'); await expect(dialog.getByText(copy(p).quotaExhausted)).toBeVisible(); await expect(button(p, 'next', dialog)).toBeDisabled();
  });
  test('accessibility', async ({ parity: p }) => {
    await h.open(); await table(p); await check.assertAccessibility(p);
    const start = h.calls.length; await tab(p, 'columns').focus(); await p.page.keyboard.press('ArrowRight'); await expect(tab(p, 'indexes')).toBeFocused(); expect(h.calls).toHaveLength(start);
    const crumb = p.page.getByRole('navigation', { name: copy(p).navigation }).getByRole('button', { name: 'app_db', exact: true }); await crumb.focus(); await p.page.keyboard.press('Enter'); await expect(p.page.getByRole('navigation', { name: copy(p).navigation }).locator('[aria-current="page"]')).toBeFocused(); expect(h.calls).toHaveLength(start);
    await button(p, 'newDatabase').click(); await check.assertAccessibility(p); await p.page.keyboard.press('Escape'); await expect(button(p, 'newDatabase')).toBeFocused(); await assertPostgresLocale(p);
  });
  test('runtime-health', async ({ parity: p }) => {
    await h.open(); await ready(p); if (width < 1024) await p.page.getByRole('button', { name: locale === 'es' ? 'Abrir navegación' : 'Open navigation', exact: true }).click(); await p.page.getByRole('link', { name: /PostgreSQL/ }).click(); await ready(p);
    await button(p, 'newDatabase').click(); const dialog = p.page.getByRole('dialog'); await button(p, 'next', dialog).click(); await dialog.getByLabel(copy(p).name).fill('ventas'); await button(p, 'next', dialog).click(); await button(p, 'next', dialog).click(); await button(p, 'confirm', dialog).click(); await dialog.getByRole('link', { name: copy(p).openResource }).click(); await expect(dialog).toHaveCount(0); await ready(p); await check.assertRuntimeHealth(p);
  });
  test('responsive', async ({ parity: p }) => {
    await h.open({ tables100: true, cursors: ['tables'] }); await table(p); await check.assertResponsive(p, width); await button(p, 'newDatabase').click(); await check.assertResponsive(p, width);
    const box = await p.page.getByRole('dialog').boundingBox(); expect(box.width).toBeLessThanOrEqual(width);
  });
  test('visual-review', async ({ parity: p }, info) => {
    test.setTimeout(180000);
    await h.open(); await ready(p); await capture(p, info, 'databases'); await table(p);
    for (const kind of ['columns', 'indexes', 'policies', 'security', 'tables', 'views', 'matviews']) { await tab(p, kind).click(); await capture(p, info, kind); }
    await button(p, 'preview').first().click(); await expect(p.page.getByTestId('pg-preview').getByText('Exclusive lock possible')).toBeVisible(); await capture(p, info, 'preview');
    await h.open({ tables100: true, cursors: ['tables'] }); await schema(p); await capture(p, info, 'tables-first'); await button(p, 'next', p.page.locator(`[id="pg-${paths.tables}"]`)).click(); await capture(p, info, 'tables-terminal');
    await h.open(); await ready(p); await button(p, 'newDatabase').click(); const dialog = p.page.getByRole('dialog'); await capture(p, info, 'workspace'); await button(p, 'next', dialog).click(); await dialog.getByLabel(copy(p).name).fill('ventas'); await capture(p, info, 'engine'); await button(p, 'next', dialog).click(); await capture(p, info, 'config'); await button(p, 'next', dialog).click(); await capture(p, info, 'review');
    await h.open({ empty: ['databases'] }); await capture(p, info, 'empty'); await h.open({ errors: { databases: 500 } }); await capture(p, info, 'error'); await h.open({ role: 'tenant_viewer' }); await ready(p); await button(p, 'newDatabase').click(); await capture(p, info, 'blocked');
  });
  test('kit-conformance', async () => { await check.kitConformance(manifest); });
});
