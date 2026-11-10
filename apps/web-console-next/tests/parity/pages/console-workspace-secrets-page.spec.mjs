import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import manifest, { canary, cursorPath, fixtureIds, redacted, secretPath, secretsPath, typed } from './console-workspace-secrets-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { blank, createSecretsHarness, expectBlank, sanitize, typeSecret } from './console-workspace-secrets-page.support.mjs';
import { seedActiveWorkspace, seedSecretsPrincipal } from './console-workspace-secrets-page.session.mjs';

// The failure snapshot (error-context.md) would otherwise persist the entered input values.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale,
  JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-workspace-secrets-page.json`, import.meta.url), 'utf8')),
]));
const harnesses = new WeakMap();
const text = (parity, key, values = {}) => key.split('.').reduce((node, part) => node[part], bundles[parity.locale])
  .replace(/\{(\w+)\}/g, (_, name) => String(values[name])).replace(/'\{'/g, '{').replace(/'\}'/g, '}');
const harness = (parity) => harnesses.get(parity);
const page = (parity) => parity.page.getByTestId('workspace-secrets-page');
const heading = (parity, key, values) => parity.page.getByRole('heading', { name: text(parity, key, values), exact: true });
const button = (parity, key, scope = parity.page, values) => scope.getByRole('button', { name: text(parity, key, values), exact: true });
const form = (parity) => parity.page.getByTestId('workspace-secrets-create');
const nameInput = (parity) => form(parity).getByLabel(text(parity, 'create.nameLabel'), { exact: true });
const valueInput = (parity) => form(parity).getByLabel(text(parity, 'create.valueLabel'), { exact: true });
const descriptionInput = (parity) => form(parity).getByLabel(text(parity, 'create.descriptionLabel'), { exact: true });
const replaceDialog = (parity) => parity.page.getByRole('dialog', { name: text(parity, 'replace.dialogTitle'), exact: true });
const confirmDialog = (parity) => parity.page.getByRole('alertdialog');
const typedInput = (parity) => confirmDialog(parity).getByLabel(text(parity, 'confirm.typedLabel'), { exact: true });
const rowAction = (parity, action, name) => parity.page.getByRole('button', { name: text(parity, `list.${action}Aria`, { name }), exact: true });
const gets = (parity) => harness(parity).calls().filter(({ method }) => method === 'GET');
const settleList = (parity) => expect(parity.page.getByTestId('workspace-secrets-list')).toBeVisible();
// Scans with axe but reports rule ids and selectors only: a node's HTML can carry a typed value.
async function scan(parity) {
  await parity.page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  const result = await new AxeBuilder({ page: parity.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = result.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
  expect(bad.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`), 'accessibility: serious/critical axe violations').toEqual([]);
}
async function open(parity, id, { route = manifest.route, variants = {}, principal, active } = {}) {
  harness(parity).use(id);
  if (principal) await parity.page.addInitScript(seedSecretsPrincipal, principal);
  if (active) await parity.page.addInitScript(seedActiveWorkspace, active);
  await parity.open(route, variants);
}
async function ready(parity, name = 'db_password') { await expect(parity.page.getByRole('rowheader', { name, exact: true })).toBeVisible(); }
async function create(parity, { name = 'new_secret', description = '' } = {}) {
  await nameInput(parity).fill(name);
  await typeSecret(valueInput(parity), canary);
  if (description) await descriptionInput(parity).fill(description);
  await button(parity, 'create.submit', form(parity)).click();
}
async function replace(parity, name = 'db_password') {
  await rowAction(parity, 'replace', name).click();
  await typeSecret(replaceDialog(parity).getByLabel(text(parity, 'replace.valueLabel'), { exact: true }), canary);
  await button(parity, 'replace.submit', replaceDialog(parity)).click();
  await typedInput(parity).fill(name);
  await button(parity, 'replace.confirmAction', confirmDialog(parity)).click();
}
async function remove(parity, name = 'db_password') {
  await rowAction(parity, 'delete', name).click();
  await typedInput(parity).fill(name);
  await button(parity, 'delete.action', confirmDialog(parity)).click();
}
async function screenshot(parity, info, name) {
  await check.assertLocale(parity);
  await parity.page.evaluate(() => document.fonts.ready);
  // The shell scrolls its main element, so capture that element rather than the viewport. Typed values stay masked.
  const body = await parity.page.locator('main').screenshot({ animations: 'disabled', caret: 'hide', mask: [parity.page.locator('input[type="password"]')] });
  await info.attach(`${name}-${parity.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}
const live = (parity, variants) => parity.network.setVariants(variants);

for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`Workspace secrets ${locale} ${width}`, () => {
    // Traces, screenshots and video embed input values; this page disables them, and verify-artifacts scans the rest.
    test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints, trace: 'off', screenshot: 'off', video: 'off' });
    test.beforeEach(async ({ parity }) => { harnesses.set(parity, createSecretsHarness(parity)); });
    test.afterEach(async ({ parity }) => { expect(harness(parity).state.matched.every(Boolean), 'every written value matched the synthetic canary in memory').toBe(true); });

    test.describe(`console-workspace-secrets-page | superadmin | ${locale} | ${width}`, () => {
    test('data', async ({ parity }) => {
      await open(parity, 'workspace-secrets.list.success'); await ready(parity);
      await expect(heading(parity, 'title')).toBeVisible();
      const table = page(parity).getByRole('table');
      await expect(table.getByRole('rowheader')).toHaveCount(3);
      await expect(table.getByText('DB_PASSWORD', { exact: true })).toBeVisible();
      await expect(page(parity).getByText(locale === 'es' ? '3 secretos' : '3 secrets', { exact: true }).first()).toBeVisible();
      // Descripción is hidden below md, Creado below lg and Actualizado below xl, header and cells together.
      const visible = { description: width >= 768, created: width >= 1024, updated: width >= 1280 };
      for (const [key, shown] of Object.entries(visible)) {
        await expect(table.getByRole('columnheader', { name: text(parity, `list.${key}`), exact: true })).toHaveCount(shown ? 1 : 0);
      }
      if (visible.description) await expect(table.getByText('Synthetic database credential', { exact: true })).toBeVisible();
      if (visible.created) await expect(table.locator('time').first()).toBeVisible();
      expect(gets(parity)).toEqual([{ method: 'GET', path: secretsPath, body: undefined }]);
      expect(await page(parity).evaluate((element, secret) => element.ownerDocument.body.innerText.includes(secret), canary)).toBe(false);
      for (const [id, label] of [['shell.workspace-production', text(parity, 'environmentProduction')], ['shell.workspace-staging', text(parity, 'environmentOther', { environment: 'staging' })]]) {
        await open(parity, id); await expect(parity.page.getByTestId('workspace-secrets-stage-badge')).toHaveText(label);
      }
      await open(parity, 'workspace-secrets.list.paged');
      await expect(page(parity).getByRole('rowheader')).toHaveCount(25);
      await expect(page(parity).getByText(locale === 'es' ? '25 secretos cargados' : '25 secrets loaded', { exact: false })).toBeVisible();
      await button(parity, 'paging.loadMore').click();
      await expect(page(parity).getByRole('rowheader')).toHaveCount(28);
      await expect(button(parity, 'paging.loadMore')).toHaveCount(0);
      expect(gets(parity).map(({ path }) => path)).toEqual([secretsPath, cursorPath]);
      await check.assertLocale(parity);
    });
    test('action', async ({ parity }) => {
      test.slow();
      await open(parity, 'workspace-secrets.create.success'); await ready(parity);
      await button(parity, 'toolbar.new').click(); await expect(nameInput(parity)).toBeFocused();
      await create(parity, { description: '  a note  ' });
      await expect.poll(() => blank(nameInput(parity))).toBe(true);
      expect(harness(parity).writes()).toEqual([{ method: 'POST', path: secretsPath, body: { secretName: 'new_secret', secretValue: redacted, description: 'a note' } }]);
      await expectBlank(expect, valueInput(parity), 'value'); await expect(nameInput(parity)).toBeFocused();
      expect(gets(parity)).toHaveLength(2);
      // Replace: the dialog submit sends nothing, Cancel returns with the value kept, the exact name sends one PUT.
      await rowAction(parity, 'replace', 'db_password').click();
      await typeSecret(replaceDialog(parity).getByLabel(text(parity, 'replace.valueLabel'), { exact: true }), canary);
      await button(parity, 'replace.submit', replaceDialog(parity)).click();
      expect(harness(parity).writes()).toHaveLength(1);
      await expect(button(parity, 'replace.confirmAction', confirmDialog(parity))).toBeDisabled();
      await typedInput(parity).fill('db_passwor'); await expect(button(parity, 'replace.confirmAction', confirmDialog(parity))).toBeDisabled();
      await button(parity, 'confirm.cancel', confirmDialog(parity)).click();
      expect(await replaceDialog(parity).getByLabel(text(parity, 'replace.valueLabel'), { exact: true }).evaluate((element) => element.value === '')).toBe(false);
      await button(parity, 'replace.submit', replaceDialog(parity)).click();
      await typedInput(parity).fill('db_password'); await button(parity, 'replace.confirmAction', confirmDialog(parity)).click();
      await expect.poll(() => harness(parity).writes().length).toBe(2);
      expect(harness(parity).writes()[1]).toEqual({ method: 'PUT', path: secretPath('db_password'), body: { secretValue: redacted, description: 'Synthetic database credential' } });
      await expect(rowAction(parity, 'replace', 'db_password')).toBeFocused();
      // Delete: Cancel sends nothing, the exact name sends one DELETE and focuses the section title.
      await rowAction(parity, 'delete', 'api_key').click(); await button(parity, 'confirm.cancel', confirmDialog(parity)).click();
      await expect(rowAction(parity, 'delete', 'api_key')).toBeFocused();
      expect(harness(parity).writes()).toHaveLength(2);
      await remove(parity, 'api_key');
      await expect.poll(() => harness(parity).writes().length).toBe(3);
      expect(harness(parity).writes()[2]).toEqual({ method: 'DELETE', path: secretPath('api_key'), body: undefined });
      await expect(heading(parity, 'list.title')).toBeFocused();
      // Retry after a write 500 re-sends the same request once.
      await open(parity, 'workspace-secrets.delete.500-then-success'); await ready(parity);
      await remove(parity); await expect(confirmDialog(parity).getByText(typed.requestId)).toBeVisible();
      await button(parity, 'errorPanel.retry', confirmDialog(parity)).click();
      await expect(confirmDialog(parity)).toHaveCount(0);
      expect(harness(parity).writes().map(({ method, path }) => `${method} ${path}`)).toEqual([`DELETE ${secretPath('db_password')}`, `DELETE ${secretPath('db_password')}`]);
      await open(parity, 'workspace-secrets.delete.404-secret-not-found'); await ready(parity);
      await remove(parity); await expect(heading(parity, 'notFound.delete')).toBeVisible();
      const before = gets(parity).length; await button(parity, 'noAccess.backToList').click();
      await expect.poll(() => gets(parity).length).toBe(before + 1);
      expect(gets(parity).at(-1)).toEqual({ method: 'GET', path: secretsPath, body: undefined });
      await open(parity, 'workspace-secrets.create.404'); await ready(parity);
      await create(parity, { description: 'note' }); await expect(heading(parity, 'notFound.create')).toBeVisible();
      const requests = parity.network.requests.length; await button(parity, 'noAccess.backToForm').click();
      expect(parity.network.requests).toHaveLength(requests); await expect(nameInput(parity)).toBeFocused();
      expect(await nameInput(parity).inputValue()).toBe('new_secret');
      for (const request of harness(parity).writes()) expect(JSON.stringify(request)).not.toContain(canary);
    });
    test('error-empty', async ({ parity, server }) => {
      test.slow();
      for (const [id, key] of [['workspace-secrets.list.empty', 'empty.title'], ['workspace-secrets.list.501', 'blocked.title'], ['workspace-secrets.list.403', 'noAccess.list'], ['workspace-secrets.list.404', 'notFound.list']]) {
        await open(parity, id); await expect(heading(parity, key)).toBeVisible();
        await expect(page(parity).getByRole('table')).toHaveCount(0);
        if (id.endsWith('403')) { await expect(page(parity).getByText(typed.correlationId)).toBeVisible(); await expect(parity.page.getByRole('button', { name: /Request access|Solicitar acceso/ })).toHaveCount(0); }
        if (id.endsWith('501')) { await expect(valueInput(parity)).toHaveCount(0); await expect(button(parity, 'toolbar.new')).toHaveCount(0); }
        await check.assertLocale(parity);
      }
      harness(parity).use('workspace-secrets.list.delayed');
      await parity.page.goto(server.url('console/workspace-secrets'));
      await expect(page(parity).getByRole('status', { name: text(parity, 'loading.title'), exact: true })).toBeVisible();
      await ready(parity);
      // No workspace: the picker renders and no secrets request is sent.
      await open(parity, 'shell.no-active-workspace'); await expect(heading(parity, 'workspace.title')).toBeVisible();
      expect(harness(parity).calls()).toEqual([]);
      await open(parity, 'shell.non-member', { principal: { platformRoles: ['tenant_viewer'], workspaceIds: [] } });
      await expect(parity.page.getByRole('heading', { name: text(parity, 'guardDenied'), exact: true })).toBeVisible();
      expect(harness(parity).calls()).toEqual([]);
      harness(parity).use('shell.workspace-error'); await parity.page.goto(server.url('console/workspace-secrets'));
      await expect(heading(parity, 'workspace.error')).toBeVisible();
      const reads = harness(parity).state.workspaceReads; await button(parity, 'errorPanel.retry').click();
      await expect.poll(() => harness(parity).state.workspaceReads).toBe(reads + 1);
      await expect(heading(parity, 'workspace.error')).toHaveCount(0);
      // Write failures: 403 and 404 for create, replace and delete, each with its recovery action.
      for (const [id, run, key, back] of [
        ['workspace-secrets.create.403', create, 'noAccess.create', 'noAccess.backToForm'], ['workspace-secrets.replace.403', replace, 'noAccess.replace', 'noAccess.backToList'],
        ['workspace-secrets.delete.403', remove, 'noAccess.delete', 'noAccess.backToList'], ['workspace-secrets.replace.404-secret-not-found', replace, 'notFound.replace', 'noAccess.backToList'],
        ['workspace-secrets.replace-and-delete.404-generic', remove, 'notFound.delete', 'noAccess.backToList'],
      ]) {
        await open(parity, id); await ready(parity); await run(parity);
        await expect(heading(parity, key)).toBeVisible(); await expect(button(parity, back)).toBeVisible();
        await expect(page(parity).getByText(typed.correlationId)).toBeVisible();
        await scan(parity); await check.assertLocale(parity);
        if (key === 'noAccess.create') { await button(parity, back).click(); await expectBlank(expect, nameInput(parity), 'name'); }
      }
      // 500, network, success sequences: ids on 500, none on network; the list clears and writes re-send the same request.
      await open(parity, 'workspace-secrets.list.500-then-network-then-success');
      await expect(heading(parity, 'listError.title')).toBeVisible();
      await expect(page(parity).getByText(typed.requestId)).toBeVisible();
      await button(parity, 'listError.retry').click(); await expect(page(parity).getByText(typed.requestId)).toHaveCount(0);
      await expect(heading(parity, 'listError.title')).toBeVisible(); await button(parity, 'listError.retry').click(); await ready(parity);
      await open(parity, 'workspace-secrets.list.page-2-500-then-network-then-success'); await expect(page(parity).getByRole('rowheader')).toHaveCount(25);
      await button(parity, 'paging.loadMore').click(); await expect(heading(parity, 'pageError.title')).toBeVisible();
      await expect(page(parity).getByRole('rowheader')).toHaveCount(25);
      await button(parity, 'errorPanel.retry').click(); await expect(heading(parity, 'pageError.title')).toBeVisible(); await button(parity, 'errorPanel.retry').click();
      await expect(page(parity).getByRole('rowheader')).toHaveCount(28);
      expect(gets(parity).slice(1).every(({ path }) => path === cursorPath)).toBe(true);
      for (const [id, run, sends] of [['workspace-secrets.create.500-then-network-then-success', create, 'POST'], ['workspace-secrets.replace.500-then-network-then-success', replace, 'PUT'], ['workspace-secrets.delete.500-then-network-then-success', remove, 'DELETE']]) {
        await open(parity, id); await ready(parity); await run(parity);
        const area = sends === 'POST' ? form(parity) : confirmDialog(parity);
        await expect(area.getByText(typed.requestId)).toBeVisible();
        await button(parity, 'errorPanel.retry', area).click(); await expect(area.getByText(typed.requestId)).toHaveCount(0);
        await button(parity, 'errorPanel.retry', area).click();
        await expect.poll(() => harness(parity).writes().length).toBe(3);
        const [first, ...rest] = harness(parity).writes().map(({ method, path, body }) => JSON.stringify({ method, path, body }));
        expect(rest.every((entry) => entry === first)).toBe(true);
      }
      await check.assertLocale(parity);
    });
    test('accessibility', async ({ parity }) => {
      test.slow();
      await open(parity, 'workspace-secrets.create.validation-errors'); await ready(parity);
      await scan(parity);
      await button(parity, 'create.submit', form(parity)).click();
      await expect(nameInput(parity)).toHaveAttribute('aria-invalid', 'true');
      await expect(valueInput(parity)).toHaveAttribute('aria-invalid', 'true');
      expect(await nameInput(parity).getAttribute('aria-describedby')).toContain(await page(parity).locator('[data-secret-error="name"]').getAttribute('id'));
      await scan(parity); await check.assertLocale(parity);
      await expect(page(parity).getByRole('table').locator('caption, [aria-label]').first()).toBeAttached();
      // Tab reaches Nuevo secreto, the only stop of the toolbar.
      await parity.page.locator('main').evaluate((main) => main.querySelector('h1')?.focus());
      await parity.page.keyboard.press('Tab');
      await expect(button(parity, 'toolbar.new')).toBeFocused();
      await open(parity, 'workspace-secrets.list.paged');
      await button(parity, 'paging.loadMore').focus(); await parity.page.keyboard.press('Enter');
      await expect(parity.page.getByRole('rowheader', { name: 'secret_26', exact: true })).toBeFocused();
      await open(parity, 'workspace-secrets.replace.success'); await ready(parity);
      await rowAction(parity, 'replace', 'db_password').click();
      await scan(parity); await parity.page.keyboard.press('Escape');
      await expect(rowAction(parity, 'replace', 'db_password')).toBeFocused();
      await replace(parity); await expect(rowAction(parity, 'replace', 'db_password')).toBeFocused();
      await rowAction(parity, 'delete', 'db_password').click(); await scan(parity);
      await parity.page.keyboard.press('Escape'); await expect(rowAction(parity, 'delete', 'db_password')).toBeFocused();
      await remove(parity); await expect(heading(parity, 'list.title')).toBeFocused();
      await open(parity, 'workspace-secrets.delete.last-row'); await remove(parity, 'only_secret');
      await expect(heading(parity, 'empty.title')).toBeFocused();
      await open(parity, 'workspace-secrets.replace.later-page-success');
      await button(parity, 'paging.loadMore').click(); await expect(page(parity).getByRole('rowheader')).toHaveCount(28);
      await replace(parity, 'secret_26'); await expect(heading(parity, 'list.title')).toBeFocused();
      await open(parity, 'workspace-secrets.delete.500'); await ready(parity); await remove(parity);
      await expect(button(parity, 'errorPanel.retry', confirmDialog(parity))).toBeFocused(); await scan(parity);
      for (const [id, run, key] of [['workspace-secrets.replace.403', replace, 'noAccess.replace'], ['workspace-secrets.replace.404-secret-not-found', replace, 'notFound.replace'], ['workspace-secrets.create.404', create, 'notFound.create']]) {
        await open(parity, id); await ready(parity); await run(parity);
        await expect(heading(parity, key)).toBeFocused(); await scan(parity);
      }
      await button(parity, 'noAccess.backToForm').click(); await expect(nameInput(parity)).toBeFocused();
      await check.assertLocale(parity);
    });
    test('runtime-health', async ({ parity, server }) => {
      test.slow();
      // Direct load, then a NavLink arrival from another migrated page.
      await open(parity, 'workspace-secrets.list.success'); await ready(parity);
      harness(parity).use('workspace-secrets.list.success');
      await parity.open('/console/profile');
      await parity.page.getByRole('link', { name: text(parity, 'title'), exact: true }).first().click();
      await ready(parity); expect(parity.page.url()).toBe(server.url('console/workspace-secrets'));
      for (const [id, run] of [['workspace-secrets.create.success', create], ['workspace-secrets.replace.success', replace], ['workspace-secrets.delete.success', remove], ['workspace-secrets.delete.500-then-network-then-success', remove], ['workspace-secrets.delete.404-secret-not-found', remove]]) {
        await open(parity, id); await ready(parity); await run(parity);
        if (id.includes('then')) { await button(parity, 'errorPanel.retry', confirmDialog(parity)).click(); await button(parity, 'errorPanel.retry', confirmDialog(parity)).click(); }
        await parity.page.evaluate(() => new Promise((done) => setTimeout(done, 50)));
      }
      // Workspace switch: the form values and open dialogs are cleared.
      await open(parity, 'shell.workspace-switch', { active: 'synthetic-workspace' }); await ready(parity);
      await nameInput(parity).fill('half_typed'); await typeSecret(valueInput(parity), canary);
      await parity.page.getByRole('button', { name: /Synthetic Workspace/ }).first().click();
      await parity.page.getByRole('menuitemradio', { name: 'Other Workspace', exact: true }).click();
      await expect(heading(parity, 'title')).toBeVisible();
      await expectBlank(expect, nameInput(parity), 'name'); await expectBlank(expect, valueInput(parity), 'value');
      await check.assertRuntimeHealth(parity);
    });
    test('responsive', async ({ parity }) => {
      test.slow();
      await open(parity, 'workspace-secrets.list.paged'); await ready(parity, 'secret_01'); await check.assertResponsive(parity, width);
      await expect(button(parity, 'toolbar.new')).toBeVisible(); await expect(button(parity, 'paging.loadMore')).toBeVisible();
      for (const [id, run, key] of [['workspace-secrets.delete.500', remove, 'errorPanel.retry'], ['workspace-secrets.create.403', create, 'noAccess.backToForm'], ['workspace-secrets.create.404', create, 'noAccess.backToForm'], ['workspace-secrets.delete.404-secret-not-found', remove, 'noAccess.backToList']]) {
        await open(parity, id); await ready(parity); await run(parity);
        await expect(button(parity, key).or(button(parity, key, confirmDialog(parity))).first()).toBeVisible();
        await check.assertResponsive(parity, width);
        if (id.endsWith('.500')) { const box = await confirmDialog(parity).boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width); }
      }
      // Eliminar is never clipped against the table scroll region, even with 29- and 63-character names.
      await open(parity, 'workspace-secrets.list.long-names'); await ready(parity, 'a'.repeat(29));
      const region = page(parity).getByRole('table').locator('xpath=ancestor::*[contains(@class, "overflow-x-auto") or contains(@class, "overflow-auto")][1]');
      for (const name of ['a'.repeat(29), 'b'.repeat(63)]) {
        const box = await rowAction(parity, 'delete', name).boundingBox(); const frame = await region.boundingBox();
        expect(box.x, `Eliminar ${name.length} clipped on the left`).toBeGreaterThanOrEqual(frame.x - 1);
        expect(box.x + box.width, `Eliminar ${name.length} clipped on the right`).toBeLessThanOrEqual(frame.x + frame.width + 1);
      }
      const scrolls = await region.evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(scrolls, 'the table scroll region does not need to scroll for its actions').toBeLessThanOrEqual(1);
    });
    test('visual-review', async ({ parity }, info) => {
      test.slow();
      for (const [id, key, shot] of [['workspace-secrets.list.success', 'list.title', 'list'], ['workspace-secrets.list.paged', 'paging.group', 'paged'], ['workspace-secrets.list.empty', 'empty.title', 'empty'], ['workspace-secrets.list.501', 'blocked.title', 'blocked'], ['workspace-secrets.list.403', 'noAccess.list', 'list-no-access'], ['shell.workspace-production', 'list.title', 'production']]) {
        await open(parity, id); await (key === 'paging.group' ? expect(parity.page.getByRole('group', { name: text(parity, key), exact: true })).toBeVisible() : expect(heading(parity, key)).toBeVisible());
        await screenshot(parity, info, shot);
      }
      for (const [id, run, key, shot] of [['workspace-secrets.replace.403', replace, 'noAccess.replace', 'replace-no-access'], ['workspace-secrets.create.404', create, 'notFound.create', 'create-not-found'], ['workspace-secrets.delete.404-secret-not-found', remove, 'notFound.delete', 'delete-not-found']]) {
        await open(parity, id); await ready(parity); await run(parity); await expect(heading(parity, key)).toBeVisible(); await screenshot(parity, info, shot);
      }
      await open(parity, 'workspace-secrets.replace.success'); await ready(parity); await rowAction(parity, 'replace', 'db_password').click();
      await typeSecret(replaceDialog(parity).getByLabel(text(parity, 'replace.valueLabel'), { exact: true }), canary); await screenshot(parity, info, 'replace-dialog');
      await button(parity, 'replace.submit', replaceDialog(parity)).click(); await expect(confirmDialog(parity)).toBeVisible(); await screenshot(parity, info, 'replace-confirm');
      await open(parity, 'workspace-secrets.delete.500'); await ready(parity); await rowAction(parity, 'delete', 'db_password').click();
      await expect(confirmDialog(parity)).toBeVisible(); await screenshot(parity, info, 'delete-confirm');
      await typedInput(parity).fill('db_password'); await button(parity, 'delete.action', confirmDialog(parity)).click();
      await expect(confirmDialog(parity).getByText(typed.requestId)).toBeVisible(); await screenshot(parity, info, 'delete-error-panel');
      // The checker and operator assess these artifacts; the maker cannot approve baselines.
    });
    test('kit-conformance', async ({ parity }) => {
      await check.kitConformance(manifest);
      const read = (path) => statSync(path).isDirectory() ? readdirSync(path).map((entry) => read(`${path}/${entry}`)).join('\n') : readFileSync(path, 'utf8');
      const source = manifest.sources.map((path) => read(new URL(`../../../${path}`, import.meta.url).pathname)).join('\n');
      expect(source).not.toMatch(/\bdark:|style=\{\{[^}]*(color|background)|\bbg-white\b|\btext-black\b|bg-\[|text-\[#/);
      await open(parity, 'workspace-secrets.create.403'); await ready(parity);
      await expect(page(parity).getByRole('searchbox')).toHaveCount(0);
      await expect(page(parity).getByRole('button', { name: /columns|density|views|columnas|densidad|vistas/i })).toHaveCount(0);
      await create(parity); await expect(heading(parity, 'noAccess.create')).toBeVisible();
      await expect(parity.page.getByRole('button', { name: /Request access|Solicitar acceso/ })).toHaveCount(0);
      for (const sample of ['Add policy', 'Policies', 'acme-web', 'billing-dashboard', 'Guardrails applied']) await expect(parity.page.getByText(sample)).toHaveCount(0);
      expect(await parity.page.locator('input[type="password"] ~ button[aria-pressed]').count(), 'no reveal toggle on secret fields').toBe(0);
      expect(fixtureIds.length).toBeGreaterThan(30);
      await check.assertLocale(parity);
    });
    });
    for (const variant of ['401-refresh-ok', '401-after-refresh', '401-refresh-rejected']) test(`workspace-secrets.list.${variant}`, async ({ parity, server }) => {
      await parity.page.addInitScript(() => {
        window.secretsInvalidations = 0;
        window.addEventListener('in-falcone:console-session-invalidated', () => window.secretsInvalidations++);
      });
      harness(parity).use(`workspace-secrets.list.${variant}`);
      if (variant === '401-refresh-ok') {
        await parity.open(manifest.route);
        await ready(parity); expect(new URL(parity.page.url()).pathname).toBe(new URL(server.url('console/workspace-secrets')).pathname);
        expect(gets(parity)).toHaveLength(2);
      } else {
        await parity.open(manifest.route);
        await expect(parity.page).toHaveURL(server.url('login'));
        expect(await parity.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(server.url('console/workspace-secrets')).pathname);
      }
      expect(parity.network.requests.filter(({ path }) => path.endsWith('/refresh'))).toHaveLength(1);
      // No write is ever re-sent by a session refresh.
      expect(harness(parity).writes()).toEqual([]);
    });
  });
}
