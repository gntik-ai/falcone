import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import manifest, { byKeyPath, keysPath, pg, rowsPath, rowsUrl } from './console-postgres-data-page.manifest.ts';
import { installPostgresDataHarness, workspace } from './console-postgres-data-page.support.mjs';
import { assertPostgresDataLocale } from './console-postgres-data-page.locale.mjs';
const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-postgres-data-page.json`, import.meta.url), 'utf8'))]));
const c = (p) => bundles[p.locale];
const surface = (p) => p.page.getByTestId('postgres-data-page');
const button = (p, key, scope = p.page, extra = {}) => scope.getByRole('button', { name: c(p)[key], exact: true, ...extra });
const field = (p, key) => p.page.getByLabel(c(p)[key], { exact: true });
const rowsTable = (p) => p.page.getByRole('table', { name: c(p).tableLabel, exact: true });
const keysTable = (p) => p.page.getByRole('table', { name: c(p).keysTableLabel, exact: true });
const rowsGet = (h, after) => h.reads((path) => path === rowsUrl({ workspace, after }));
const url = (p, key, value) => c(p)[key].replace('{value}', value);
async function enter(p, table = 'accounts') { await field(p, 'database').fill('app_db'); await field(p, 'table').fill(table); }
async function fill(p, table = 'accounts') { await enter(p, table); await expect(rowsTable(p)).toBeVisible(); await expect(keysTable(p)).toBeVisible(); }
async function choose(p, label, option) { await p.page.getByRole('combobox', { name: label, exact: true }).click(); await p.page.getByRole('option', { name: option, exact: true }).click(); }
async function filter(p, column, value, operator) { await field(p, 'filterColumn').fill(column); if (operator) await choose(p, c(p).filterOperator, operator); await p.page.getByLabel(c(p)[operator === 'in' ? 'filterValueIn' : 'filterValue'], { exact: true }).fill(value); await button(p, 'addFilter').click(); }
const editRow = async (p) => { await button(p, 'edit', rowsTable(p)).first().click(); return p.page.getByRole('dialog', { name: c(p).editTitle.replace('{id}', 'acc-1'), exact: true }); };
const deleteRow = async (p) => { await button(p, 'delete', rowsTable(p)).first().click(); return p.page.getByRole('alertdialog'); };
const issue = async (p, key) => { await button(p, key).click(); return p.page.getByRole('dialog', { name: c(p)[key === 'issueAnon' ? 'revealTitleAnon' : 'revealTitleService'], exact: true }); };
async function capture(p, info, name) {
  await check.awaitTransitions(p.page); await assertPostgresDataLocale(p); await p.page.evaluate(() => document.fonts.ready);
  // Key values and snippets are masked: no baseline ever holds a key, even a synthetic one.
  const body = await p.page.screenshot({ animations: 'disabled', caret: 'hide', mask: [p.page.getByTestId('pgdata-secret'), p.page.getByTestId('pgdata-snippets')] });
  await info.attach(`${name}-${p.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}
for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) test.describe(`console-postgres-data-page | tenant_owner | ${locale} | ${width}`, () => {
  test.use({ role: 'tenant_owner', locale, viewport: { width, height: 900 }, pageEndpoints: {} });
  let h;
  test.beforeEach(async ({ parity, server }) => { h = await installPostgresDataHarness(parity, server); });
  test.afterEach(async ({ parity }) => { expect(h.unmatched).toEqual([]); await check.assertRuntimeHealth(parity); });
  test('data', async ({ parity: p }) => {
    await h.open(); await fill(p);
    for (const column of ['id', 'email', 'plan']) await expect(rowsTable(p).getByRole('columnheader', { name: column, exact: true })).toBeVisible();
    await expect(rowsTable(p)).toContainText('user1@example.test');
    await expect(p.page.getByRole('heading', { name: c(p).rowsTitleCount.replace('{count, number}', '60'), exact: true })).toBeVisible();
    await expect(p.page.getByRole('heading', { name: 'public.accounts', exact: true })).toBeVisible();
    await expect(keysTable(p)).toContainText('fk_anon_ab12'); await expect(keysTable(p)).toContainText('fk_svc_cd34');
    await expect(keysTable(p).getByText(c(p).keyStatuses.active, { exact: true })).toHaveCount(1); await expect(keysTable(p).getByText(c(p).keyStatuses.revoked, { exact: true })).toHaveCount(1);
    await expect(button(p, 'revokeAction', keysTable(p))).toHaveCount(1);
    await expect(keysTable(p).getByRole('row').filter({ hasText: 'fk_svc_cd34' }).getByRole('button')).toHaveCount(0);
    await assertPostgresDataLocale(p);
    await h.open({ rowsFailure: 500 }); await enter(p);
    const panel = p.page.getByTestId('pgdata-failure-rows'); await expect(panel).toBeVisible(); await expect(panel).toContainText('pg-browser-request');
    let mark = h.calls.length; h.state.recovered.rows = true; await button(p, 'retry', panel).click(); await expect(panel).toHaveCount(0); await expect(rowsTable(p)).toBeVisible();
    expect(h.calls.slice(mark).map(({ method, path }) => `${method} ${path}`)).toEqual([`GET ${rowsUrl({ workspace })}`]);
    await h.open({ keysFailure: 500 }); await enter(p);
    const keysPanel = p.page.getByTestId('pgdata-failure-keys'); await expect(keysPanel).toBeVisible(); mark = h.calls.length; h.state.recovered.keys = true; await button(p, 'retry', keysPanel).click(); await expect(keysTable(p)).toBeVisible();
    expect(h.calls.slice(mark).map(({ method, path }) => `${method} ${path}`)).toEqual([`GET ${keysPath(workspace)}`]);
  });
  test('action', async ({ parity: p }) => {
    test.setTimeout(240000);
    // Filters send column=op.value and reset the cursor; the pager sends page[size] and page[after].
    await h.open(); await fill(p); await filter(p, 'plan', 'free'); await expect(p.page.getByText('plan eq free', { exact: true })).toBeVisible();
    await filter(p, 'id', ' a , b ', 'in'); await expect(p.page.getByText('id in a,b', { exact: true })).toBeVisible();
    expect(h.calls.map(({ path }) => path)).toContain(rowsUrl({ workspace, filters: [['plan', 'eq.free'], ['id', 'in.(a,b)']] }));
    await button(p, 'removeFilter').first().click(); await button(p, 'removeFilter').first().click();
    await h.open(); await fill(p); await button(p, 'next').click(); await expect(rowsTable(p)).toContainText('user26@example.test'); await button(p, 'previous').click(); await expect(rowsTable(p)).toContainText('user1@example.test');
    expect(h.calls.filter(({ path }) => path.includes('/rows?')).map(({ path }) => path)).toEqual([rowsUrl({ workspace }), rowsUrl({ workspace, after: 'c1' }), rowsUrl({ workspace })]);
    // Returning to an earlier target starts from its first page: no stale page[after] and no restored previous-page stack.
    await h.open(); await fill(p); await button(p, 'next').click(); await expect(rowsTable(p)).toContainText('user26@example.test');
    await fill(p, 'orders'); await fill(p, 'accounts'); await expect(rowsTable(p)).toContainText('user1@example.test'); await expect(button(p, 'previous')).toBeDisabled();
    expect(rowsGet(h, 'c1')).toHaveLength(1);
    await choose(p, c(p).pageSize, '50'); await expect.poll(() => h.reads((path) => path === rowsUrl({ workspace, size: 50 })).length).toBe(1);
    // Insert: POST rows {values}, then GET rows; the form resets to {} and the new row and count 61 show.
    await h.open(); await fill(p); await field(p, 'insertLabel').fill('{"email":"new@example.test","plan":"free"}'); await button(p, 'insert').click();
    await expect(rowsTable(p)).toContainText('new@example.test'); await expect(field(p, 'insertLabel')).toHaveValue('{}'); await expect(p.page.getByRole('heading', { name: c(p).rowsTitleCount.replace('{count, number}', '61'), exact: true })).toBeVisible();
    await expect(p.page.getByText(c(p).inserted, { exact: true }).first()).toBeVisible();
    expect(h.writes().map(({ method, path, body }) => ({ method, path, body }))).toEqual([{ method: 'POST', path: rowsPath(workspace), body: { values: { email: 'new@example.test', plan: 'free' } } }]);
    // Edit: PATCH by-primary-key?id=acc-1 {changes} without id; the drawer closes, the row shows the edit. Only this scenario's write is asserted.
    await h.open(); await fill(p); let drawer = await editRow(p); await drawer.getByLabel(c(p).editLabel, { exact: true }).fill('{"id":"acc-1","email":"edited@example.test"}'); await button(p, 'save', drawer).click();
    await expect(drawer).toHaveCount(0); await expect(rowsTable(p)).toContainText('edited@example.test'); await expect(button(p, 'edit', rowsTable(p)).first()).toBeFocused();
    expect(h.writes().map(({ method, path, body }) => ({ method, path, body }))).toEqual([{ method: 'PATCH', path: `${byKeyPath(workspace)}?id=acc-1`, body: { changes: { email: 'edited@example.test' } } }]);
    // Delete: confirm-destructive, type the row id; one DELETE, then the reloaded table lacks the row and shows 59.
    await h.open(); await fill(p); let confirm = await deleteRow(p); await expect(button(p, 'deleteConfirm', confirm)).toBeDisabled(); await confirm.getByLabel(url(p, 'typeToConfirm', 'acc-1'), { exact: true }).fill('acc-1'); await button(p, 'deleteConfirm', confirm).click();
    await expect(rowsTable(p)).not.toContainText('user1@example.test'); await expect(p.page.getByRole('heading', { name: c(p).rowsTitleCount.replace('{count, number}', '59'), exact: true })).toBeVisible();
    expect(h.writes().map(({ method, path }) => ({ method, path }))).toEqual([{ method: 'DELETE', path: `${byKeyPath(workspace)}?id=acc-1` }]);
    // Issue anon and service keys: POST api-keys {keyType}; the key is revealed once, masked; Copiar copies exactly it.
    for (const [key, keyType] of [['issueAnon', 'anon'], ['issueService', 'service']]) {
      await h.open(); await fill(p); await p.page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__pgCopied = text; } } }); window.__pgCopied = undefined; });
      const reveal = await issue(p, key); await expect(reveal).toBeVisible();
      const secret = reveal.getByLabel(c(p).keyLabel, { exact: true }); await expect(secret).not.toHaveValue(pg[`pg-api-key-issue-${keyType}`].key);
      await button(p, 'copyKey', reveal).click(); expect(await p.page.evaluate(() => window.__pgCopied)).toBe(pg[`pg-api-key-issue-${keyType}`].key);
      await button(p, 'previewRun', reveal).click(); await expect(reveal.getByText('Preview row two', { exact: true })).toBeVisible();
      const preview = h.calls.find(({ apikey }) => apikey);
      expect(preview).toMatchObject({ method: 'GET', apikey: pg[`pg-api-key-issue-${keyType}`].key, authorization: undefined, path: `${rowsPath(workspace)}?page%5Bsize%5D=10` });
      for (const name of ['accept', 'contentType', 'apiVersion', 'correlation']) expect(preview[name]).toBeTruthy();
      await expect(surface(p).getByTestId('pgdata-rows').getByText('Preview row one')).toHaveCount(0);
      await button(p, 'close', reveal).click(); await expect(reveal).toHaveCount(0); await expect(button(p, key)).toBeFocused();
      expect(h.writes().filter(({ path }) => path === keysPath(workspace)).map(({ body }) => body)).toEqual([{ keyType }]);
    }
    // Revoke: confirm-destructive with the key prefix, DELETE then GET api-keys; the key shows revoked without Revocar.
    await h.open(); await fill(p); confirm = (await button(p, 'revokeAction', keysTable(p)).click(), p.page.getByRole('alertdialog'));
    await confirm.getByLabel(url(p, 'typeToConfirm', 'fk_anon_ab12'), { exact: true }).fill('fk_anon_ab12'); await button(p, 'revokeConfirm', confirm).click();
    await expect(button(p, 'revokeAction', keysTable(p))).toHaveCount(0); await expect(p.page.getByText(c(p).revoked, { exact: true }).first()).toBeVisible();
    expect(h.writes().map(({ method, path }) => ({ method, path }))).toEqual([{ method: 'DELETE', path: `${keysPath(workspace)}/key-1` }]);
  });
  test('error-empty', async ({ parity: p }) => {
    test.setTimeout(300000);
    // Workspace-required branches: none of them sends a rows or api-keys request.
    const noPageCalls = () => expect(h.calls.filter(({ path }) => !path.startsWith('/v1/workspaces') && !path.startsWith('/v1/auth'))).toEqual([]);
    await h.open({ workspaces: 'empty' }); await expect(surface(p).getByRole('link', { name: c(p).workspaceCreate })).toHaveAttribute('href', '/console/workspaces'); noPageCalls();
    await h.open({ workspaces: 'empty', role: 'tenant_viewer' }); await expect(surface(p).getByText(c(p).workspaceDenied)).toBeVisible(); noPageCalls();
    await h.open({ workspaces: 'two' }); await surface(p).getByRole('combobox', { name: c(p).workspacePicker, exact: true }).click(); await p.page.getByRole('option', { name: 'Second Workspace', exact: true }).click(); await expect(field(p, 'database')).toBeVisible(); noPageCalls();
    await h.open({ workspaces: 403 }); const gate = p.page.getByTestId('pgdata-failure-workspace'); await expect(gate).toBeVisible();
    let mark = h.calls.length; h.state.recovered.workspaces = true; await button(p, 'retry', gate).click(); await expect(gate).toHaveCount(0);
    expect(h.calls.slice(mark).filter(({ path }) => path.startsWith('/v1/workspaces')).length).toBe(1); noPageCalls();
    // The select-table prompt, then JSON and missing-key validation: none of them sends a request.
    await h.open(); await expect(surface(p).getByText(c(p).selectPrompt, { exact: true })).toBeVisible(); await field(p, 'database').fill('app_db'); await expect(surface(p).getByText(c(p).selectPrompt, { exact: true })).toBeVisible(); noPageCalls();
    await field(p, 'table').fill('accounts'); await expect(rowsTable(p)).toBeVisible(); mark = h.calls.length;
    await field(p, 'insertLabel').fill('{oops'); await button(p, 'insert').click(); await expect(p.page.getByText(c(p).newRowInvalid.replace('{error}', c(p).jsonInvalid), { exact: true })).toBeVisible(); expect(h.calls).toHaveLength(mark);
    // Skeletons while both reads are pending.
    await h.open({ slow: ['rows', 'keys'] }); await enter(p); await expect(p.page.getByTestId('pgdata-rows')).toHaveAttribute('aria-busy', 'true'); await expect(p.page.getByTestId('pgdata-keys')).toHaveAttribute('aria-busy', 'true');
    h.release('rows'); h.release('keys'); await expect(rowsTable(p)).toBeVisible();
    // Zero rows keep the insert form; an empty key list has its own state and both issue buttons stay usable.
    await h.open({ empty: ['rows', 'keys'] }); await enter(p); await expect(p.page.getByText(c(p).rowsEmpty, { exact: true })).toBeVisible(); await expect(p.page.getByText(c(p).keysEmpty, { exact: true })).toBeVisible(); await expect(field(p, 'insertLabel')).toBeVisible(); await expect(button(p, 'issueAnon')).toBeEnabled(); await expect(button(p, 'issueService')).toBeEnabled();
    // 401: one refresh then one replay; a rejected refresh redirects to /login with no replay.
    for (const refresh of ['success', 'rejected']) {
      await h.open({ rowsFailure: 401, refresh }); await enter(p);
      if (refresh === 'success') await expect(rowsTable(p)).toBeVisible(); else await expect(p.page).toHaveURL(/\/login/);
      expect(h.calls.filter(({ path }) => path.endsWith('/refresh'))).toHaveLength(1); expect(h.reads((path) => path === rowsUrl({ workspace }))).toHaveLength(refresh === 'success' ? 2 : 1);
    }
    // 403 rows: no-access in place of the table; 403 keys: no-access in the key panel with the rows kept. No request-access call.
    await h.open({ rowsFailure: 403 }); await enter(p); await expect(p.page.getByTestId('pgdata-rows').getByText(c(p).noAccess, { exact: true })).toBeVisible(); await expect(rowsTable(p)).toHaveCount(0);
    await h.open({ keysFailure: 403 }); await enter(p); await expect(p.page.getByTestId('pgdata-failure-keys').getByText(c(p).noAccess, { exact: true })).toBeVisible(); await expect(rowsTable(p)).toBeVisible(); expect(h.calls.every(({ method }) => method === 'GET')).toBe(true);
    // 404: not-found with Volver, which clears the target, resets the schema and focuses Base de datos, sending nothing.
    await h.open({ rowsFailure: 404 }); await field(p, 'schema').fill('other'); await enter(p); await expect(p.page.getByTestId('pgdata-not-found')).toBeVisible(); mark = h.calls.length; await button(p, 'back').click();
    await expect(field(p, 'database')).toHaveValue(''); await expect(field(p, 'table')).toHaveValue(''); await expect(field(p, 'schema')).toHaveValue('public'); await expect(field(p, 'database')).toBeFocused(); expect(h.calls).toHaveLength(mark);
    // 500 and network errors: an error-panel with Reintentar; rows are never shown as fresh.
    for (const failure of [500, 'network']) {
      await h.open({ rowsFailure: failure }); await enter(p); const panel = p.page.getByTestId('pgdata-failure-rows'); await expect(panel).toBeVisible(); await expect(rowsTable(p)).toHaveCount(0);
      mark = h.calls.length; h.state.recovered.rows = true; await button(p, 'retry', panel).click(); await expect(rowsTable(p)).toBeVisible(); expect(h.calls.slice(mark).filter(({ path }) => path === rowsUrl({ workspace }))).toHaveLength(1);
    }
    // A mutation 500 shows an inline callout with the server message.
    await h.open({ insert: '500' }); await fill(p); await button(p, 'insert').click(); await expect(p.page.getByTestId('pgdata-error')).toContainText('insert exploded'); await expect(button(p, 'insert')).toBeEnabled();
    // A pending insert with a filter: the mutation controls are disabled, the others stay enabled, and a target change keeps the guard.
    await h.open({ slow: ['insert'] }); await fill(p); await filter(p, 'plan', 'free'); await expect(p.page.getByText('plan eq free', { exact: true })).toBeVisible(); await button(p, 'insert').click(); await expect.poll(() => h.writes().length).toBe(1);
    await expect(button(p, 'insert')).toBeDisabled(); for (const name of ['edit', 'delete']) for (const control of await button(p, name, rowsTable(p)).all()) await expect(control).toBeDisabled();
    await expect(button(p, 'next')).toBeDisabled(); await expect(button(p, 'previous')).toBeDisabled();
    for (const key of ['addFilter', 'removeFilter', 'issueAnon', 'issueService']) await expect(button(p, key).first()).toBeEnabled();
    await expect(p.page.getByRole('combobox', { name: c(p).pageSize, exact: true })).toBeEnabled(); await expect(button(p, 'revokeAction')).toBeEnabled();
    mark = h.writes().length; await button(p, 'insert').dispatchEvent('click'); expect(h.writes()).toHaveLength(mark);
    await field(p, 'table').fill('orders'); await expect(rowsTable(p)).toBeVisible(); await expect(button(p, 'insert')).toBeDisabled(); await expect(button(p, 'edit', rowsTable(p)).first()).toBeDisabled();
    h.release('insert'); await expect(button(p, 'insert')).toBeEnabled(); await expect(button(p, 'edit', rowsTable(p)).first()).toBeEnabled();
    // A pending save: Cancelar, Escape and the drawer refuse dismissal; the hidden background controls are queried with includeHidden.
    await h.open({ slow: ['patch'] }); await fill(p); let drawer = await editRow(p); await button(p, 'save', drawer).click(); await expect.poll(() => h.writes().length).toBe(1);
    await expect(button(p, 'save', drawer)).toBeDisabled(); await expect(button(p, 'cancel', drawer)).toBeDisabled(); await p.page.keyboard.press('Escape'); await expect(drawer).toBeVisible();
    for (const key of ['insert', 'previous', 'next']) await expect(button(p, key, p.page, { includeHidden: true })).toBeDisabled();
    expect(h.writes()).toHaveLength(1); h.release('patch'); await expect(drawer).toHaveCount(0); await expect(button(p, 'insert')).toBeEnabled();
    // Idle drawer: Cancelar and Escape close it and focus returns to Editar.
    drawer = await editRow(p); await button(p, 'cancel', drawer).click(); await expect(drawer).toHaveCount(0); await expect(button(p, 'edit', rowsTable(p)).first()).toBeFocused();
    drawer = await editRow(p); await p.page.keyboard.press('Escape'); await expect(drawer).toHaveCount(0); await expect(button(p, 'edit', rowsTable(p)).first()).toBeFocused();
    // A slow preview disables its button; a second click sends nothing, and completion re-enables it.
    await h.open({ slow: ['preview'] }); await fill(p); const reveal = await issue(p, 'issueAnon'); await button(p, 'previewRun', reveal).click(); await expect(button(p, 'previewRun', reveal)).toBeDisabled();
    await button(p, 'previewRun', reveal).dispatchEvent('click'); expect(h.calls.filter(({ apikey }) => apikey)).toHaveLength(1); h.release('preview'); await expect(reveal.getByText('Preview row two', { exact: true })).toBeVisible(); await expect(button(p, 'previewRun', reveal)).toBeEnabled();
    // A rejected preview key shows an error callout and does not refresh the session.
    await h.open({ preview: '401' }); await fill(p); const failed = await issue(p, 'issueAnon'); await button(p, 'previewRun', failed).click(); await expect(failed.getByText('key rejected', { exact: true })).toBeVisible(); expect(h.calls.filter(({ path }) => path.includes('/auth/'))).toEqual([]);
  });
  test('accessibility', async ({ parity: p }) => {
    test.setTimeout(240000);
    await h.open(); await fill(p); await assertPostgresDataLocale(p); await check.assertAccessibility(p);
    // Keyboard path: fields, filters, pager, row actions, insert form, issue buttons and the key list are reachable.
    for (const control of [field(p, 'database'), field(p, 'schema'), field(p, 'table'), field(p, 'filterColumn'), button(p, 'addFilter'), button(p, 'next'), button(p, 'edit', rowsTable(p)).first(), field(p, 'insertLabel'), button(p, 'insert'), button(p, 'issueAnon'), button(p, 'issueService'), button(p, 'revokeAction', keysTable(p))]) { await control.focus(); await expect(control).toBeFocused(); }
    const drawer = await editRow(p); await expect(drawer).toBeVisible(); await check.assertAccessibility(p); await assertPostgresDataLocale(p); await p.page.keyboard.press('Escape'); await expect(button(p, 'edit', rowsTable(p)).first()).toBeFocused();
    const confirm = await deleteRow(p); await expect(confirm.getByLabel(url(p, 'typeToConfirm', 'acc-1'), { exact: true })).toBeFocused(); await check.assertAccessibility(p); await assertPostgresDataLocale(p); await p.page.keyboard.press('Escape'); await expect(confirm).toHaveCount(0); await expect(button(p, 'delete', rowsTable(p)).first()).toBeFocused();
    await button(p, 'revokeAction', keysTable(p)).click(); const revoke = p.page.getByRole('alertdialog'); await check.assertAccessibility(p); await button(p, 'cancel', revoke).click(); await expect(revoke).toHaveCount(0); await expect(button(p, 'revokeAction', keysTable(p))).toBeFocused();
    for (const key of ['issueAnon', 'issueService']) {
      const reveal = await issue(p, key); await expect(reveal).toBeVisible(); await button(p, 'previewRun', reveal).click(); await expect(reveal.getByText('Preview row two', { exact: true })).toBeVisible(); await check.assertAccessibility(p); await assertPostgresDataLocale(p);
      await button(p, 'close', reveal).click(); await expect(button(p, key)).toBeFocused(); await expect(p.page.getByText(pg[`pg-api-key-issue-${key === 'issueAnon' ? 'anon' : 'service'}`].key)).toHaveCount(0);
    }
    // Volver on a 404: empties the target, shows the prompt, sends nothing and focuses Base de datos.
    await h.open({ rowsFailure: 404 }); await enter(p); await expect(p.page.getByTestId('pgdata-not-found')).toBeVisible(); const mark = h.calls.length; await button(p, 'back').click(); await expect(field(p, 'database')).toBeFocused(); expect(h.calls).toHaveLength(mark);
    await h.open({ slow: ['patch'] }); await fill(p); const busy = await editRow(p); await button(p, 'save', busy).click(); await expect.poll(() => h.writes().length).toBe(1); await expect(button(p, 'save', busy)).toBeDisabled(); await check.assertAccessibility(p); h.release('patch');
  });
  test('runtime-health', async ({ parity: p }) => {
    // Deep link, sidebar NavLink and navigate(): none produces a console error, CSP violation, unmatched request or React #426.
    await h.open(); await fill(p);
    if (width < 1024) await p.page.getByRole('button', { name: locale === 'es' ? 'Abrir navegación' : 'Open navigation', exact: true }).click();
    await p.page.getByRole('link', { name: locale === 'es' ? 'Datos: Postgres' : 'Data: Postgres' }).click(); await expect(surface(p)).toBeVisible();
    await p.page.evaluate(() => { history.pushState({}, '', location.pathname); window.dispatchEvent(new PopStateEvent('popstate')); }); await expect(surface(p)).toBeVisible();
    await enter(p); await expect(rowsTable(p)).toBeVisible(); await check.assertRuntimeHealth(p);
  });
  test('responsive', async ({ parity: p }) => {
    await h.open(); await fill(p); await check.assertResponsive(p, width);
    const inside = async (locator) => { const box = await locator.boundingBox(); expect(box.width).toBeLessThanOrEqual(width); };
    const drawer = await editRow(p); await check.assertResponsive(p, width); await inside(drawer); await button(p, 'cancel', drawer).click();
    const confirm = await deleteRow(p); await check.assertResponsive(p, width); await inside(confirm); await button(p, 'cancel', confirm).click();
    const reveal = await issue(p, 'issueAnon'); await button(p, 'previewRun', reveal).click(); await expect(reveal.getByText('Preview row two', { exact: true })).toBeVisible(); await check.assertResponsive(p, width); await inside(reveal);
  });
  test('visual-review', async ({ parity: p }, info) => {
    test.setTimeout(300000);
    // Settled states: the select-table prompt, rows with filters, a pending mutation, the edit drawer, both reveals after a preview, the revoked key.
    await h.open(); await expect(surface(p).getByText(c(p).selectPrompt, { exact: true })).toBeVisible(); await capture(p, info, 'select-table');
    await fill(p); await filter(p, 'plan', 'free'); await expect(p.page.getByText('plan eq free', { exact: true })).toBeVisible(); await capture(p, info, 'rows-filters');
    await h.open({ slow: ['insert'] }); await fill(p); await button(p, 'insert').click(); await expect(button(p, 'insert')).toBeDisabled(); await capture(p, info, 'pending-mutation'); h.release('insert');
    await h.open(); await fill(p); let drawer = await editRow(p); await expect(drawer).toBeVisible(); await capture(p, info, 'edit-drawer'); await button(p, 'cancel', drawer).click();
    let confirm = await deleteRow(p); await capture(p, info, 'delete-confirm'); await button(p, 'cancel', confirm).click();
    await button(p, 'revokeAction', keysTable(p)).click(); confirm = p.page.getByRole('alertdialog'); await capture(p, info, 'revoke-confirm'); await button(p, 'cancel', confirm).click();
    for (const [key, name] of [['issueAnon', 'reveal-anon'], ['issueService', 'reveal-service']]) { const reveal = await issue(p, key); await button(p, 'previewRun', reveal).click(); await expect(reveal.getByText('Preview row two', { exact: true })).toBeVisible(); await capture(p, info, name); await button(p, 'close', reveal).click(); }
    await h.open(); await fill(p); confirm = (await button(p, 'revokeAction', keysTable(p)).click(), p.page.getByRole('alertdialog')); await confirm.getByLabel(url(p, 'typeToConfirm', 'fk_anon_ab12'), { exact: true }).fill('fk_anon_ab12'); await button(p, 'revokeConfirm', confirm).click(); await expect(button(p, 'revokeAction', keysTable(p))).toHaveCount(0); await capture(p, info, 'revoked-key');
    await h.open({ empty: ['keys'] }); await enter(p); await expect(p.page.getByText(c(p).keysEmpty, { exact: true })).toBeVisible(); await capture(p, info, 'keys-empty');
    await h.open({ keysFailure: 403 }); await enter(p); await expect(p.page.getByTestId('pgdata-failure-keys')).toBeVisible(); await capture(p, info, 'keys-no-access');
    await h.open({ rowsFailure: 404 }); await enter(p); await expect(p.page.getByTestId('pgdata-not-found')).toBeVisible(); await capture(p, info, 'rows-not-found');
    await h.open({ rowsFailure: 500 }); await enter(p); await expect(p.page.getByTestId('pgdata-failure-rows')).toBeVisible(); await capture(p, info, 'rows-error');
  });
  test('kit-conformance', async () => { await check.kitConformance(manifest); });
});
