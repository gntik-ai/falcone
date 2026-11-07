import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import manifest, { endpoints, firstUsers, invitationsPath, nextUsers, pending, proof, rolesGet, tenant, tenantId, usersPath, workspace } from './console-members-page.manifest.ts';
import { seedHistoryPrincipal } from './console-flow-history-page.session.mjs';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';
const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-members-page.json`, import.meta.url), 'utf8'))]));
const copy = (p) => bundles[p.locale];
const surface = (p) => p.page.getByTestId('console-members-page');
const wizard = (p) => p.page.getByTestId('members-invite');
const action = (p, key) => p.page.getByRole('button', { name: copy(p)[key], exact: true });
const password = (p) => p.page.getByLabel(copy(p).password).and(p.page.locator('input'));
const ready = (p) => expect(surface(p).getByRole('table', { name: copy(p).usersTable })).toBeVisible();
async function invite(p) { await ready(p); await action(p, 'invite').click(); await expect(wizard(p).getByRole('heading', { name: copy(p).invite })).toBeFocused(); await expect(p.page.getByRole('dialog')).toHaveAccessibleDescription(copy(p).inviteHelp); }
async function chooseRole(p) { await wizard(p).getByRole('combobox', { name: copy(p).role }).click(); await p.page.getByRole('option', { name: copy(p).workspaceRoles.workspace_developer }).click(); }
async function summary(p) {
  await invite(p); await action(p, 'next').click(); await wizard(p).getByRole('textbox', { name: copy(p).email }).fill('guest@example.test');
  await expect(wizard(p).getByText(copy(p).quotaPending, { exact: true })).toHaveCount(0); await action(p, 'next').click(); await chooseRole(p); await action(p, 'next').click();
  await expect(wizard(p).getByRole('heading', { name: copy(p).summary })).toBeVisible();
}
// Legacy Email and formatConsoleEnumLabel copy are intentionally shared by es/en.
// Keep the shared locale rules, excluding only these explicitly inventoried labels
// from cross-page catalog collisions (for example Email vs another page's Correo).
async function assertMembersLocale(p) {
  await expect(p.page.locator('html')).toHaveAttribute('lang', p.locale);
  const forbidden = new Set(['Search...', 'Search…', 'No results found.', 'No results found', 'Loading...', 'Loading…', 'Toggle sidebar', 'Open menu', 'Close menu', 'Select an option', 'Select workspace', 'Previous page', 'Next page']);
  const flatten = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => typeof value === 'string' ? [[prefix + key, value]] : flatten(value, `${prefix}${key}.`));
  const legacy = new Set([bundles.es.email, ...Object.values(bundles.es.lifecycleStates)]);
  if (p.locale === 'es') for (const file of await readdir(new URL('../../../src/locales/en/', import.meta.url))) {
    if (!file.endsWith('.json')) continue;
    const english = flatten(JSON.parse(await readFile(new URL(`../../../src/locales/en/${file}`, import.meta.url), 'utf8')));
    const spanish = new Map(flatten(JSON.parse(await readFile(new URL(`../../../src/locales/es/${file}`, import.meta.url), 'utf8'))));
    for (const [key, value] of english) if (value !== spanish.get(key) && !value.includes('{') && !legacy.has(value)) forbidden.add(value);
  }
  const values = await p.page.evaluate(() => {
    const values = [];
    for (const element of document.body.querySelectorAll('*')) {
      const style = getComputedStyle(element);
      if (['SCRIPT', 'STYLE'].includes(element.tagName) || style.display === 'none' || style.visibility === 'hidden' || !element.getClientRects().length) continue;
      for (const attribute of ['aria-label', 'title', 'placeholder', 'alt']) if (element.hasAttribute(attribute)) values.push(element.getAttribute(attribute));
      for (const id of (element.getAttribute('aria-labelledby') ?? '').split(/\s+/)) if (id) values.push(document.getElementById(id)?.textContent ?? '');
      for (const child of element.childNodes) if (child.nodeType === Node.TEXT_NODE) values.push(child.textContent);
      if (typeof element.innerText === 'string') values.push(element.innerText);
      if (element.matches('input[type="button"], input[type="submit"], input[type="reset"]')) values.push(element.value);
    }
    return values.map((value) => value.replace(/\s+/g, ' ').trim()).filter(Boolean);
  });
  const bad = values.filter((text) => /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/.test(text) || (p.locale === 'es' && forbidden.has(text)));
  expect(bad, `locale: unexpected copy ${bad.join(', ')}`).toEqual([]);
}
async function assertWizardResponsive(p, width) {
  await p.page.setViewportSize({ width, height: 900 });
  await expect(p.page.getByRole('dialog')).toBeVisible();
  const sizes = await p.page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth);
}
async function screenshot(p, info, name) {
  const body = await p.page.screenshot({ fullPage: true, animations: 'disabled' });
  await info.attach(`${name}-${p.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}
for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-members-page | tenant_owner | ${locale} | ${width}`, () => {
    test.use({ role: 'tenant_owner', locale, viewport: { width, height: 900 }, pageEndpoints: endpoints });
    let noTenant, noRealm;
    async function open(p, variants = {}, shell = '') { noTenant = shell === 'shell:tenant-none'; noRealm = shell === 'shell:tenant-without-realm'; await p.open(manifest.route, variants); }
    test.beforeEach(async ({ parity: p }) => {
      noTenant = false; noRealm = false;
      // The shared shell fixture stays unchanged. Only this page's bootstrap exposes a realm.
      await p.page.route(/\/v1\/tenants(?:\/synthetic-tenant)?(?:\?.*)?$/, async (route) => {
        const request = route.request(), url = new URL(request.url());
        if (request.method() !== 'GET') return route.fallback();
        p.network.requests.push({ method: 'GET', path: url.pathname + url.search, body: undefined });
        const value = noRealm ? { ...tenant, identityContext: {} } : tenant;
        await route.fulfill({ json: url.pathname === '/v1/tenants' ? { items: noTenant ? [] : [value], page: { after: null } } : { tenant: noTenant ? null : value } });
      });
      await p.page.route(/\/v1\/workspaces\?.*$/, async (route) => {
        const url = new URL(route.request().url());
        p.network.requests.push({ method: 'GET', path: url.pathname + url.search, body: undefined });
        await route.fulfill({ json: { items: [workspace], page: { after: null } } });
      });
      const failures = [];
      const scoped = (url) => /\/v1\/(?:iam\/realms|metrics|tenants\/[^/]+\/(?:users|invitations))/.test(url);
      p.page.on('response', (response) => { if (scoped(response.url()) && response.status() >= 400) failures.push({ url: response.url(), kind: String(response.status()) }); });
      p.page.on('requestfailed', (request) => { if (scoped(request.url())) failures.push({ url: request.url(), kind: 'network' }); });
      p.page.on('console', (message) => {
        if (message.type() !== 'error' || !consumeResourceDiagnostic(message.text(), message.location().url, failures)) return;
        const index = p.faults.indexOf(`console.error: ${message.text()}`); if (index >= 0) p.faults.splice(index, 1);
      });
    });
    test.afterEach(async ({ parity: p }) => {
      const pageRequests = new Set(Object.values(endpoints).map(({ method, path }) => `${method} ${path}`));
      const shellPaths = new Set(['/v1/tenants', `/v1/tenants/${tenantId}`, '/v1/workspaces', '/v1/auth/signups/policy', '/v1/auth/login-sessions/synthetic-session/refresh']);
      for (const request of p.network.requests) {
        const url = new URL(request.path, 'http://synthetic.test');
        expect(pageRequests.has(`${request.method} ${url.pathname}`) || shellPaths.has(url.pathname)).toBe(true);
        if (url.pathname === usersPath) expect([firstUsers, nextUsers]).toContain(request.path);
        if (url.pathname.endsWith('/roles')) expect(request.path).toBe(rolesGet);
      }
      await check.assertRuntimeHealth(p);
    });
    test('data', async ({ parity: p }) => {
      await open(p); await ready(p); const c = copy(p);
      await expect(surface(p).getByRole('table', { name: c.usersTable })).toContainText('alice'); await expect(surface(p).getByRole('table', { name: c.usersTable })).toContainText('UPDATE_PASSWORD');
      await expect(surface(p).getByRole('table', { name: c.rolesTable })).toContainText(c.composite);
      expect(p.network.requests.filter(({ path }) => path.startsWith('/v1/metrics/'))).toEqual([]);
      await open(p, { membersUsers: 'members:realm-users-150-two-pages' }); await ready(p);
      await expect(surface(p).getByRole('table', { name: c.usersTable }).getByRole('row')).toHaveCount(151);
      expect(p.network.requests.filter(({ path }) => path.startsWith(usersPath)).slice(-2).map(({ path }) => path)).toEqual([firstUsers, nextUsers]);
      await expect(surface(p).getByRole('navigation')).toHaveCount(0);
      const opening = open(p, { membersUsers: 'members:realm-users-150-delayed-continuation' });
      await expect(surface(p).getByRole('table', { name: c.rolesTable })).toBeVisible();
      await expect(surface(p).getByRole('status', { name: c.usersLoading })).toBeVisible();
      await expect(surface(p).getByText('synthetic-user-0', { exact: true })).toHaveCount(0);
      await opening; await ready(p);
      await expect(surface(p).getByRole('table', { name: c.usersTable }).getByRole('row')).toHaveCount(151);
      await assertMembersLocale(p);
    });
    test('action', async ({ parity: p }) => {
      await open(p); await ready(p); const c = copy(p); await action(p, 'create').click();
      await p.page.getByRole('textbox', { name: c.username }).fill('jdoe'); await password(p).fill('synthetic-password-0001'); await action(p, 'create').click();
      await expect(password(p)).toHaveCount(0);
      expect(p.network.requests.filter(({ method }) => method === 'POST')).toContainEqual({ method: 'POST', path: `/v1/tenants/${tenantId}/users`, body: { username: 'jdoe', password: 'synthetic-password-0001', roles: ['tenant_developer'] } });
      await summary(p);
      await p.page.getByRole('button', { name: c.editNamed.replace('{name}', c.email) }).click();
      await expect(wizard(p).getByRole('textbox', { name: c.email })).toHaveValue('guest@example.test');
      await action(p, 'next').click(); await action(p, 'next').click();
      await action(p, 'finish').evaluate((button) => { button.click(); button.click(); }); await expect(p.page.getByRole('textbox', { name: c.oneTimeLink })).toHaveValue(new RegExp(`/invitations/${tenantId}/${proof.id}#token=${proof.token}$`));
      const invitationPosts = p.network.requests.filter(({ method, path }) => method === 'POST' && path === invitationsPath);
      expect(invitationPosts).toEqual([{ method: 'POST', path: invitationsPath, body: { email: 'guest@example.test', role: 'workspace_developer', workspaceId: 'synthetic-workspace' } }]);
      await expect(action(p, 'finish')).toHaveCount(0); await expect(wizard(p).getByRole('heading', { name: c.invitationReady })).toBeFocused(); await p.page.keyboard.press('Escape'); await expect(action(p, 'invite')).toBeFocused(); await expect(p.page.getByRole('textbox', { name: c.oneTimeLink })).toHaveCount(0);
      await surface(p).getByRole('button', { name: c.revokeNamed.replace('{id}', pending.id) }).click(); await expect(surface(p).getByRole('table', { name: c.invitations })).toBeVisible();
      await surface(p).getByRole('button', { name: c.resendNamed.replace('{id}', pending.id) }).click(); await p.page.getByRole('textbox', { name: c.resendEmail }).fill('guest@example.test'); await action(p, 'generateLink').click(); await expect(p.page.getByRole('textbox', { name: c.oneTimeLink })).toBeVisible(); await action(p, 'hideLink').click();
      expect(p.network.requests).toContainEqual({ method: 'POST', path: `${invitationsPath}/${pending.id}/revocation`, body: {} }); expect(p.network.requests).toContainEqual({ method: 'POST', path: `${invitationsPath}/${pending.id}/resend`, body: { email: 'guest@example.test' } });
      expect(p.network.requests.filter(({ path }) => path.startsWith('/v1/metrics/'))).toHaveLength(4);
    });
    test('error-empty', async ({ parity: p, server }) => {
      const c = copy(p);
      for (const [name, variant, text] of [
        ['membersUsers', 'members:realm-users-empty', c.usersEmpty], ['membersRoles', 'members:realm-roles-empty', c.rolesEmpty],
        ['membersUsers', 'members:users-403', c.noAccess], ['membersRoles', 'members:roles-403', c.noAccess], ['membersUsers', 'members:realm-404', c.notFound],
        ['membersUsers', 'members:users-500', c.serviceUnavailable], ['membersRoles', 'members:roles-500', c.serviceUnavailable], ['membersUsers', 'members:users-network', c.usersFailure], ['membersRoles', 'members:roles-network', c.rolesFailure],
        ['membersInvitations', 'members:invitations-500', c.invitationsFailure], ['membersInvitations', 'members:invitations-network', c.invitationsFailure], ['membersInvitations', 'members:invitations-empty', c.invitationsEmpty],
      ]) { await open(p, { [name]: variant }); await expect(surface(p).getByText(text, { exact: true }).first()).toBeVisible(); }
      for (const variant of ['members:users-page-2-500', 'members:users-page-2-network', 'members:users-repeated-cursor']) {
        await open(p, { membersUsers: variant }); await expect(surface(p).getByRole('button', { name: c.usersRetry })).toBeVisible(); await expect(surface(p).getByText('synthetic-user-0', { exact: true })).toHaveCount(0); await expect(surface(p).getByRole('table', { name: c.rolesTable })).toBeVisible();
        p.network.setVariants({ membersUsers: 'members:realm-users-150-two-pages' }); await surface(p).getByRole('button', { name: c.usersRetry }).click(); await ready(p);
        await expect(surface(p).getByRole('table', { name: c.usersTable }).getByRole('row')).toHaveCount(151);
        expect(p.network.requests.filter(({ path }) => path.startsWith(usersPath)).slice(-2).map(({ path }) => path)).toEqual([firstUsers, nextUsers]);
      }
      for (const [shell, text] of [['shell:tenant-none', c.noTenant], ['shell:tenant-without-realm', c.noRealm]]) { const start = p.network.requests.length; await open(p, {}, shell); await expect(surface(p).getByText(text)).toBeVisible(); expect(p.network.requests.slice(start).filter(({ path }) => /\/v1\/(?:iam|metrics)|\/invitations$/.test(path))).toEqual([]); }
      await open(p, { membersInvite: 'members:invitation-500' }); await summary(p); await action(p, 'finish').click(); await expect(wizard(p).getByRole('alert')).toHaveText(c.inviteFailure); await expect(action(p, 'finish')).toBeFocused();
      await action(p, 'exit').click();
      await open(p, { membersWorkspaceQuotas: 'members:quotas-exhausted' }); await invite(p); await action(p, 'next').click(); await wizard(p).getByRole('textbox', { name: c.email }).fill('guest@example.test'); await expect(wizard(p).getByText(c.quotaPending)).toHaveCount(0); await action(p, 'next').click(); await expect(wizard(p).getByRole('alert')).toHaveText(c.quotaExhausted);
      await action(p, 'exit').click();
      for (const [variant, message] of [['members:create-user-403', c.restrictedAction], ['members:create-user-500', c.serviceUnavailable], ['members:create-user-network', c.createFailure]]) {
        await open(p, { membersCreate: variant }); await ready(p); await action(p, 'create').click();
        await p.page.getByRole('textbox', { name: c.username }).fill('jdoe');
        await password(p).fill('synthetic-password-0001'); await action(p, 'create').click();
        await expect(surface(p).getByRole('alert')).toContainText(message);
        await expect(password(p)).toHaveAttribute('type', 'password');
        await expect(password(p)).toHaveValue('synthetic-password-0001');
      }
      await open(p, { membersRevoke: 'members:invitation-revoke-500', membersResend: 'members:invitation-resend-500' }); await ready(p);
      await surface(p).getByRole('button', { name: c.revokeNamed.replace('{id}', pending.id) }).click();
      await expect(surface(p).getByRole('alert')).toHaveText(c.revokeFailure);
      await expect(surface(p).getByRole('table', { name: c.invitations })).toContainText(pending.id);
      await surface(p).getByRole('button', { name: c.resendNamed.replace('{id}', pending.id) }).click();
      await p.page.getByRole('textbox', { name: c.resendEmail }).fill('guest@example.test'); await action(p, 'generateLink').click();
      await expect(surface(p).getByRole('alert')).toHaveText(c.resendFailure);
      await expect(surface(p).getByRole('table', { name: c.invitations })).toContainText(pending.id);
      // A successful refresh followed by another users 401 must stop at login.
      p.network.setVariants({ membersUsers: 'members:users-401' });
      const beforeUnauthorized = p.network.requests.length;
      await p.page.goto(server.url(manifest.route.slice(1)));
      await expect(p.page).toHaveURL(/\/login$/);
      const unauthorized = p.network.requests.slice(beforeUnauthorized);
      expect(unauthorized.filter(({ path }) => path === firstUsers)).toHaveLength(2);
      expect(unauthorized.filter(({ method, path }) => method === 'POST' && path === '/v1/auth/login-sessions/synthetic-session/refresh')).toHaveLength(1);
      expect(await p.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(server.url(manifest.route.slice(1))).pathname);
    });
    test('accessibility', async ({ parity: p }) => {
      const c = copy(p);
      const activate = async (key) => { await action(p, key).focus(); await p.page.keyboard.press('Enter'); };
      const accessible = async () => { await check.assertAccessibility(p); await assertMembersLocale(p); };
      await open(p, { membersInvite: 'members:invitation-500' }); await ready(p); await accessible();
      await invite(p); await accessible();
      await activate('next');
      await expect(action(p, 'next')).toBeEnabled(); await activate('next');
      await expect(wizard(p).getByRole('alert')).toHaveText(c.emailInvalid);
      await expect(wizard(p).locator('[aria-current="step"]:visible').first()).toContainText(c.email);
      await accessible();
      await wizard(p).getByRole('textbox', { name: c.email }).fill('guest@example.test');
      await expect(wizard(p).getByText(c.quotaPending, { exact: true })).toHaveCount(0);
      await activate('next'); await activate('next');
      await expect(wizard(p).getByRole('alert')).toHaveText(c.roleRequired);
      await expect(wizard(p).locator('[aria-current="step"]:visible').first()).toContainText(c.role);
      await accessible();
      await activate('back');
      await expect(wizard(p).getByRole('textbox', { name: c.email })).toHaveValue('guest@example.test');
      await activate('next'); await chooseRole(p); await activate('next');
      await expect(wizard(p).getByRole('heading', { name: c.summary })).toBeVisible(); await accessible();
      await activate('finish');
      await expect(wizard(p).getByRole('alert')).toHaveText(c.inviteFailure);
      await expect(action(p, 'finish')).toBeFocused();
      await expect(wizard(p).getByRole('heading', { name: c.summary })).toBeVisible();
      await expect(wizard(p).getByText('guest@example.test', { exact: true })).toBeVisible();
      await accessible();
      p.network.setVariants({ membersInvite: 'members:invitation-accepted' });
      await activate('finish'); await expect(action(p, 'finish')).toHaveCount(0);
      await activate('close'); await expect(action(p, 'invite')).toBeFocused();
      await invite(p); await activate('exit'); await expect(action(p, 'invite')).toBeFocused();
      await invite(p); await p.page.keyboard.press('Escape'); await expect(action(p, 'invite')).toBeFocused();
      await action(p, 'create').click(); await activate('close'); await expect(action(p, 'create')).toBeFocused();
      await p.page.addInitScript(seedHistoryPrincipal, { platformRoles: ['tenant_viewer'] });
      await p.page.reload(); await ready(p);
      const indicator = surface(p).getByTestId('members-read-only-indicator');
      await expect(indicator).toBeVisible(); await expect(indicator).toContainText(c.roleLabels.tenant_viewer);
      await expect(indicator).toContainText(c.reasons.tenant_viewer);
      await expect(action(p, 'invite')).toHaveCount(0); await expect(action(p, 'create')).toHaveCount(0);
      await accessible();
    });
    test('runtime-health', async ({ parity: p }) => {
      await open(p, { membersUsers: 'members:realm-users-150-delayed-continuation' }); await ready(p); await invite(p);
      await expect.poll(() => p.network.requests.filter(({ path }) => path.startsWith('/v1/metrics/')).length).toBe(4); await expect(p.page).toHaveURL(/\/console\/members$/); await check.assertRuntimeHealth(p);
    });
    test('responsive', async ({ parity: p }) => {
      await open(p); await ready(p); await check.assertResponsive(p, width); await invite(p); await assertWizardResponsive(p, width);
    });
    test('visual-review', async ({ parity: p }, info) => {
      const c = copy(p); await open(p); await ready(p); await screenshot(p, info, 'members-role-tenant-owner');
      await action(p, 'create').click(); await screenshot(p, info, 'create-panel'); await action(p, 'close').click();
      await invite(p); await screenshot(p, info, 'invite-workspace'); await action(p, 'next').click(); await screenshot(p, info, 'invite-email'); await wizard(p).getByRole('textbox', { name: c.email }).fill('guest@example.test'); await expect(wizard(p).getByText(c.quotaPending)).toHaveCount(0); await action(p, 'next').click(); await screenshot(p, info, 'invite-role'); await chooseRole(p); await action(p, 'next').click(); await screenshot(p, info, 'invite-summary');
      p.network.setVariants({ membersInvite: 'members:invitation-500' }); await action(p, 'finish').click(); await expect(wizard(p).getByRole('alert')).toBeVisible(); await screenshot(p, info, 'members-invitation-500'); await action(p, 'exit').click();
      // Deliberately diverge shell and persisted session roles: the toolbar remains managerial.
      await p.page.evaluate(() => { const key = 'in-falcone.console-shell-session'; const value = JSON.parse(sessionStorage.getItem(key)); value.principal.platformRoles = ['tenant_viewer']; sessionStorage.setItem(key, JSON.stringify(value)); });
      const startBlocked = p.network.requests.length;
      await invite(p); await expect(wizard(p).getByRole('alert')).toContainText(c.blocked);
      await expect(wizard(p).getByRole('alert')).toContainText(c.reasons.tenant_viewer);
      await expect(wizard(p).locator('[aria-live="polite"]')).toHaveText(c.blocked);
      expect(p.network.requests.slice(startBlocked).filter(({ method, path }) => method === 'POST' || path.startsWith('/v1/metrics/'))).toEqual([]);
      await screenshot(p, info, 'members-invite-permission-denied'); await action(p, 'exit').click();
      await p.page.addInitScript(seedHistoryPrincipal, { platformRoles: ['tenant_viewer'] }); await p.page.reload(); await ready(p); await expect(action(p, 'invite')).toHaveCount(0);
      await expect(surface(p).getByTestId('members-read-only-indicator')).toContainText(c.roleLabels.tenant_viewer);
      await expect(surface(p).getByTestId('members-read-only-indicator')).toContainText(c.reasons.tenant_viewer); await screenshot(p, info, 'members-role-tenant-viewer');
      await open(p, { membersUsers: 'members:users-500' }); await expect(surface(p).getByRole('button', { name: c.usersRetry })).toBeVisible(); await screenshot(p, info, 'members-users-500');
    });
    test('kit-conformance', async ({ parity: p }) => { await open(p); await ready(p); await check.kitConformance(manifest); await assertMembersLocale(p); });
  });
}
