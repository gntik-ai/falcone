import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import manifest, { synthetic } from './console-mongo-data-page.manifest.ts';
import { installMongoDataHarness } from './console-mongo-data-page.support.mjs';
import { assertMongoDataLocale } from './console-mongo-data-page.locale.mjs';

const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-mongo-data-page.json`, import.meta.url), 'utf8'))]));
const copy = (p) => bundles[p.locale];
const text = (p, key) => key.split('.').reduce((value, part) => value?.[part], copy(p));
const button = (p, key, scope = p.page, options = {}) => scope.getByRole('button', { name: text(p, key), exact: true, ...options });
const rowAction = (p, kind, id) => p.page.getByRole('button', { name: text(p, `documents.${kind}Aria`).replace('{id}', id), exact: true });
const writes = (h) => h.calls.filter(({ method, path }) => method !== 'GET' && !path.endsWith('/refresh'));
const docsTable = (p) => p.page.getByRole('table', { name: text(p, 'documents.tableLabel'), exact: true });
const field = (p, key) => p.page.getByLabel(text(p, key), { exact: true });
const typedLabel = (p, id) => text(p, 'confirm.typeLabel').replace('{text}', id);
const cell = (p, id) => docsTable(p).getByText(new RegExp(id)).first();
// An open modal hides the table from role queries, so the row behind the dialog is found through its region.
const cellBehind = (p, id) => p.page.getByTestId('mongodata-documents').getByText(new RegExp(id)).first();
const urlPaths = (h) => h.calls.map(({ method, path }) => `${method} ${path}`);
async function enter(p, { database = 'catalog', collection = 'orders' } = {}) {
  await field(p, 'fields.database').fill(database); await field(p, 'fields.collection').fill(collection);
}
async function loaded(p) { await expect(cell(p, 'ord_01')).toBeVisible(); }
async function ready(p, h, patch = {}) { await h.open(patch); await enter(p); await loaded(p); }
const reveal = async (p) => { await button(p, 'keys.issueAnon').click(); const dialog = p.page.getByTestId('mongodata-reveal'); await expect(dialog).toBeVisible(); return dialog; };
const insideConfirm = (p) => p.page.evaluate(() => document.querySelector('[data-testid="mongodata-confirm"]')?.contains(document.activeElement) ?? false);
// Masks the issued key and both snippets, which contain it; baselines never hold a credential.
const masks = (p) => [p.page.getByTestId('mongodata-issued-key'), p.page.getByTestId('mongodata-reveal').getByRole('group', { name: text(p, 'keys.integration') })];
// The screenshot is viewport-only, so the state's own element is scrolled into view and asserted to intersect the viewport first.
async function capture(p, info, name, target) {
  await target.scrollIntoViewIfNeeded(); await expect(target).toBeInViewport();
  await assertMongoDataLocale(p); await p.page.evaluate(() => document.fonts.ready);
  const body = await p.page.screenshot({ animations: 'disabled', caret: 'hide', mask: masks(p) });
  await info.attach(`${name}-${p.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}
async function typeAndDelete(p, id) {
  await rowAction(p, 'delete', id).click(); const dialog = p.page.getByTestId('mongodata-confirm');
  await dialog.getByLabel(typedLabel(p, id), { exact: true }).fill(id); await button(p, 'deleteConfirm.confirm', dialog).click(); return dialog;
}

for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) test.describe(`console-mongo-data-page | tenant_owner | ${locale} | ${width}`, () => {
  test.use({ role: 'tenant_owner', locale, viewport: { width, height: 900 }, pageEndpoints: {} });
  let h;
  test.beforeEach(async ({ parity, server }) => { h = await installMongoDataHarness(parity, server); });
  test.afterEach(async ({ parity }) => { expect(h.unmatched).toEqual([]); await check.assertRuntimeHealth(parity); });

  test('data', async ({ parity: p }) => {
    test.setTimeout(180000);
    await ready(p, h);
    await expect(p.page.getByRole('heading', { name: text(p, 'documents.titleCount').replace('{count}', '3'), exact: true })).toBeVisible();
    for (const id of ['ord_01', 'ord_02', 'ord_03']) await expect(cell(p, id)).toBeVisible();
    await expect(docsTable(p).getByRole('button', { name: /./ })).toHaveCount(6);
    await expect(p.page.getByRole('heading', { name: 'catalog.orders', exact: true })).toBeVisible();
    await assertMongoDataLocale(p);
    expect(urlPaths(h)).toEqual([`GET ${h.urls.docs()}`]);
    // Siguiente sends page[after]; Anterior returns to the first page.
    h.reset(); await button(p, 'pager.next').click(); await expect(cell(p, 'ord_04')).toBeVisible(); expect(urlPaths(h)).toEqual([`GET ${h.urls.docs({ after: 'c1' })}`]);
    await expect(button(p, 'pager.next')).toBeDisabled(); await button(p, 'pager.previous').click(); await loaded(p); await expect(button(p, 'pager.previous')).toBeDisabled();
    // From page 2: the filter, Limpiar, the page size and the collection each drop page[after].
    await button(p, 'pager.next').click(); await expect(cell(p, 'ord_04')).toBeVisible();
    h.reset(); await field(p, 'filter.label').fill('{"status":"paid"}'); await button(p, 'filter.apply').click(); await expect(cell(p, 'ord_02')).toBeVisible(); await expect(docsTable(p).getByText(/ord_04/)).toHaveCount(0);
    expect(urlPaths(h)).toEqual([`GET ${h.urls.docs({ filter: { status: 'paid' } })}`]);
    h.reset(); await button(p, 'filter.clear').click(); await expect(cell(p, 'ord_03')).toBeVisible(); await expect(field(p, 'filter.label')).toHaveValue('{}'); expect(urlPaths(h)).toEqual([`GET ${h.urls.docs()}`]);
    await button(p, 'pager.next').click(); await expect(cell(p, 'ord_04')).toBeVisible();
    h.reset(); await p.page.getByRole('combobox', { name: text(p, 'pager.size'), exact: true }).click(); await p.page.getByRole('option', { name: '50', exact: true }).click(); await expect(cell(p, 'ord_03')).toBeVisible();
    expect(urlPaths(h)).toEqual([`GET ${h.urls.docs({ size: 50 })}`]); await expect(button(p, 'pager.previous')).toBeDisabled();
    h.reset(); await field(p, 'fields.collection').fill('refunds'); await expect(cell(p, 'ref_1')).toBeVisible();
    expect(h.calls.every(({ path }) => path.includes('/refunds/') && !path.includes('page%5Bafter%5D'))).toBe(true); expect(h.calls.length).toBeGreaterThan(0);
  });

  test('action', async ({ parity: p }) => {
    test.setTimeout(180000);
    await ready(p, h);
    // Insert: POST {document} then GET, the form resets, four documents and the toast.
    h.reset(); await field(p, 'insert.label').fill('{"status":"new"}'); await button(p, 'insert.submit').click();
    await expect(cell(p, 'ord_07')).toBeVisible(); await expect(p.page.getByRole('heading', { name: text(p, 'documents.titleCount').replace('{count}', '4'), exact: true })).toBeVisible();
    await expect(field(p, 'insert.label')).toHaveValue('{}'); await expect(p.page.getByText(text(p, 'inserted'), { exact: true }).first()).toBeVisible();
    expect(writes(h)).toEqual([expect.objectContaining({ method: 'POST', path: h.paths.docs, body: { document: { status: 'new' } } })]);
    // Edit: PATCH {update} without _id, drawer closes, document updated, focus back on Editar.
    h.reset(); await rowAction(p, 'edit', 'ord_01').click(); const drawer = p.page.getByTestId('mongodata-drawer'); await expect(drawer).toBeVisible();
    await drawer.getByLabel(text(p, 'editDrawer.label'), { exact: true }).fill(JSON.stringify({ _id: 'ord_01', status: 'shipped' })); await button(p, 'save', drawer).click();
    await expect(drawer).toHaveCount(0); await expect(docsTable(p).getByText(/shipped/).first()).toBeVisible(); await expect(p.page.getByText(text(p, 'updated'), { exact: true }).first()).toBeVisible();
    expect(writes(h)).toEqual([expect.objectContaining({ method: 'PATCH', path: h.paths.doc, body: { update: { status: 'shipped' } } })]);
    await expect(rowAction(p, 'edit', 'ord_01')).toBeFocused();
    // Delete: a partial id keeps confirm disabled, Cancelar sends nothing, the exact id sends one DELETE and reloads.
    h.reset(); await rowAction(p, 'delete', 'ord_01').click(); const confirm = p.page.getByTestId('mongodata-confirm'); await expect(button(p, 'deleteConfirm.confirm', confirm)).toBeDisabled();
    await expect(confirm.getByLabel(typedLabel(p, 'ord_01'), { exact: true })).toBeFocused();
    await confirm.getByLabel(typedLabel(p, 'ord_01'), { exact: true }).fill('ord_0'); await expect(button(p, 'deleteConfirm.confirm', confirm)).toBeDisabled();
    await button(p, 'cancel', confirm).click(); await expect(confirm).toHaveCount(0); expect(writes(h)).toEqual([]); await expect(rowAction(p, 'delete', 'ord_01')).toBeFocused();
    const deleting = await typeAndDelete(p, 'ord_01'); await expect(deleting).toHaveCount(0); await expect(docsTable(p).getByText(/ord_01/)).toHaveCount(0);
    expect(writes(h)).toEqual([expect.objectContaining({ method: 'DELETE', path: h.paths.doc })]); expect(urlPaths(h).at(-1)).toBe(`GET ${h.urls.docs()}`);
    await expect(p.page.getByText(text(p, 'deleted'), { exact: true }).first()).toBeVisible();
    // Issue the anonymous key: POST {keyType:'anon'}, masked reveal once, exact copy, preview with only the apikey header.
    await p.page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value) => { window.__mongoDataCopied = value; } } }); });
    h.reset(); const dialog = await reveal(p);
    expect(h.calls).toEqual([expect.objectContaining({ method: 'POST', path: h.paths.keys, body: { keyType: 'anon' } })]);
    await expect(p.page.getByTestId('mongodata-issued-key')).toHaveAttribute('data-masked', 'true'); await expect(dialog.getByText(text(p, 'keys.onceTitle'), { exact: true })).toBeVisible();
    await button(p, 'keys.copy', dialog).click(); expect(await p.page.evaluate(() => window.__mongoDataCopied)).toBe(synthetic.anon);
    // Each snippet has its own copy control and copies the snippet text, which embeds the synthetic key.
    for (const kind of ['fetch', 'curl']) { await dialog.getByTestId(`mongodata-copy-${kind}`).click(); await expect(dialog.getByTestId(`mongodata-copy-${kind}`)).toHaveText(text(p, 'keys.snippetCopied')); const snippet = await p.page.evaluate(() => window.__mongoDataCopied); expect(snippet).toContain(synthetic.anon); expect(snippet).toContain('/collections/orders/documents'); }
    h.reset(); await button(p, 'keys.preview', dialog).click(); await expect(dialog.getByTestId('mongodata-preview')).toBeVisible();
    expect(h.calls).toEqual([expect.objectContaining({ method: 'GET', path: h.urls.preview, apikey: synthetic.anon, authorization: undefined })]);
    await button(p, 'close', dialog).click(); await expect(dialog).toHaveCount(0); await expect(button(p, 'keys.issueAnon')).toBeFocused();
    // The page never sends Postgres, import, export, PUT or api-key list, delete or rotation requests.
    expect(h.unmatched).toEqual([]);
  });

  test('error-empty', async ({ parity: p }) => {
    test.setTimeout(300000);
    // Workspace required: loading, error with retry, picker, create link or denial. No /v1 data request in any branch.
    for (const patch of [{ noWorkspace: 'empty' }, { noWorkspace: 'empty', role: 'tenant_viewer' }, { noWorkspace: 'two' }]) {
      await h.open(patch); await expect(p.page.getByText(text(p, 'workspace.description'), { exact: true })).toBeVisible(); expect(h.calls).toEqual([]);
      if (patch.noWorkspace === 'two') await expect(p.page.getByRole('combobox', { name: text(p, 'workspace.picker'), exact: true })).toBeVisible();
      else if (patch.role) await expect(p.page.getByText(text(p, 'workspace.denied'), { exact: true })).toBeVisible();
      else await expect(p.page.getByRole('link', { name: text(p, 'workspace.create'), exact: true })).toHaveAttribute('href', '/console/workspaces');
    }
    for (const status of [403, 500]) { await h.open({ errors: { workspaces: status } }); await expect(p.page.getByTestId('mongodata-failure-workspace')).toBeVisible(); await expect(button(p, 'retry', p.page.getByTestId('mongodata-failure-workspace'))).toBeVisible(); expect(h.calls).toEqual([]); }
    // Start prompt and the validations that send no request.
    await h.open(); await expect(p.page.getByText(text(p, 'prompt'), { exact: true })).toBeVisible(); await field(p, 'fields.database').fill('catalog'); await expect(p.page.getByText(text(p, 'prompt'), { exact: true })).toBeVisible(); expect(h.calls).toEqual([]);
    // Skeleton while the list is pending.
    await h.open(); const releaseDocs = h.hold('docs'); await enter(p);
    await expect(p.page.getByTestId('mongodata-documents')).toHaveAttribute('aria-busy', 'true'); releaseDocs(); await loaded(p); await expect(p.page.getByTestId('mongodata-documents')).toHaveAttribute('aria-busy', 'false');
    // Zero documents keep the insert form; a filter with no match offers Limpiar.
    await h.open({ empty: true }); await enter(p); await expect(p.page.getByText(text(p, 'documents.empty'), { exact: true })).toBeVisible(); await expect(field(p, 'insert.label')).toBeVisible(); await expect(button(p, 'keys.issueAnon')).toBeEnabled();
    await field(p, 'filter.label').fill('{"status":"none"}'); await button(p, 'filter.apply').click(); await expect(p.page.getByText(text(p, 'documents.noResults'), { exact: true })).toBeVisible();
    await button(p, 'filter.clear', p.page.getByTestId('mongodata-documents')).click(); await expect(p.page.getByText(text(p, 'documents.empty'), { exact: true })).toBeVisible(); await expect(field(p, 'filter.label')).toHaveValue('{}');
    // JSON validations and a missing id send no request.
    await ready(p, h); h.reset(); await field(p, 'filter.label').fill('{nope'); await button(p, 'filter.apply').click(); await expect(p.page.getByText(text(p, 'filterError').replace('{reason}', text(p, 'jsonInvalid')), { exact: true }).first()).toBeVisible();
    await field(p, 'insert.label').fill('{nope'); await button(p, 'insert.submit').click(); await expect(p.page.getByText(text(p, 'newDocError').replace('{reason}', text(p, 'jsonInvalid')), { exact: true }).first()).toBeVisible();
    await field(p, 'insert.label').fill('[1]'); await button(p, 'insert.submit').click(); await expect(p.page.getByText(text(p, 'newDocError').replace('{reason}', text(p, 'jsonObjectExpected')), { exact: true }).first()).toBeVisible(); expect(h.calls).toEqual([]);
    await rowAction(p, 'edit', 'ord_01').click(); const drawer = p.page.getByTestId('mongodata-drawer'); await drawer.getByLabel(text(p, 'editDrawer.label'), { exact: true }).fill('{nope'); await button(p, 'save', drawer).click();
    await expect(drawer.getByText(text(p, 'editDocError').replace('{reason}', text(p, 'jsonInvalid')), { exact: true })).toBeVisible(); expect(h.calls).toEqual([]); await button(p, 'cancel', drawer).click();
    await h.open({ noId: true }); await enter(p); await expect(docsTable(p).getByText(/orphan/).first()).toBeVisible();
    await p.page.getByRole('button', { name: text(p, 'documents.editAria').replace(' {id}', ''), exact: false }).first().click(); await expect(p.page.getByText(text(p, 'missingIdEdit'), { exact: true }).first()).toBeVisible();
    await p.page.getByRole('button', { name: text(p, 'documents.deleteAria').replace(' {id}', ''), exact: false }).first().click(); await expect(p.page.getByText(text(p, 'missingIdDelete'), { exact: true }).first()).toBeVisible(); expect(writes(h)).toEqual([]); await expect(p.page.getByTestId('mongodata-confirm')).toHaveCount(0);
    // List failures: 401 (refresh ok and rejected), 403, 404 with Volver, 500 with request id and retry, network.
    for (const refresh of ['success', 'rejected']) {
      await h.open({ errors: { docs: 401 }, refresh }); await enter(p);
      if (refresh === 'success') await loaded(p); else await expect(p.page).toHaveURL(/\/login$/);
      expect(h.calls.filter(({ path }) => path.endsWith('/refresh'))).toHaveLength(1); expect(h.calls.filter(({ path }) => path === h.urls.docs())).toHaveLength(refresh === 'success' ? 2 : 1);
    }
    await h.open({ errors: { docs: 403 } }); await enter(p); await expect(p.page.getByTestId('mongodata-failure-documents').getByText(text(p, 'noAccess'), { exact: true })).toBeVisible(); expect(writes(h)).toEqual([]);
    await h.open({ errors: { docs: 404 } }); await enter(p, { collection: 'missing' }); const missing = p.page.getByTestId('mongodata-failure-documents'); await expect(missing.getByText(text(p, 'notFound'), { exact: true })).toBeVisible();
    h.reset(); await button(p, 'back', missing).click(); await expect(p.page.getByText(text(p, 'prompt'), { exact: true })).toBeVisible();
    await expect(field(p, 'fields.database')).toHaveValue(''); await expect(field(p, 'fields.collection')).toHaveValue(''); await expect(field(p, 'fields.database')).toBeFocused(); expect(h.calls).toEqual([]);
    for (const failure of [500, 'network']) {
      await h.open({ errors: { docs: failure }, recoverAfterFailure: ['docs'] }); await enter(p); const panel = p.page.getByTestId('mongodata-failure-documents'); await expect(panel).toBeVisible();
      if (failure === 500) await expect(panel).toContainText('mongo-browser-request');
      await expect(docsTable(p)).toHaveCount(0);
      h.reset(); await button(p, 'retry', panel).click(); await expect(panel).toHaveCount(0); await loaded(p); expect(h.calls.map(({ path }) => path)).toEqual([h.urls.docs()]);
    }
    // insert-500: the error shows in Insertar documento, the typed JSON stays and a retry sends one POST.
    await ready(p, h, { errors: { insert: 500 }, recoverAfterFailure: ['insert'] }); h.reset(); await field(p, 'insert.label').fill('{"status":"new"}'); await button(p, 'insert.submit').click();
    await expect(p.page.getByText('synthetic insert failure', { exact: true }).first()).toBeVisible(); await expect(field(p, 'insert.label')).toHaveValue('{"status":"new"}'); await expect(docsTable(p).getByText(/ord_07/)).toHaveCount(0);
    h.reset(); await button(p, 'insert.submit').click(); await expect(cell(p, 'ord_07')).toBeVisible(); await expect(field(p, 'insert.label')).toHaveValue('{}'); expect(writes(h)).toHaveLength(1);
    // update-500: the drawer stays open with the edited JSON; Guardar again sends one PATCH.
    await ready(p, h, { errors: { update: 500 }, recoverAfterFailure: ['update'] }); await rowAction(p, 'edit', 'ord_01').click(); const failing = p.page.getByTestId('mongodata-drawer');
    await failing.getByLabel(text(p, 'editDrawer.label'), { exact: true }).fill('{"status":"shipped"}'); h.reset(); await button(p, 'save', failing).click();
    await expect(failing.getByText('synthetic update failure', { exact: true })).toBeVisible(); await expect(failing.getByLabel(text(p, 'editDrawer.label'), { exact: true })).toHaveValue('{"status":"shipped"}');
    h.reset(); await button(p, 'save', failing).click(); await expect(failing).toHaveCount(0); expect(writes(h)).toEqual([expect.objectContaining({ method: 'PATCH', body: { update: { status: 'shipped' } } })]);
    // delete-500: the confirmation stays open with the error and request id, the typed id and the row; confirming again sends one DELETE.
    await ready(p, h, { errors: { delete: 500 }, recoverAfterFailure: ['delete'] }); h.reset(); const failed = await typeAndDelete(p, 'ord_01');
    await expect(failed.getByTestId('mongodata-confirm-error')).toBeVisible(); await expect(failed.getByTestId('mongodata-confirm-error')).toContainText('mongo-browser-request');
    await expect(failed.getByLabel(typedLabel(p, 'ord_01'), { exact: true })).toHaveValue('ord_01'); await expect(cellBehind(p, 'ord_01')).toBeVisible();
    h.reset(); await button(p, 'deleteConfirm.confirm', failed).click(); await expect(failed).toHaveCount(0); await expect(docsTable(p).getByText(/ord_01/)).toHaveCount(0); expect(writes(h)).toHaveLength(1);
    // Busy guard: a pending insert disables the write controls; filter, page size and the key button stay enabled.
    await ready(p, h); const releaseInsert = h.hold('insert'); await button(p, 'insert.submit').click(); await expect(button(p, 'insert.submit')).toBeDisabled(); await expect(rowAction(p, 'edit', 'ord_01')).toBeDisabled(); await expect(rowAction(p, 'delete', 'ord_01')).toBeDisabled();
    await expect(p.page.getByRole('combobox', { name: text(p, 'pager.size'), exact: true })).toBeEnabled(); await expect(button(p, 'filter.apply')).toBeEnabled(); await expect(button(p, 'keys.issueAnon')).toBeEnabled();
    releaseInsert(); await expect(button(p, 'insert.submit')).toBeEnabled();
    // Preview 401 is a local error: no refresh, no replay, no logout.
    await ready(p, h, { errors: { preview: 401 }, refresh: 'success' }); const dialog = await reveal(p); h.reset(); await button(p, 'keys.preview', dialog).click();
    await expect(dialog.getByTestId('mongodata-preview-error')).toBeVisible(); expect(h.calls.filter(({ path }) => path.endsWith('/refresh'))).toEqual([]); expect(h.calls.filter(({ path }) => path === h.urls.preview)).toHaveLength(1); await expect(p.page).toHaveURL(/\/console\/mongo\/data$/);
  });

  test('accessibility', async ({ parity: p }) => {
    test.setTimeout(240000);
    await ready(p, h); await check.assertAccessibility(p); await assertMongoDataLocale(p);
    // Edit drawer: axe, Escape returns focus to Editar.
    await rowAction(p, 'edit', 'ord_01').click(); await expect(p.page.getByTestId('mongodata-drawer')).toBeVisible(); await check.assertAccessibility(p); await p.page.keyboard.press('Escape'); await expect(p.page.getByTestId('mongodata-drawer')).toHaveCount(0); await expect(rowAction(p, 'edit', 'ord_01')).toBeFocused();
    // Confirmation: focus lands on the typed-id field; Cancelar and Escape send nothing and return focus to that row's Eliminar.
    h.reset(); await rowAction(p, 'delete', 'ord_01').click(); const confirm = p.page.getByTestId('mongodata-confirm'); await expect(confirm.getByLabel(typedLabel(p, 'ord_01'), { exact: true })).toBeFocused(); await check.assertAccessibility(p);
    await button(p, 'cancel', confirm).click(); await expect(rowAction(p, 'delete', 'ord_01')).toBeFocused();
    await rowAction(p, 'delete', 'ord_02').click(); await p.page.keyboard.press('Escape'); await expect(rowAction(p, 'delete', 'ord_02')).toBeFocused(); expect(writes(h)).toEqual([]);
    // Reveal dialog: axe, focus returns to the issue button.
    await reveal(p); await check.assertAccessibility(p); await assertMongoDataLocale(p); await p.page.keyboard.press('Escape'); await expect(p.page.getByTestId('mongodata-reveal')).toHaveCount(0); await expect(button(p, 'keys.issueAnon')).toBeFocused();
    // Keyboard path through the fields and the filter.
    await field(p, 'fields.database').focus(); await p.page.keyboard.press('Tab'); await expect(field(p, 'fields.collection')).toBeFocused(); await p.page.keyboard.press('Tab'); await expect(field(p, 'filter.label')).toBeFocused();
    await p.page.keyboard.press('Tab'); await expect(button(p, 'filter.apply')).toBeFocused(); await p.page.keyboard.press('Tab'); await expect(button(p, 'filter.clear')).toBeFocused();
    // delete-500: the dialog stays open, the error is announced assertively, focus stays inside and Tab cycles only within it; Escape returns focus to Eliminar.
    // The kit's focus trap hands focus from its guard span back into the dialog in an animation frame, so each Tab waits for focus to settle inside.
    await ready(p, h, { errors: { delete: 500 }, recoverAfterFailure: ['delete'] }); const failed = await typeAndDelete(p, 'ord_01');
    await expect(failed.getByTestId('mongodata-confirm-error')).toBeVisible(); await expect(p.page.locator('[aria-live="assertive"]').filter({ hasText: text(p, 'deleteConfirm.failedTitle') }).first()).toBeAttached(); await expect.poll(() => insideConfirm(p)).toBe(true);
    for (let step = 0; step < 8; step++) { await p.page.keyboard.press('Tab'); await expect.poll(() => insideConfirm(p), { timeout: 2000 }).toBe(true); }
    for (let step = 0; step < 8; step++) { await p.page.keyboard.press('Shift+Tab'); await expect.poll(() => insideConfirm(p), { timeout: 2000 }).toBe(true); }
    await check.assertAccessibility(p); await p.page.keyboard.press('Escape'); await expect(failed).toHaveCount(0); await expect(rowAction(p, 'delete', 'ord_01')).toBeFocused();
    // Retry after the failure: the failure was consumed above, so reload with a fresh failing scenario. Focus moves to the Eliminar of the row now at that position.
    await ready(p, h, { errors: { delete: 500 }, recoverAfterFailure: ['delete'] }); await typeAndDelete(p, 'ord_01'); await expect(p.page.getByTestId('mongodata-confirm-error')).toBeVisible(); await button(p, 'deleteConfirm.confirm', p.page.getByTestId('mongodata-confirm')).click();
    await expect(p.page.getByTestId('mongodata-confirm')).toHaveCount(0); await expect(rowAction(p, 'delete', 'ord_02')).toBeFocused();
    // insert-500 keeps focus on Insertar; update-500 keeps it on Guardar.
    await ready(p, h, { errors: { insert: 500, update: 500 } }); await button(p, 'insert.submit').click(); await expect(p.page.getByText('synthetic insert failure', { exact: true }).first()).toBeVisible(); await expect(button(p, 'insert.submit')).toBeFocused();
    await rowAction(p, 'edit', 'ord_01').click(); const drawer = p.page.getByTestId('mongodata-drawer'); await button(p, 'save', drawer).click(); await expect(drawer.getByText('synthetic update failure', { exact: true })).toBeVisible(); await expect(button(p, 'save', drawer)).toBeFocused(); await check.assertAccessibility(p);
    await button(p, 'cancel', drawer).click(); await expect(rowAction(p, 'edit', 'ord_01')).toBeFocused();
    // Volver focuses Base de datos.
    await h.open({ errors: { docs: 404 } }); await enter(p, { collection: 'missing' }); await button(p, 'back', p.page.getByTestId('mongodata-failure-documents')).click(); await expect(field(p, 'fields.database')).toBeFocused(); await assertMongoDataLocale(p);
  });

  test('runtime-health', async ({ parity: p }) => {
    test.setTimeout(180000);
    await h.open(); await expect(p.page.getByRole('heading', { name: text(p, 'title'), exact: true })).toBeVisible();
    // Sidebar NavLink to another page, back through the NavLink, then a deep link.
    if (width < 1024) await p.page.getByRole('button', { name: locale === 'es' ? 'Abrir navegación' : 'Open navigation', exact: true }).click();
    await p.page.getByRole('link', { name: 'MongoDB', exact: true }).first().click(); await expect(p.page).toHaveURL(/\/console\/mongo$/);
    if (width < 1024) await p.page.getByRole('button', { name: locale === 'es' ? 'Abrir navegación' : 'Open navigation', exact: true }).click();
    await p.page.getByRole('link', { name: locale === 'es' ? /Datos: Mongo/ : /Data: Mongo/ }).first().click(); await expect(p.page).toHaveURL(/\/console\/mongo\/data$/);
    await enter(p); await loaded(p);
    // Failed and retried writes leave the console clean.
    await ready(p, h, { errors: { insert: 500, update: 500, delete: 500 }, recoverAfterFailure: ['insert', 'update', 'delete'] });
    await button(p, 'insert.submit').click(); await expect(p.page.getByText('synthetic insert failure', { exact: true }).first()).toBeVisible(); await button(p, 'insert.submit').click(); await expect(cell(p, 'ord_07')).toBeVisible();
    await rowAction(p, 'edit', 'ord_01').click(); const drawer = p.page.getByTestId('mongodata-drawer'); await button(p, 'save', drawer).click(); await expect(drawer.getByText('synthetic update failure', { exact: true })).toBeVisible(); await button(p, 'save', drawer).click(); await expect(drawer).toHaveCount(0);
    const failed = await typeAndDelete(p, 'ord_01'); await expect(failed.getByTestId('mongodata-confirm-error')).toBeVisible(); await button(p, 'deleteConfirm.confirm', failed).click(); await expect(failed).toHaveCount(0);
    // Deep link: a fresh navigation straight to the route.
    await h.open(); await enter(p); await loaded(p); await check.assertRuntimeHealth(p);
  });

  test('responsive', async ({ parity: p }) => {
    test.setTimeout(180000);
    await ready(p, h); await check.assertResponsive(p, width);
    // Long documents wrap or scroll inside their cell. Dialog widths get 1px of tolerance for sub-pixel layout.
    expect(await p.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (width < 640) { const [db, collection] = await Promise.all([field(p, 'fields.database').boundingBox(), field(p, 'fields.collection').boundingBox()]); expect(collection.y).toBeGreaterThan(db.y); }
    await rowAction(p, 'edit', 'ord_01').click(); await check.assertResponsive(p, width); expect((await p.page.getByTestId('mongodata-drawer').boundingBox()).width).toBeLessThanOrEqual(width + 1); await p.page.keyboard.press('Escape');
    await ready(p, h, { errors: { update: 500 } }); await rowAction(p, 'edit', 'ord_01').click(); await button(p, 'save', p.page.getByTestId('mongodata-drawer')).click(); await expect(p.page.getByTestId('mongodata-drawer').getByText('synthetic update failure', { exact: true })).toBeVisible();
    await check.assertResponsive(p, width); expect((await p.page.getByTestId('mongodata-drawer').boundingBox()).width).toBeLessThanOrEqual(width + 1); await p.page.keyboard.press('Escape');
    await ready(p, h, { errors: { delete: 500 } }); await typeAndDelete(p, 'ord_01'); await expect(p.page.getByTestId('mongodata-confirm-error')).toBeVisible(); await check.assertResponsive(p, width); expect((await p.page.getByTestId('mongodata-confirm').boundingBox()).width).toBeLessThanOrEqual(width + 1); await p.page.keyboard.press('Escape');
  });

  test('visual-review', async ({ parity: p }, info) => {
    test.setTimeout(300000);
    // Settled states, in es and en at all three viewports.
    await h.open(); await expect(p.page.getByText(text(p, 'prompt'), { exact: true })).toBeVisible(); await capture(p, info, 'start-prompt', p.page.getByText(text(p, 'prompt'), { exact: true }));
    await enter(p); await loaded(p); await capture(p, info, 'populated-list', docsTable(p));
    await rowAction(p, 'edit', 'ord_01').click(); await expect(p.page.getByTestId('mongodata-drawer')).toBeVisible(); await capture(p, info, 'edit-drawer', p.page.getByTestId('mongodata-drawer')); await p.page.keyboard.press('Escape'); await expect(p.page.getByTestId('mongodata-drawer')).toHaveCount(0);
    await rowAction(p, 'delete', 'ord_01').click(); const confirm = p.page.getByTestId('mongodata-confirm'); await confirm.getByLabel(typedLabel(p, 'ord_01'), { exact: true }).fill('ord_01'); await capture(p, info, 'confirm-delete-typed', confirm); await p.page.keyboard.press('Escape');
    const dialog = await reveal(p); await button(p, 'keys.preview', dialog).click(); await expect(dialog.getByTestId('mongodata-preview')).toBeVisible(); await capture(p, info, 'issued-key-masked', dialog); await p.page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
    await ready(p, h, { errors: { update: 500 } }); await rowAction(p, 'edit', 'ord_01').click(); const drawer = p.page.getByTestId('mongodata-drawer'); await button(p, 'save', drawer).click(); await expect(drawer.getByText('synthetic update failure', { exact: true })).toBeVisible(); await capture(p, info, 'edit-drawer-failed-update', drawer); await p.page.keyboard.press('Escape');
    await ready(p, h, { errors: { delete: 500 } }); const failed = await typeAndDelete(p, 'ord_01'); await expect(failed.getByTestId('mongodata-confirm-error')).toBeVisible(); await capture(p, info, 'confirm-delete-failed', failed); await p.page.keyboard.press('Escape');
    await h.open({ errors: { docs: 500 } }); await enter(p); await expect(p.page.getByTestId('mongodata-failure-documents')).toBeVisible(); await capture(p, info, 'list-error', p.page.getByTestId('mongodata-failure-documents'));
  });

  test('kit-conformance', async () => { await check.kitConformance(manifest); });
});
