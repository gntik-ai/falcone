import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import manifest, { pg } from './console-postgres-page.manifest.ts';
import { installPostgresHarness } from './console-postgres-page.support.mjs';

const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-postgres-page.json`, import.meta.url), 'utf8'))]));
const c = (parity) => bundles[parity.locale];
const section = (parity, name) => parity.page.getByTestId(`pg-${name}`);
const button = (parity, key, scope = parity.page) => scope.getByRole('button', { name: c(parity)[key], exact: true });
const tab = (parity, key) => parity.page.getByRole('tab', { name: c(parity)[key], exact: true });
async function selectDatabase(parity) { await section(parity, 'databases').getByRole('button', { name: 'app_db', exact: true }).click(); }
async function selectSchema(parity) { await selectDatabase(parity); await section(parity, 'schemas').getByRole('button', { name: 'public', exact: true }).click(); }
async function selectTable(parity) { await selectSchema(parity); await section(parity, 'tables').getByRole('button', { name: 'accounts', exact: true }).click(); await expect(section(parity, 'columns').getByText('gen_random_uuid()')).toBeVisible(); }
async function choose(parity, key, label) { await parity.page.getByRole('combobox', { name: c(parity)[key], exact: true }).click(); await parity.page.getByRole('option', { name: label, exact: true }).click(); }
async function capture(parity, info, name) {
  await expect(parity.page.getByTestId('console-postgres-page').locator('[aria-busy="true"]')).toHaveCount(0);
  await check.awaitTransitions(parity.page);
  const image = await parity.page.screenshot({ animations: 'disabled', caret: 'hide', fullPage: true });
  await info.attach(`${name}-${parity.locale}-sha256-${createHash('sha256').update(image).digest('hex')}`, { body: image, contentType: 'image/png' });
}
for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) test.describe(`console-postgres-page | ${locale} | ${width}`, () => {
  test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: {} });
  let harness;
  test.beforeEach(async ({ parity }) => { harness = await installPostgresHarness(parity); });
  test.afterEach(async ({ parity }) => { expect(harness.unmatched).toEqual([]); harness.cleanFaults(); await check.assertRuntimeHealth(parity); });
  test('data', async ({ parity }) => {
    await parity.open(manifest.route); const page = parity.page;
    await expect(page.getByRole('searchbox')).toHaveCount(0);
    await expect(section(parity, 'databases').getByRole('row')).toHaveCount(4);
    await expect(section(parity, 'databases').getByText('postgres_owner', { exact: true })).toHaveCount(3);
    await selectTable(parity);
    for (const text of ['id', 'uuid', 'NOT NULL', 'gen_random_uuid()', '1']) await expect(section(parity, 'columns').getByText(text, { exact: true })).toBeVisible();
    for (const [name, values] of [['indexes', ['accounts_pkey', 'btree', c(parity).unique]], ['policies', ['accounts_select_policy', 'SELECT', 'tenant_user']], ['security', [c(parity).rlsEnabled, 'Tenant Scoped', 'Review Required']], ['views', ['active_accounts', 'id, email']], ['matviews', ['accounts_snapshot', 'daily refresh', 'loaded']]]) {
      await tab(parity, name).click(); for (const value of values) await expect(section(parity, name).getByText(value, { exact: true })).toBeVisible();
    }
    expect(harness.calls.filter((call) => call.method === 'GET').map((call) => call.path)).toEqual(Object.entries(pg.paths).map(([name, path]) => path + (name === 'security' ? '' : pg.query)));
    await expect(page.getByText('Synthetic Tenant', { exact: true }).last()).toBeVisible();
    await check.assertLocale(parity);
  });
  test('action', async ({ parity }) => {
    await parity.open(manifest.route); await selectTable(parity);
    for (const kind of ['table', 'view', 'matview']) {
      if (kind !== 'table') await tab(parity, kind === 'view' ? 'views' : 'matviews').click();
      await button(parity, 'previewAction', kind === 'table' ? parity.page : section(parity, kind === 'view' ? 'views' : 'matviews')).click();
      await expect(section(parity, 'preview').getByText(pg.ddl.ddlPreview.statements[0].sql)).toBeVisible();
      await button(parity, 'close', section(parity, 'preview')).click();
    }
    const puts = harness.calls.filter((call) => call.method === 'PUT'); expect(puts).toHaveLength(3);
    for (const put of puts) expect(put.body).toMatchObject({ dryRun: true, executionMode: 'preview', tenantId: 'synthetic-tenant', workspaceId: 'synthetic-workspace', databaseName: 'app_db', schemaName: 'public' });
    for (const engine of ['postgresql', 'mongodb']) {
      await button(parity, 'newDatabase').click(); await button(parity, 'next').click();
      await parity.page.getByRole('textbox', { name: c(parity).name, exact: true }).fill(' ventas ');
      if (engine === 'mongodb') await choose(parity, 'engine', c(parity).mongodb);
      await button(parity, 'next').click(); const items = engine === 'postgresql' ? ['uuid-ossp', 'pgcrypto'] : ['users', 'orders'];
      for (const item of items) await parity.page.getByRole('checkbox', { name: item, exact: true }).check();
      await button(parity, 'next').click();
      expect(await parity.page.getByRole('dialog').locator('dd').allTextContents()).toContain(' ventas ');
      await button(parity, 'confirm').click(); await expect(parity.page.getByRole('link', { name: c(parity).openResource, exact: true })).toHaveAttribute('href', engine === 'postgresql' ? '/next/console/postgres' : '/console/mongo');
      const post = harness.calls.filter((call) => call.method === 'POST').at(-1); expect(post).toEqual({ method: 'POST', path: harness.createPath, body: { engine, name: ' ventas ', extensions: engine === 'postgresql' ? items : [], collections: engine === 'mongodb' ? items : [] } });
      // Escape closes the modal and returns focus to its originating toolbar button.
      await parity.page.keyboard.press('Escape'); await expect(button(parity, 'newDatabase')).toBeFocused();
    }
    const metrics = harness.calls.filter((call) => call.path.startsWith('/v1/metrics/')).map((call) => call.path); expect(metrics).toEqual([...harness.quotaPaths, ...harness.quotaPaths]);
    const nav = parity.page.getByRole('navigation', { name: c(parity).navigation, exact: true });
    const before = harness.calls.length; await nav.getByRole('button', { name: c(parity).databases, exact: true }).click();
    await expect(section(parity, 'schemas')).toHaveCount(0); expect(harness.calls).toHaveLength(before);
  });
  test('error-empty', async ({ parity }) => {
    harness.use({ [`GET ${pg.base}${pg.query}`]: { items: [] } }); await parity.open(manifest.route); await expect(parity.page.getByText(c(parity).databasesEmpty)).toBeVisible();
    harness.use({ [`GET ${pg.base}${pg.query}`]: (attempt) => attempt === 1 ? { network: true } : pg.fixtures.databases }); await parity.open(manifest.route);
    await button(parity, 'retry').click(); await expect(section(parity, 'databases').getByRole('table')).toBeVisible();
    expect(harness.calls).toHaveLength(2);
    harness.use({ [`GET ${pg.schemas}${pg.query}`]: { status: 404, body: {} } }); await parity.open(manifest.route); await selectDatabase(parity); await expect(section(parity, 'schemas').getByText(c(parity).notFound, { exact: true })).toBeVisible();
  });
  test('accessibility', async ({ parity }) => {
    await parity.open(manifest.route); await check.assertAccessibility(parity);
    const first = section(parity, 'databases').getByRole('button', { name: 'app_db', exact: true }); await first.focus(); await parity.page.keyboard.press('Enter');
    await section(parity, 'schemas').getByRole('button', { name: 'public', exact: true }).focus(); await parity.page.keyboard.press('Enter');
    await tab(parity, 'tables').focus(); const count = harness.calls.length; await parity.page.keyboard.press('ArrowRight'); await expect(tab(parity, 'views')).toBeFocused(); expect(harness.calls).toHaveLength(count);
    await tab(parity, 'tables').click(); await section(parity, 'tables').getByRole('button', { name: 'accounts', exact: true }).click();
    await expect(section(parity, 'columns').getByRole('table')).toBeVisible(); await check.assertAccessibility(parity);
    await button(parity, 'newDatabase').click(); await check.assertAccessibility(parity); await button(parity, 'next').click(); await check.assertAccessibility(parity);
    await parity.page.keyboard.press('Escape'); await expect(button(parity, 'newDatabase')).toBeFocused(); await check.assertLocale(parity);
  });
  test('kit-conformance', async ({ parity }) => {
    await check.kitConformance(manifest); await parity.open(manifest.route); await selectTable(parity); await button(parity, 'previewAction').click();
    await expect(section(parity, 'preview').locator('[data-severity="high"]')).toBeVisible();
    expect(await parity.page.getByTestId('console-postgres-page').getAttribute('class')).not.toMatch(/dark:|gradient|bg-white|text-black/);
  });
  test('runtime-health', async ({ parity }) => {
    await parity.open('/console/overview'); await parity.page.getByRole('link', { name: 'PostgreSQL', exact: true }).click(); await expect(section(parity, 'databases').getByRole('table')).toBeVisible();
    await parity.page.reload(); await expect(section(parity, 'databases').getByRole('table')).toBeVisible();
    await check.assertRuntimeHealth(parity);
  });
  test('responsive', async ({ parity }) => {
    harness.use({ [`GET ${pg.paths.tables}${pg.query}`]: pg.tablesPage1 }); await parity.open(manifest.route); await selectSchema(parity);
    await expect(section(parity, 'tables').getByRole('row')).toHaveCount(101); await check.assertResponsive(parity, width);
    await button(parity, 'newDatabase').click(); await check.assertResponsive(parity, width);
    const bounds = await parity.page.getByRole('dialog').boundingBox(); expect(bounds.width).toBeLessThanOrEqual(width);
  });
  test('visual-review', async ({ parity }, info) => {
    test.setTimeout(120_000);
    await parity.open(manifest.route); await capture(parity, info, 'databases'); await selectTable(parity);
    for (const name of ['columns', 'indexes', 'policies', 'security', 'tables', 'views', 'matviews']) { await tab(parity, name).click(); await capture(parity, info, name); }
    await button(parity, 'previewAction', section(parity, 'matviews')).click(); await expect(section(parity, 'preview').getByText('Exclusive lock possible')).toBeVisible(); await capture(parity, info, 'ddl'); await button(parity, 'close', section(parity, 'preview')).click();
    await button(parity, 'newDatabase').click(); await capture(parity, info, 'wizard-workspace'); await button(parity, 'next').click(); await parity.page.getByRole('textbox', { name: c(parity).name, exact: true }).fill(' ventas '); await capture(parity, info, 'wizard-engine'); await button(parity, 'next').click(); await capture(parity, info, 'wizard-config'); await button(parity, 'next').click(); await capture(parity, info, 'wizard-review'); await parity.page.keyboard.press('Escape');
    const first = pg.paths.tables + pg.query, second = `${first}&page%5Bafter%5D=opaque%2Fnext%2B100`;
    harness.use({ [`GET ${first}`]: pg.tablesPage1, [`GET ${second}`]: pg.fixtures.tables }); await parity.open(manifest.route); await selectSchema(parity); await capture(parity, info, 'tables-first'); await button(parity, 'next', section(parity, 'tables')).click(); await expect(button(parity, 'previous', section(parity, 'tables'))).toBeVisible(); await capture(parity, info, 'tables-terminal');
    harness.use({ [`GET ${pg.base}${pg.query}`]: { items: [] } }); await parity.open(manifest.route); await capture(parity, info, 'empty');
    harness.use({ [`GET ${pg.base}${pg.query}`]: { status: 500, body: { requestId: 'synthetic-request-id' } } }); await parity.open(manifest.route); await capture(parity, info, 'error');
    // A fresh synthetic read-only session supplies the legacy blocked wizard baseline.
    await parity.page.addInitScript(() => { document.addEventListener('readystatechange', () => { if (document.readyState !== 'interactive') return; const session = JSON.parse(sessionStorage.getItem('in-falcone.console-shell-session')); session.principal.platformRoles = ['tenant_viewer']; sessionStorage.setItem('in-falcone.console-shell-session', JSON.stringify(session)); }, { once: true }); });
    await parity.page.reload(); await button(parity, 'newDatabase').click(); await expect(parity.page.getByRole('heading', { name: c(parity).blocked, exact: true })).toBeVisible(); await capture(parity, info, 'blocked');
  });
});
