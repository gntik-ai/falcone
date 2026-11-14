import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import manifest, { fixtures, synthetic } from './console-postgres-data-page.manifest.ts';
import { pageUrl as postgresPageUrl, paths as postgresPaths } from './console-postgres-page.manifest.ts';
import { installPostgresDataHarness } from './console-postgres-data-page.support.mjs';
import { assertPostgresDataLocale } from './console-postgres-data-page.locale.mjs';

const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-postgres-data-page.json`, import.meta.url), 'utf8'))]));
const copy = (p) => bundles[p.locale];
const text = (p, key) => key.split('.').reduce((value, part) => value?.[part], copy(p));
const button = (p, key, scope = p.page, options = {}) => scope.getByRole('button', { name: text(p, key), exact: true, ...options });
const rowAction = (p, kind, id) => p.page.getByRole('button', { name: text(p, `rows.${kind}Aria`).replace('{id}', id), exact: true });
const writes = (h) => h.calls.filter(({ method, path }) => method !== 'GET' && !path.endsWith('/refresh'));
const rowsTable = (p) => p.page.getByRole('table', { name: text(p, 'rows.tableLabel'), exact: true });
const keysTable = (p) => p.page.getByRole('table', { name: text(p, 'keys.tableLabel'), exact: true });
const field = (p, key) => p.page.getByLabel(text(p, key), { exact: true });
async function enter(p, { database = 'app_db', table = 'accounts', schema } = {}) {
  if (schema !== undefined) await field(p, 'fields.schema').fill(schema);
  await field(p, 'fields.database').fill(database); await field(p, 'fields.table').fill(table);
}
async function loaded(p) {
  await expect(rowsTable(p).getByText('acc_01', { exact: true })).toBeVisible();
  await expect(keysTable(p).getByText('syn_anon_01…', { exact: true })).toBeVisible();
}
async function ready(p, h, patch = {}) { await h.open(patch); await enter(p); await loaded(p); }
const reveal = async (p, key) => { await button(p, key).click(); const dialog = p.page.getByTestId('pgdata-reveal'); await expect(dialog).toBeVisible(); return dialog; };
// Masks the issued key and both snippets, which contain it; baselines never hold a credential.
const masks = (p) => [p.page.getByTestId('pgdata-issued-key'), p.page.getByTestId('pgdata-reveal').getByRole('group', { name: text(p, 'keys.integration') })];
async function capture(p, info, name) {
  await assertPostgresDataLocale(p); await p.page.evaluate(() => document.fonts.ready);
  const body = await p.page.screenshot({ animations: 'disabled', caret: 'hide', mask: masks(p) });
  await info.attach(`${name}-${p.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}

for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) test.describe(`console-postgres-data-page | tenant_owner | ${locale} | ${width}`, () => {
  test.use({ role: 'tenant_owner', locale, viewport: { width, height: 900 }, pageEndpoints: {} });
  let h;
  test.beforeEach(async ({ parity, server }) => { h = await installPostgresDataHarness(parity, server); });
  test.afterEach(async ({ parity }) => { expect(h.unmatched).toEqual([]); await check.assertRuntimeHealth(parity); });

  test('data', async ({ parity: p }) => {
    await ready(p, h);
    await expect(p.page.getByRole('heading', { name: text(p, 'rows.titleCount').replace('{total}', new Intl.NumberFormat(locale).format(60)), exact: true })).toBeVisible();
    for (const column of ['id', 'email', 'plan']) await expect(rowsTable(p).getByRole('columnheader', { name: column, exact: true })).toBeVisible();
    for (const item of fixtures['pg-rows-page1'].items.slice(0, 3)) for (const value of Object.values(item)) await expect(rowsTable(p).getByText(value, { exact: true }).first()).toBeVisible();
    await expect(rowsTable(p).getByRole('button', { name: /./ })).toHaveCount(fixtures['pg-rows-page1'].items.length * 2);
    await expect(keysTable(p).getByText('syn_svc_01…', { exact: true })).toBeVisible();
    await expect(keysTable(p).getByText(text(p, 'keys.statuses.active'), { exact: true })).toBeVisible(); await expect(keysTable(p).getByText(text(p, 'keys.statuses.revoked'), { exact: true })).toBeVisible();
    // Revocar exists only on the active key and is absent from the revoked row.
    await expect(keysTable(p).getByRole('button', { name: /./ })).toHaveCount(1);
    await expect(p.page.getByRole('heading', { name: 'public.accounts', exact: true })).toBeVisible();
    await assertPostgresDataLocale(p);
    expect(h.calls.map(({ method, path }) => `${method} ${path}`).sort()).toEqual([`GET ${h.urls.rows()}`, `GET ${h.paths.keys}`].sort());
  });

  test('action', async ({ parity: p }) => {
    test.setTimeout(180000);
    await ready(p, h);
    // Filters send column=op.value, split in lists, and reset the cursor; keys reload with every rows reload.
    h.reset(); await field(p, 'filters.column').fill('id'); await p.page.getByRole('combobox', { name: text(p, 'filters.operator'), exact: true }).click(); await p.page.getByRole('option', { name: 'in', exact: true }).click();
    await field(p, 'filters.valueList').fill('a, b'); await button(p, 'filters.add').click(); await expect(p.page.getByText(text(p, 'rows.empty'), { exact: true })).toBeVisible();
    expect(h.calls.map(({ method, path }) => `${method} ${path}`).sort()).toEqual([`GET ${h.urls.rows({ filters: [['id', 'in.(a,b)']] })}`, `GET ${h.paths.keys}`].sort());
    h.reset(); await p.page.getByRole('button', { name: new RegExp(`^${text(p, 'filters.remove').split('{filter}')[0]}`) }).click(); await loaded(p); expect(h.calls.map(({ method }) => method)).toEqual(['GET', 'GET']);
    // The pager sends page[size] and page[after].
    h.reset(); await button(p, 'pager.next').click(); await expect(rowsTable(p).getByText('acc_26', { exact: true })).toBeVisible(); expect(h.calls.map(({ path }) => path)).toContain(h.urls.rows({ after: 'c1' }));
    await button(p, 'pager.previous').click(); await loaded(p);
    // Insert: POST {values} then GET, the form resets, count 61 and the toast.
    h.reset(); await field(p, 'insert.label').fill('{"email":"new@example.test"}'); await button(p, 'insert.submit').click();
    await expect(rowsTable(p).getByText('new@example.test', { exact: true })).toBeVisible(); await expect(p.page.getByRole('heading', { name: text(p, 'rows.titleCount').replace('{total}', '61'), exact: true })).toBeVisible();
    await expect(field(p, 'insert.label')).toHaveValue('{}'); await expect(p.page.getByText(text(p, 'inserted'), { exact: true }).first()).toBeVisible();
    expect(writes(h)).toEqual([expect.objectContaining({ method: 'POST', path: h.paths.rows, body: { values: { email: 'new@example.test' } } })]);
    // Edit: PATCH by primary key without id, drawer closes, row updated, focus on a stable control.
    h.reset(); await rowAction(p, 'edit', 'acc_01').click(); const drawer = p.page.getByTestId('pgdata-drawer'); await expect(drawer).toBeVisible();
    await drawer.getByLabel(text(p, 'editDrawer.label'), { exact: true }).fill(JSON.stringify({ id: 'acc_01', plan: 'enterprise' })); await button(p, 'save', drawer).click();
    await expect(drawer).toHaveCount(0); await expect(rowsTable(p).getByText('enterprise', { exact: true })).toBeVisible(); await expect(p.page.getByText(text(p, 'updated'), { exact: true }).first()).toBeVisible();
    expect(writes(h)).toEqual([expect.objectContaining({ method: 'PATCH', path: `${h.paths.byKey}?id=acc_01`, body: { changes: { plan: 'enterprise' } } })]);
    expect(await p.page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
    // Delete: typed id, one DELETE, row gone, count 59.
    h.reset(); await rowAction(p, 'delete', 'acc_01').click(); const confirm = p.page.getByTestId('pgdata-confirm'); await expect(button(p, 'deleteConfirm.confirm', confirm)).toBeDisabled();
    await confirm.getByLabel(text(p, 'confirm.typeLabel').replace('{text}', 'acc_01'), { exact: true }).fill('acc_01'); await button(p, 'deleteConfirm.confirm', confirm).click();
    await expect(rowsTable(p).getByText('acc_01', { exact: true })).toHaveCount(0); await expect(p.page.getByRole('heading', { name: text(p, 'rows.titleCount').replace('{total}', '59'), exact: true })).toBeVisible();
    expect(writes(h)).toEqual([expect.objectContaining({ method: 'DELETE', path: `${h.paths.byKey}?id=acc_01` })]);
    // Issue keys: POST {keyType}, masked reveal, exact copy, preview with only the apikey header.
    for (const [kind, name, key] of [['anon', 'keys.issueAnon', synthetic.anon], ['service', 'keys.issueService', synthetic.service]]) {
      await p.page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value) => { window.__postgresDataCopied = value; } } }); });
      h.reset(); const dialog = await reveal(p, name);
      expect(writes(h)).toEqual([expect.objectContaining({ method: 'POST', path: h.paths.keys, body: { keyType: kind } })]);
      await expect(p.page.getByTestId('pgdata-issued-key')).toHaveAttribute('data-masked', 'true'); await expect(dialog.getByText(text(p, 'keys.onceTitle'), { exact: true })).toBeVisible();
      await button(p, 'keys.copy', dialog).click(); expect(await p.page.evaluate(() => window.__postgresDataCopied)).toBe(key);
      h.reset(); await button(p, 'keys.preview', dialog).click(); await expect(dialog.getByRole('table', { name: text(p, 'keys.previewTable'), exact: true }).getByText('pro', { exact: true })).toBeVisible();
      expect(h.calls).toEqual([expect.objectContaining({ method: 'GET', path: h.urls.preview, apikey: key, authorization: undefined })]);
      await button(p, 'close', dialog).click(); await expect(dialog).toHaveCount(0); await expect(button(p, name)).toBeFocused();
    }
    // Revoke: typed prefix, DELETE then GET, revoked with no Revocar, toast.
    h.reset(); await p.page.getByRole('button', { name: text(p, 'keys.revokeAria').replace('{prefix}', 'syn_anon_01'), exact: true }).click(); const revoke = p.page.getByTestId('pgdata-confirm');
    await revoke.getByLabel(text(p, 'confirm.typeLabel').replace('{text}', 'syn_anon_01'), { exact: true }).fill('syn_anon_01'); await button(p, 'keys.revokeConfirm', revoke).click();
    await expect(keysTable(p).getByRole('button', { name: /./ })).toHaveCount(0); await expect(p.page.getByText(text(p, 'keys.revoked'), { exact: true }).first()).toBeVisible();
    expect(h.calls.map(({ method, path }) => `${method} ${path}`)).toEqual([`DELETE ${h.paths.keys}/key-anon-1`, `GET ${h.paths.keys}`]);
    // Returning to a visited target starts at its first page.
    await ready(p, h); await button(p, 'pager.next').click(); await expect(rowsTable(p).getByText('acc_26', { exact: true })).toBeVisible();
    await field(p, 'fields.table').fill('orders'); await expect(rowsTable(p).getByText('ord_1', { exact: true })).toBeVisible(); await field(p, 'fields.table').fill('accounts'); await loaded(p);
    await expect(button(p, 'pager.previous')).toBeDisabled();
    expect(h.calls.filter(({ path }) => path.includes('/orders/')).every(({ path }) => !path.includes('page%5Bafter%5D'))).toBe(true);
  });

  test('error-empty', async ({ parity: p }) => {
    test.setTimeout(240000);
    // Workspace required: loading, error with retry, picker, create link or denial. No /v1 data request in any branch.
    for (const patch of [{ noWorkspace: 'empty' }, { noWorkspace: 'empty', role: 'tenant_viewer' }, { noWorkspace: 'two' }]) {
      await h.open(patch); await expect(p.page.getByText(text(p, 'workspace.description'), { exact: true })).toBeVisible(); expect(h.calls).toEqual([]);
      if (patch.noWorkspace === 'two') await expect(p.page.getByRole('combobox', { name: text(p, 'workspace.picker'), exact: true })).toBeVisible();
      else if (patch.role) await expect(p.page.getByText(text(p, 'workspace.denied'), { exact: true })).toBeVisible();
      else await expect(p.page.getByRole('link', { name: text(p, 'workspace.create'), exact: true })).toHaveAttribute('href', '/console/workspaces');
    }
    for (const status of [403, 500]) { await h.open({ errors: { workspaces: status } }); await expect(p.page.getByTestId('pgdata-failure-workspace')).toBeVisible(); await expect(button(p, 'retry', p.page.getByTestId('pgdata-failure-workspace'))).toBeVisible(); expect(h.calls).toEqual([]); }
    // Select-table prompt and the validations that send no request.
    await h.open(); await expect(p.page.getByText(text(p, 'prompt'), { exact: true })).toBeVisible(); await field(p, 'fields.database').fill('app_db'); await expect(p.page.getByText(text(p, 'prompt'), { exact: true })).toBeVisible(); expect(h.calls).toEqual([]);
    // Skeletons while rows and keys are pending.
    await h.open(); const releaseRows = h.hold('rows'), releaseKeys = h.hold('keys'); await enter(p);
    await expect(p.page.getByTestId('pgdata-rows')).toHaveAttribute('aria-busy', 'true'); await expect(p.page.getByTestId('pgdata-keys')).toHaveAttribute('aria-busy', 'true');
    releaseRows(); releaseKeys(); await loaded(p); await expect(p.page.getByTestId('pgdata-rows')).toHaveAttribute('aria-busy', 'false');
    // Zero rows keep the insert form; an empty key list explains itself while both issue buttons stay usable.
    await h.open({ empty: ['rows', 'keys'] }); await enter(p);
    await expect(p.page.getByText(text(p, 'rows.empty'), { exact: true })).toBeVisible(); await expect(p.page.getByText(text(p, 'keys.empty'), { exact: true })).toBeVisible();
    await expect(field(p, 'insert.label')).toBeVisible(); await expect(button(p, 'keys.issueAnon')).toBeEnabled(); await expect(button(p, 'keys.issueService')).toBeEnabled();
    // JSON validations and a missing primary key send no request.
    await ready(p, h); h.reset(); await field(p, 'insert.label').fill('{nope'); await button(p, 'insert.submit').click();
    await expect(p.page.getByText(text(p, 'newRowError').replace('{reason}', text(p, 'jsonInvalid')), { exact: true })).toBeVisible();
    await field(p, 'insert.label').fill('[1]'); await button(p, 'insert.submit').click(); await expect(p.page.getByText(text(p, 'newRowError').replace('{reason}', text(p, 'jsonObjectExpected')), { exact: true })).toBeVisible(); expect(h.calls).toEqual([]);
    await rowAction(p, 'edit', 'acc_01').click(); const drawer = p.page.getByTestId('pgdata-drawer'); await drawer.getByLabel(text(p, 'editDrawer.label'), { exact: true }).fill('{nope'); await button(p, 'save', drawer).click();
    await expect(drawer.getByText(text(p, 'editRowError').replace('{reason}', text(p, 'jsonInvalid')), { exact: true })).toBeVisible(); expect(h.calls).toEqual([]); await button(p, 'cancel', drawer).click();
    await h.open({ noId: true }); await enter(p); await expect(rowsTable(p).getByText('anon@example.test', { exact: true })).toBeVisible();
    await p.page.getByRole('button', { name: /^(Editar|Edit) /, exact: false }).first().click(); await expect(p.page.getByText(text(p, 'missingKeyEdit'), { exact: true })).toBeVisible();
    await p.page.getByRole('button', { name: /^(Eliminar|Delete) /, exact: false }).first().click(); await expect(p.page.getByText(text(p, 'missingKeyDelete'), { exact: true })).toBeVisible(); expect(writes(h)).toEqual([]);
    // Rows failures: 401 (refresh ok and rejected), 403, 404 with Volver, 500 with request id and retry, network.
    for (const refresh of ['success', 'rejected']) {
      await h.open({ errors: { rows: 401 }, refresh }); await enter(p);
      if (refresh === 'success') await loaded(p); else await expect(p.page).toHaveURL(/\/login$/);
      expect(h.calls.filter(({ path }) => path.endsWith('/refresh'))).toHaveLength(1); expect(h.calls.filter(({ path }) => path === h.urls.rows())).toHaveLength(refresh === 'success' ? 2 : 1);
    }
    await h.open({ errors: { rows: 403 } }); await enter(p); await expect(p.page.getByTestId('pgdata-failure-rows').getByText(text(p, 'noAccess'), { exact: true })).toBeVisible(); expect(writes(h)).toEqual([]);
    await h.open({ errors: { keys: 403 } }); await enter(p); await expect(rowsTable(p).getByText('acc_01', { exact: true })).toBeVisible(); await expect(p.page.getByTestId('pgdata-failure-keys').getByText(text(p, 'noAccess'), { exact: true })).toBeVisible(); expect(writes(h)).toEqual([]);
    await h.open({ errors: { rows: 404 } }); await enter(p, { schema: 'private' }); const missing = p.page.getByTestId('pgdata-failure-rows'); await expect(missing.getByText(text(p, 'notFound'), { exact: true })).toBeVisible();
    h.reset(); await button(p, 'back', missing).click(); await expect(p.page.getByText(text(p, 'prompt'), { exact: true })).toBeVisible();
    await expect(field(p, 'fields.database')).toHaveValue(''); await expect(field(p, 'fields.table')).toHaveValue(''); await expect(field(p, 'fields.schema')).toHaveValue('public'); await expect(field(p, 'fields.database')).toBeFocused(); expect(h.calls).toEqual([]);
    for (const failure of [500, 'network']) {
      await h.open({ errors: { rows: failure }, recoverAfterFailure: ['rows'] }); await enter(p); const panel = p.page.getByTestId('pgdata-failure-rows'); await expect(panel).toBeVisible();
      if (failure === 500) await expect(panel).toContainText('pg-browser-request');
      h.reset(); await button(p, 'retry', panel).click(); await expect(panel).toHaveCount(0); await expect(rowsTable(p).getByText('acc_01', { exact: true })).toBeVisible(); expect(h.calls.map(({ path }) => path)).toEqual([h.urls.rows()]);
    }
    await h.open({ errors: { keys: 500 }, recoverAfterFailure: ['keys'] }); await enter(p); const keysPanel = p.page.getByTestId('pgdata-failure-keys'); await expect(keysPanel).toBeVisible();
    h.reset(); await button(p, 'retry', keysPanel).click(); await expect(keysTable(p).getByText('syn_anon_01…', { exact: true })).toBeVisible(); expect(h.calls.map(({ path }) => path)).toEqual([h.paths.keys]);
    // Mutation failure shows the server message inline and keeps the form.
    await ready(p, h, { errors: { insert: 500 } }); await field(p, 'insert.label').fill('{"id":"dup"}'); await button(p, 'insert.submit').click(); await expect(p.page.getByRole('alert').filter({ hasText: 'synthetic insert failure' })).toBeVisible(); await expect(field(p, 'insert.label')).toHaveValue('{"id":"dup"}');
    // Busy guard: a pending insert disables the mutation controls even after the target changes; the rest stays enabled.
    await ready(p, h); const releaseInsert = h.hold('insert'); await field(p, 'filters.column').fill('id'); await field(p, 'filters.value').fill('x');
    await button(p, 'insert.submit').click(); await expect(button(p, 'insert.submit')).toBeDisabled(); await expect(button(p, 'pager.next')).toBeDisabled(); await expect(rowAction(p, 'edit', 'acc_01')).toBeDisabled(); await expect(rowAction(p, 'delete', 'acc_01')).toBeDisabled();
    await expect(p.page.getByRole('combobox', { name: text(p, 'pager.size'), exact: true })).toBeEnabled(); await expect(field(p, 'filters.column')).toBeEnabled(); await expect(button(p, 'filters.add')).toBeEnabled(); await expect(button(p, 'keys.issueAnon')).toBeEnabled();
    await expect(p.page.getByRole('button', { name: text(p, 'keys.revokeAria').replace('{prefix}', 'syn_anon_01'), exact: true })).toBeEnabled();
    await field(p, 'fields.table').fill('orders'); await expect(rowsTable(p).getByText('ord_1', { exact: true })).toBeVisible(); await expect(button(p, 'insert.submit')).toBeDisabled();
    await field(p, 'fields.table').fill('accounts'); await expect(button(p, 'insert.submit')).toBeDisabled(); releaseInsert(); await expect(button(p, 'insert.submit')).toBeEnabled();
    // Busy drawer: nothing dismisses it while the patch is pending; the background controls are queried with includeHidden.
    await ready(p, h); const releasePatch = h.hold('patch'); await rowAction(p, 'edit', 'acc_01').click(); const busyDrawer = p.page.getByTestId('pgdata-drawer'); await button(p, 'save', busyDrawer).click();
    await expect(button(p, 'cancel', busyDrawer)).toBeDisabled(); await p.page.keyboard.press('Escape'); await p.page.mouse.click(2, 2); await expect(busyDrawer).toBeVisible(); expect(writes(h)).toHaveLength(1);
    for (const key of ['insert.submit', 'pager.previous', 'pager.next']) await expect(button(p, key, p.page, { includeHidden: true })).toBeDisabled();
    releasePatch(); await expect(busyDrawer).toHaveCount(0); await expect(button(p, 'insert.submit')).toBeEnabled();
    // Preview is single-flight.
    await ready(p, h); await reveal(p, 'keys.issueAnon'); const releasePreview = h.hold('preview'); const dialog = p.page.getByTestId('pgdata-reveal'); h.reset();
    await button(p, 'keys.preview', dialog).click(); await expect(button(p, 'keys.preview', dialog)).toBeDisabled(); await button(p, 'keys.preview', dialog).click({ force: true }).catch(() => {}); expect(h.calls).toHaveLength(1);
    releasePreview(); await expect(button(p, 'keys.preview', dialog)).toBeEnabled();
  });

  test('accessibility', async ({ parity: p }) => {
    test.setTimeout(180000);
    await ready(p, h); await check.assertAccessibility(p); await assertPostgresDataLocale(p);
    // Edit drawer: axe, Escape returns focus to Editar.
    await rowAction(p, 'edit', 'acc_01').click(); await expect(p.page.getByTestId('pgdata-drawer')).toBeVisible(); await check.assertAccessibility(p); await p.page.keyboard.press('Escape'); await expect(p.page.getByTestId('pgdata-drawer')).toHaveCount(0); await expect(rowAction(p, 'edit', 'acc_01')).toBeFocused();
    // Both confirmations: the input names the text to type, Cancelar and Escape send nothing and return focus.
    h.reset();
    await rowAction(p, 'delete', 'acc_01').click(); await expect(p.page.getByTestId('pgdata-confirm').getByLabel(text(p, 'confirm.typeLabel').replace('{text}', 'acc_01'), { exact: true })).toBeVisible(); await check.assertAccessibility(p);
    await button(p, 'cancel', p.page.getByTestId('pgdata-confirm')).click(); await expect(rowAction(p, 'delete', 'acc_01')).toBeFocused();
    const revokeButton = p.page.getByRole('button', { name: text(p, 'keys.revokeAria').replace('{prefix}', 'syn_anon_01'), exact: true });
    await revokeButton.click(); await expect(p.page.getByTestId('pgdata-confirm').getByLabel(text(p, 'confirm.typeLabel').replace('{text}', 'syn_anon_01'), { exact: true })).toBeVisible(); await check.assertAccessibility(p);
    await p.page.keyboard.press('Escape'); await expect(revokeButton).toBeFocused(); expect(writes(h)).toEqual([]);
    // Reveal dialog for both key kinds: axe, focus returns to the issue button.
    for (const key of ['keys.issueAnon', 'keys.issueService']) { await reveal(p, key); await check.assertAccessibility(p); await assertPostgresDataLocale(p); await p.page.keyboard.press('Escape'); await expect(p.page.getByTestId('pgdata-reveal')).toHaveCount(0); await expect(button(p, key)).toBeFocused(); }
    // Keyboard path through the fields and filters.
    await field(p, 'fields.database').focus(); await p.page.keyboard.press('Tab'); await expect(field(p, 'fields.schema')).toBeFocused(); await p.page.keyboard.press('Tab'); await expect(field(p, 'fields.table')).toBeFocused();
    await p.page.keyboard.press('Tab'); await expect(field(p, 'filters.column')).toBeFocused();
    // Volver focuses Base de datos.
    await h.open({ errors: { rows: 404 } }); await enter(p); await button(p, 'back', p.page.getByTestId('pgdata-failure-rows')).click(); await expect(field(p, 'fields.database')).toBeFocused(); await assertPostgresDataLocale(p);
  });

  test('runtime-health', async ({ parity: p }) => {
    await h.open(); await expect(p.page.getByRole('heading', { name: text(p, 'title'), exact: true })).toBeVisible();
    // Sidebar NavLink to another page, back through the NavLink, then a deep link.
    if (width < 1024) await p.page.getByRole('button', { name: locale === 'es' ? 'Abrir navegación' : 'Open navigation', exact: true }).click();
    await p.page.getByRole('link', { name: /PostgreSQL/ }).first().click(); await expect(p.page).toHaveURL(/\/console\/postgres$/); expect(h.navigation).toEqual([`GET ${postgresPageUrl(postgresPaths.databases)}`]);
    if (width < 1024) await p.page.getByRole('button', { name: locale === 'es' ? 'Abrir navegación' : 'Open navigation', exact: true }).click();
    await p.page.getByRole('link', { name: locale === 'es' ? /Datos: Postgres/ : /Data: Postgres/ }).first().click(); await expect(p.page).toHaveURL(/\/console\/postgres\/data$/);
    await enter(p); await loaded(p);
    // Deep link: a fresh navigation straight to the route.
    await h.open(); await enter(p); await loaded(p); await check.assertRuntimeHealth(p);
  });

  test('responsive', async ({ parity: p }) => {
    await ready(p, h); await check.assertResponsive(p, width);
    // The data table scrolls inside its container.
    const scroller = await p.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth); expect(scroller).toBe(true);
    await rowAction(p, 'edit', 'acc_01').click(); await check.assertResponsive(p, width); expect((await p.page.getByTestId('pgdata-drawer').boundingBox()).width).toBeLessThanOrEqual(width); await p.page.keyboard.press('Escape');
    await rowAction(p, 'delete', 'acc_01').click(); await check.assertResponsive(p, width); expect((await p.page.getByTestId('pgdata-confirm').boundingBox()).width).toBeLessThanOrEqual(width); await p.page.keyboard.press('Escape');
    await reveal(p, 'keys.issueAnon'); await check.assertResponsive(p, width); expect((await p.page.getByTestId('pgdata-reveal').boundingBox()).width).toBeLessThanOrEqual(width);
  });

  test('visual-review', async ({ parity: p }, info) => {
    test.setTimeout(240000);
    // Settled states, in es and en at all three viewports.
    await h.open(); await expect(p.page.getByText(text(p, 'prompt'), { exact: true })).toBeVisible(); await capture(p, info, 'select-table-prompt');
    await enter(p); await loaded(p); await field(p, 'filters.column').fill('id'); await field(p, 'filters.value').fill('acc_01'); await button(p, 'filters.add').click(); await expect(rowsTable(p).getByText('acc_02', { exact: true })).toHaveCount(0); await expect(rowsTable(p).getByText('acc_01', { exact: true })).toBeVisible(); await capture(p, info, 'rows-with-filters');
    await ready(p, h); const releaseInsert = h.hold('insert'); await button(p, 'insert.submit').click(); await expect(button(p, 'insert.submit')).toBeDisabled(); await capture(p, info, 'pending-mutation'); releaseInsert(); await expect(button(p, 'insert.submit')).toBeEnabled();
    await rowAction(p, 'edit', 'acc_01').click(); await expect(p.page.getByTestId('pgdata-drawer')).toBeVisible(); await capture(p, info, 'edit-drawer'); await p.page.keyboard.press('Escape'); await expect(p.page.getByTestId('pgdata-drawer')).toHaveCount(0);
    await rowAction(p, 'delete', 'acc_01').click(); await expect(p.page.getByTestId('pgdata-confirm')).toBeVisible(); await capture(p, info, 'confirm-delete'); await p.page.keyboard.press('Escape');
    const revoke = p.page.getByRole('button', { name: text(p, 'keys.revokeAria').replace('{prefix}', 'syn_anon_01'), exact: true }); await revoke.click(); await expect(p.page.getByTestId('pgdata-confirm')).toBeVisible(); await capture(p, info, 'confirm-revoke'); await p.page.keyboard.press('Escape');
    for (const [key, name] of [['keys.issueAnon', 'reveal-anon-preview'], ['keys.issueService', 'reveal-service-preview']]) {
      const dialog = await reveal(p, key); await button(p, 'keys.preview', dialog).click(); await expect(dialog.getByRole('table', { name: text(p, 'keys.previewTable'), exact: true })).toBeVisible(); await capture(p, info, name); await p.page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
    }
    await rowAction(p, 'edit', 'acc_01').waitFor(); await p.page.getByRole('button', { name: text(p, 'keys.revokeAria').replace('{prefix}', 'syn_anon_01'), exact: true }).click(); const typed = p.page.getByTestId('pgdata-confirm'); await typed.getByLabel(text(p, 'confirm.typeLabel').replace('{text}', 'syn_anon_01'), { exact: true }).fill('syn_anon_01'); await button(p, 'keys.revokeConfirm', typed).click();
    await expect(keysTable(p).getByRole('button', { name: /./ })).toHaveCount(0); await capture(p, info, 'revoked-key');
    await h.open({ empty: ['keys'] }); await enter(p); await expect(p.page.getByText(text(p, 'keys.empty'), { exact: true })).toBeVisible(); await capture(p, info, 'empty-keys');
    await h.open({ errors: { keys: 403 } }); await enter(p); await expect(p.page.getByTestId('pgdata-failure-keys')).toBeVisible(); await capture(p, info, 'keys-no-access');
    await h.open({ errors: { rows: 404 } }); await enter(p, { schema: 'private' }); await expect(p.page.getByTestId('pgdata-failure-rows')).toBeVisible(); await capture(p, info, 'rows-not-found');
    await h.open({ errors: { rows: 500 } }); await enter(p); await expect(p.page.getByTestId('pgdata-failure-rows')).toBeVisible(); await capture(p, info, 'rows-error');
  });

  test('kit-conformance', async () => { await check.kitConformance(manifest); });
});
