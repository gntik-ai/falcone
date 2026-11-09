import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { adaId, base, endpoints, firstUsers, nextUsers, realmId, secondPageUser, userPath, usersPath } from './console-iam-access-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';

const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-iam-access-page.json`, import.meta.url), 'utf8'))]));
const copy = (p) => bundles[p.locale];
const fill = (template, values) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
const surface = (p) => p.page.getByTestId('console-iam-access-page');
const ready = (p) => expect(surface(p).getByRole('table', { name: copy(p).users.tableLabel })).toBeVisible();
const button = (p, name) => surface(p).getByRole('button', { name, exact: true });
const status = (p, page, pages) => expect(surface(p).getByText(fill(copy(p).users.pageStatus, { page, pages }), { exact: true })).toBeVisible();
async function selectAda(p) { await ready(p); await button(p, 'ada').click(); await expect(surface(p).getByRole('heading', { name: fill(copy(p).detail.heading, { name: 'ada' }) })).toBeVisible(); await expect(surface(p).getByRole('tab', { name: copy(p).detail.tab.summary })).toBeVisible(); }
async function openTab(p, name) { await surface(p).getByRole('tab', { name: copy(p).detail.tab[name] }).click(); await expect(surface(p).getByRole('tab', { name: copy(p).detail.tab[name] })).toHaveAttribute('aria-selected', 'true'); }
async function choose(p, label, option) { await surface(p).getByRole('combobox', { name: label }).click(); await p.page.getByRole('option', { name: option, exact: true }).click(); }
const userForm = (p) => surface(p).getByTestId('iam-create-user-form');
const username = (p) => userForm(p).getByRole('textbox', { name: new RegExp(`^${copy(p).forms.user.username}`) });
const requestsSince = (p, start) => p.network.requests.slice(start);
const writesOf = (p, start = 0) => requestsSince(p, start).filter(({ method }) => method !== 'GET');
async function screenshot(p, info, name) {
  const body = await p.page.screenshot({ fullPage: true, animations: 'disabled' });
  await info.attach(`${name}-${p.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}

for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-iam-access-page | superadmin | ${locale} | ${width}`, () => {
    test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: endpoints });
    async function open(p, variants = {}) { await p.open(manifest.route, variants); }
    test.beforeEach(async ({ parity: p }) => {
      // Deliberate HTTP failures of the IAM fixtures are expected resource diagnostics, never application faults.
      const failures = [];
      const scoped = (url) => url.includes(base);
      p.page.on('response', (response) => { if (scoped(response.url()) && response.status() >= 400) failures.push({ url: response.url(), kind: String(response.status()) }); });
      p.page.on('requestfailed', (request) => { if (scoped(request.url())) failures.push({ url: request.url(), kind: 'network' }); });
      p.page.on('console', (message) => {
        if (message.type() !== 'error' || !consumeResourceDiagnostic(message.text(), message.location().url, failures)) return;
        const index = p.faults.indexOf(`console.error: ${message.text()}`); if (index >= 0) p.faults.splice(index, 1);
      });
    });
    test.afterEach(async ({ parity: p }) => {
      const pageRequests = new Set(Object.values(endpoints).map(({ method, path }) => `${method} ${path}`));
      const shellPaths = new Set(['/v1/tenants', `/v1/tenants/${realmId}`, '/v1/workspaces', '/v1/auth/signups/policy', '/v1/auth/login-sessions/synthetic-session/refresh']);
      for (const request of p.network.requests) {
        const url = new URL(request.path, 'http://synthetic.test');
        expect(pageRequests.has(`${request.method} ${url.pathname}`) || shellPaths.has(url.pathname), `unexpected request ${request.method} ${request.path}`).toBe(true);
        if (url.pathname === usersPath && request.method === 'GET') expect([firstUsers, nextUsers]).toContain(request.path);
      }
      expect(p.network.requests.some(({ method, path }) => method === 'GET' && path === userPath(adaId))).toBe(false);
      await check.assertRuntimeHealth(p);
    });
    test('data', async ({ parity: p }) => {
      await open(p); await ready(p); const c = copy(p), start = p.network.requests.length;
      await expect(surface(p).getByRole('table', { name: c.users.tableLabel }).getByRole('row')).toHaveCount(11);
      await status(p, 1, 3);
      expect(p.network.requests.filter(({ path }) => path.startsWith(`${usersPath}?`))).toHaveLength(1);
      await selectAda(p);
      await expect(surface(p).getByText(c.detail.summary.historyEmpty, { exact: true })).toBeVisible();
      await openTab(p, 'roles');
      await expect(surface(p).getByText('default-roles-synthetic-tenant', { exact: true })).toBeVisible();
      await expect(surface(p).getByRole('button', { name: fill(c.detail.roles.removeNamed, { name: 'default-roles-synthetic-tenant' }), exact: true })).toHaveCount(0);
      await expect(surface(p).getByRole('button', { name: fill(c.detail.roles.removeNamed, { name: 'viewer' }), exact: true })).toBeVisible();
      await openTab(p, 'groups'); await expect(surface(p).getByRole('button', { name: fill(c.detail.groups.removeNamed, { name: 'support' }), exact: true })).toBeVisible();
      expect(writesOf(p, start)).toEqual([]);
      await open(p, { iamUsers: 'iam:realm-users-250-two-pages' }); await ready(p); await status(p, 1, 25);
      expect(p.network.requests.filter(({ path }) => path.startsWith(`${usersPath}?`)).slice(-2).map(({ path }) => path)).toEqual([firstUsers, nextUsers]);
      await surface(p).getByRole('searchbox', { name: c.users.searchLabel }).fill(secondPageUser);
      await expect(button(p, secondPageUser)).toBeVisible();
    });
    test('action', async ({ parity: p }) => {
      await open(p); await ready(p); const c = copy(p); let start = p.network.requests.length;
      await username(p).fill('grace'); await userForm(p).getByRole('textbox', { name: c.forms.user.email }).fill('grace@example.test');
      await userForm(p).getByLabel(c.forms.user.password, { exact: true }).fill('synthetic-secret-0001');
      await expect(userForm(p).getByLabel(c.forms.user.password, { exact: true })).toHaveAttribute('type', 'password');
      await userForm(p).getByRole('combobox', { name: c.forms.user.role }).click(); await p.page.getByRole('option', { name: 'editor', exact: true }).click();
      await userForm(p).getByRole('button', { name: c.forms.user.submit }).click();
      await expect(surface(p).getByRole('button', { name: 'ada' })).toBeVisible();
      expect(writesOf(p, start)).toContainEqual({ method: 'POST', path: usersPath, body: { enabled: true, emailVerified: true, username: 'grace', email: 'grace@example.test', bootstrapCredentials: { temporaryPassword: 'synthetic-secret-0001' }, realmRoles: ['editor'] } });
      await expect(p.page.locator('body')).not.toContainText('synthetic-secret-0001');
      await open(p); await selectAda(p); start = p.network.requests.length;
      await surface(p).getByTestId('iam-create-role-form').getByRole('textbox', { name: new RegExp(`^${c.forms.role.name}`) }).fill('team');
      await surface(p).getByTestId('iam-create-role-form').getByRole('button', { name: c.forms.role.submit }).click();
      await expect.poll(() => writesOf(p, start)).toContainEqual({ method: 'POST', path: `${base}/roles`, body: { roleName: 'team' } });
      await surface(p).getByRole('button', { name: c.detail.suspend, exact: true }).click();
      await expect.poll(() => writesOf(p, start)).toContainEqual({ method: 'PATCH', path: `${userPath(adaId)}/status`, body: { enabled: false } });
      await openTab(p, 'roles'); start = p.network.requests.length;
      await choose(p, c.detail.roles.assign, 'editor');
      await expect.poll(() => writesOf(p, start)).toEqual([{ method: 'POST', path: `${userPath(adaId)}/role-assignments`, body: { roles: ['editor'] } }]);
      await surface(p).getByRole('button', { name: fill(c.detail.roles.removeNamed, { name: 'viewer' }), exact: true }).click();
      await p.page.getByRole('alertdialog').getByRole('button', { name: c.confirm.cancel }).click();
      expect(writesOf(p, start)).toHaveLength(1);
      await surface(p).getByRole('button', { name: fill(c.detail.roles.removeNamed, { name: 'viewer' }), exact: true }).click();
      await p.page.getByRole('alertdialog').getByRole('button', { name: c.confirm.removeRole.action }).click();
      await expect.poll(() => writesOf(p, start)).toContainEqual({ method: 'DELETE', path: `${userPath(adaId)}/role-assignments`, body: { roles: ['viewer'] } });
      await openTab(p, 'groups'); start = p.network.requests.length;
      await choose(p, c.detail.groups.assign, 'group-a');
      await expect.poll(() => writesOf(p, start)).toEqual([{ method: 'PUT', path: `${userPath(adaId)}/groups/synthetic-group-a`, body: undefined }]);
      await surface(p).getByRole('button', { name: fill(c.detail.groups.removeNamed, { name: 'support' }), exact: true }).click();
      await p.page.getByRole('alertdialog').getByRole('button', { name: c.confirm.removeGroup.action }).click();
      await expect.poll(() => writesOf(p, start)).toContainEqual({ method: 'DELETE', path: `${userPath(adaId)}/groups/synthetic-group-support`, body: undefined });
      start = p.network.requests.length;
      await surface(p).getByRole('button', { name: c.detail.delete, exact: true }).click();
      const dialog = p.page.getByRole('alertdialog'), confirm = dialog.getByRole('button', { name: c.confirm.deleteUser.action });
      await expect(confirm).toBeDisabled(); await dialog.getByRole('textbox', { name: c.confirm.typedName }).fill('ad'); await expect(confirm).toBeDisabled();
      await dialog.getByRole('textbox', { name: c.confirm.typedName }).fill('ada'); await confirm.click();
      await expect.poll(() => writesOf(p, start)).toContainEqual({ method: 'DELETE', path: userPath(adaId), body: undefined });
    });
    test('error-empty', async ({ parity: p, server }) => {
      const c = copy(p), start = () => p.network.requests.length;
      for (const [variants, text] of [
        [{ iamUsers: 'iam:realm-users-empty' }, c.users.empty.title], [{ iamUsers: 'iam:users-403' }, c.noAccess.title],
        [{ iamUsers: 'iam:users-500' }, c.errors.status['5xx']], [{ iamUsers: 'iam:users-network' }, c.errors.fallback.catalog],
      ]) { await open(p, variants); await expect(surface(p).getByText(text, { exact: true }).first()).toBeVisible(); }
      await open(p, { iamUsers: 'iam:users-500' }); await expect(surface(p).getByText('synthetic-iam-request')).toBeVisible(); await expect(surface(p).getByRole('button', { name: c.catalogError.retry })).toBeVisible();
      await open(p); await ready(p); await surface(p).getByRole('searchbox', { name: c.users.searchLabel }).fill('nobody-matches'); await expect(surface(p).getByText(c.users.noResults.title, { exact: true })).toBeVisible();
      for (const variant of ['iam:realm-users-page-2-500', 'iam:realm-users-page-2-502', 'iam:realm-users-page-2-network']) {
        await open(p, { iamUsers: variant }); await expect(surface(p).getByRole('button', { name: c.catalogError.retry })).toBeVisible();
        await expect(surface(p).getByRole('table')).toHaveCount(0); await expect(surface(p).getByText(/^(Página|Page) 1/)).toHaveCount(0);
        if (variant !== 'iam:realm-users-page-2-network') await expect(surface(p).getByText('synthetic-iam-request')).toBeVisible();
        p.network.setVariants({ iamUsers: 'iam:realm-users-250-two-pages' }); const before = start();
        await surface(p).getByRole('button', { name: c.catalogError.retry }).click(); await ready(p); await status(p, 1, 25);
        expect(requestsSince(p, before).filter(({ path }) => path.startsWith(`${usersPath}?`)).map(({ path }) => path)).toEqual([firstUsers, nextUsers]);
      }
      await open(p, { iamUserRoles: 'iam:user-404', iamUserGroups: 'iam:user-404' }); await ready(p); await button(p, 'ada').click();
      await expect(surface(p).getByText(c.detail.notFound.title, { exact: true })).toBeVisible(); await surface(p).getByRole('button', { name: c.detail.notFound.action }).click(); await expect(surface(p).getByText(c.detail.empty.title, { exact: true })).toBeVisible();
      await open(p, { iamUserRoles: 'iam:detail-500', iamUserGroups: 'iam:detail-500' }); await ready(p); await button(p, 'ada').click();
      await expect(surface(p).getByRole('button', { name: c.detail.error.retry })).toBeVisible(); await expect(surface(p).getByText('synthetic-iam-request')).toBeVisible();
      await open(p, { iamCreateUser: 'iam:create-user-409' }); await ready(p); await username(p).fill('grace'); await userForm(p).getByRole('button', { name: c.forms.user.submit }).click();
      await expect(surface(p).getByText(c.mutationError.title, { exact: true })).toBeVisible(); await expect(username(p)).toBeFocused(); await expect(username(p)).toHaveValue('grace');
      await open(p, { iamAssignRole: 'iam:membership-500', iamRemoveRole: 'iam:membership-500' }); await selectAda(p); await openTab(p, 'roles'); await choose(p, c.detail.roles.assign, 'editor');
      await expect(surface(p).getByText(c.mutationError.title, { exact: true })).toBeVisible();
      await surface(p).getByRole('button', { name: fill(c.detail.roles.removeNamed, { name: 'viewer' }), exact: true }).click();
      const dialog = p.page.getByRole('alertdialog'); await dialog.getByRole('button', { name: c.confirm.removeRole.action }).click();
      await expect(dialog.getByRole('alert')).toBeVisible(); await expect(dialog).toContainText(c.errors.status['5xx']);
      await dialog.getByRole('button', { name: c.confirm.cancel }).click(); await expect(surface(p).getByRole('button', { name: fill(c.detail.roles.removeNamed, { name: 'viewer' }), exact: true })).toBeFocused();
      const noTenant = start(); await open(p, { tenants: 'empty', workspaces: 'empty' }); await expect(surface(p).getByText(c.noTenant.title, { exact: true })).toBeVisible();
      expect(requestsSince(p, noTenant).filter(({ path }) => path.startsWith('/v1/iam/'))).toEqual([]);
      // A successful refresh followed by another users 401 must stop at login.
      p.network.setVariants({ iamUsers: 'iam:users-401' }); const beforeUnauthorized = start();
      await p.page.goto(server.url(manifest.route.slice(1))); await expect(p.page).toHaveURL(/\/login$/);
      expect(requestsSince(p, beforeUnauthorized).filter(({ method, path }) => method === 'POST' && path === '/v1/auth/login-sessions/synthetic-session/refresh')).toHaveLength(1);
      expect(await p.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(server.url(manifest.route.slice(1))).pathname);
    });
    test('accessibility', async ({ parity: p }) => {
      const c = copy(p), accessible = async () => { await check.assertAccessibility(p); await check.assertLocale(p); };
      await open(p); await ready(p); await accessible();
      await button(p, 'ada').focus(); await p.page.keyboard.press('Enter');
      await expect(surface(p).getByRole('tab', { name: c.detail.tab.summary })).toBeVisible(); await accessible();
      await surface(p).getByRole('tab', { name: c.detail.tab.summary }).focus(); await p.page.keyboard.press('ArrowRight');
      await expect(surface(p).getByRole('tab', { name: c.detail.tab.roles })).toBeFocused(); await accessible();
      await p.page.keyboard.press('ArrowRight'); await expect(surface(p).getByRole('tab', { name: c.detail.tab.groups })).toBeFocused(); await accessible();
      await expect(surface(p).getByText(fill(c.users.pageStatus, { page: 1, pages: 3 }), { exact: true })).toHaveAttribute('role', 'status');
      await surface(p).getByRole('button', { name: c.detail.delete, exact: true }).focus(); await p.page.keyboard.press('Enter');
      await expect(p.page.getByRole('alertdialog')).toBeVisible(); await accessible();
      await p.page.keyboard.press('Escape'); await expect(surface(p).getByRole('button', { name: c.detail.delete, exact: true })).toBeFocused();
      await open(p, { iamAssignRole: 'iam:assign-role-ok' }); await selectAda(p); await openTab(p, 'roles');
      await choose(p, c.detail.roles.assign, 'editor'); await expect(surface(p).getByRole('combobox', { name: c.detail.roles.assign })).toBeFocused(); await accessible();
      await open(p, { iamUsers: 'iam:realm-users-empty' }); await expect(surface(p).getByText(c.users.empty.title, { exact: true })).toBeVisible(); await accessible();
      await open(p, { iamUsers: 'iam:users-500' }); await expect(surface(p).getByRole('button', { name: c.catalogError.retry })).toBeVisible(); await accessible();
    });
    test('runtime-health', async ({ parity: p }) => {
      await open(p, { iamUsers: 'iam:realm-users-250-two-pages' }); await ready(p);
      await expect(p.page).toHaveURL(/\/console\/iam-access$/); await check.assertRuntimeHealth(p);
      await open(p, { iamUsers: 'iam:realm-users-page-2-network' }); await expect(surface(p).getByRole('button', { name: copy(p).catalogError.retry })).toBeVisible();
      await expect(p.page).toHaveURL(/\/console\/iam-access$/); await check.assertRuntimeHealth(p);
    });
    test('responsive', async ({ parity: p }) => {
      const c = copy(p); await open(p); await ready(p); await check.assertResponsive(p, width);
      await selectAda(p); await openTab(p, 'roles'); await check.assertResponsive(p, width);
      await surface(p).getByRole('button', { name: c.detail.delete, exact: true }).click(); await expect(p.page.getByRole('alertdialog')).toBeVisible(); await check.assertResponsive(p, width);
    });
    test('visual-review', async ({ parity: p }, info) => {
      const c = copy(p); await open(p); await selectAda(p); await screenshot(p, info, 'iam-summary');
      await openTab(p, 'roles'); await screenshot(p, info, 'iam-roles'); await openTab(p, 'groups'); await screenshot(p, info, 'iam-groups');
      await surface(p).getByRole('button', { name: c.detail.delete, exact: true }).click(); await expect(p.page.getByRole('alertdialog')).toBeVisible(); await screenshot(p, info, 'iam-delete-confirmation');
      await p.page.keyboard.press('Escape');
      await open(p, { iamUsers: 'iam:realm-users-250-two-pages' }); await ready(p); await screenshot(p, info, 'iam-250-users');
      await open(p, { iamUsers: 'iam:realm-users-empty' }); await expect(surface(p).getByText(c.users.empty.title, { exact: true })).toBeVisible(); await screenshot(p, info, 'iam-empty-realm');
      await open(p, { iamUsers: 'iam:users-500' }); await expect(surface(p).getByRole('button', { name: c.catalogError.retry })).toBeVisible(); await screenshot(p, info, 'iam-users-500');
    });
    test('kit-conformance', async ({ parity: p }) => { await open(p); await ready(p); await check.kitConformance(manifest); await check.assertLocale(p); });
  });
}
