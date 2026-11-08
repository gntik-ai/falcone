import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { applicationPath, applicationsGet, applicationsPath, canonicalPath, endpoints, iamClientsPath, portal, providersPath, realmGet, realmId, syntheticSecret, tenant, tenantId, workspace } from './console-auth-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';

const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-auth-page.json`, import.meta.url), 'utf8'))]));
const copy = (p) => bundles[p.locale];
const fill = (template, values) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), template);
const surface = (p) => p.page.getByTestId('console-auth-page');
const wizard = (p) => p.page.getByTestId('auth-wizard');
const button = (p, name) => p.page.getByRole('button', { name, exact: true });
const field = (p, label) => p.page.getByLabel(new RegExp(`^${label.replace(/[\\()]/g, '\\$&')}`));
const ready = (p) => expect(surface(p).getByRole('table', { name: copy(p).apps.table })).toBeVisible();
const reads = (p, path) => p.network.requests.filter(({ method, path: sent }) => method === 'GET' && canonicalPath(sent) === canonicalPath(path));
const sections = ['users', 'roles', 'scopes', 'clients'];
async function screenshot(p, info, name) {
  const body = await p.page.screenshot({ fullPage: true, animations: 'disabled' });
  await info.attach(`${name}-${p.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}
async function toReview(p) {
  const c = copy(p);
  await button(p, c.wizard.open).click();
  await expect(wizard(p)).toBeVisible();
  await wizard(p).getByRole('button', { name: c.wizard.next, exact: true }).click();
  await wizard(p).getByLabel(new RegExp(`^${c.wizard.fields.clientId}`)).fill('new-client');
  await wizard(p).getByRole('button', { name: c.wizard.next, exact: true }).click();
  await wizard(p).getByLabel(new RegExp(`^${c.wizard.steps.redirects}`)).fill('https://app.example.test/callback');
  await wizard(p).getByRole('button', { name: c.wizard.next, exact: true }).click();
  await wizard(p).getByRole('checkbox', { name: 'openid' }).check();
  await wizard(p).getByRole('button', { name: c.wizard.next, exact: true }).click();
  await expect(wizard(p).getByText(c.wizard.review, { exact: true }).first()).toBeVisible();
}

for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-auth-page | superadmin | ${locale} | ${width}`, () => {
    test.use({ role: 'superadmin', locale, viewport: { width, height: 900 }, pageEndpoints: endpoints });
    let shellState;
    async function open(p, variants = {}, shell = '') {
      shellState = shell;
      await p.open(manifest.route, variants);
    }
    test.beforeEach(async ({ parity: p }) => {
      shellState = '';
      // The shared shell fixture stays unchanged. Only this page's bootstrap exposes a console realm.
      await p.page.route(/\/v1\/tenants(?:\/synthetic-tenant)?(?:\?.*)?$/, async (route) => {
        const request = route.request(), url = new URL(request.url());
        if (request.method() !== 'GET') return route.fallback();
        p.network.requests.push({ method: 'GET', path: url.pathname + url.search, body: undefined });
        const value = shellState === 'shell.tenant-without-realm' ? { ...tenant, identityContext: {} } : tenant;
        const none = shellState === 'shell.no-tenant';
        await route.fulfill({ json: url.pathname === '/v1/tenants' ? { items: none ? [] : [value], page: { after: null } } : { tenant: none ? null : value } });
      });
      await p.page.route(/\/v1\/workspaces\?.*$/, async (route) => {
        const url = new URL(route.request().url());
        p.network.requests.push({ method: 'GET', path: url.pathname + url.search, body: undefined });
        await route.fulfill({ json: { items: shellState === 'shell.no-workspace' ? [] : [workspace], page: { after: null } } });
      });
      const failures = [];
      const scoped = (url) => /\/v1\/(?:iam\/realms|workspaces\/[^/?]+\/(?:applications|iam))/.test(url);
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
        expect(pageRequests.has(`${request.method} ${url.pathname}`) || shellPaths.has(url.pathname), `unexpected request ${request.method} ${request.path}`).toBe(true);
        expect(url.pathname.startsWith('/v1/metrics/')).toBe(false);
        if (request.method === 'GET' && url.pathname.startsWith('/v1/iam/realms/')) expect(canonicalPath(request.path)).toBe(canonicalPath(realmGet(url.pathname.split('/').pop())));
        if (request.method === 'GET' && url.pathname === applicationsPath) expect(canonicalPath(request.path)).toBe(canonicalPath(applicationsGet));
      }
      await check.assertRuntimeHealth(p);
    });

    test('data', async ({ parity: p }) => {
      const c = copy(p);
      await open(p); await ready(p);
      await expect(surface(p).getByRole('heading', { level: 1, name: c.title })).toBeVisible();
      const kpis = surface(p).getByLabel(c.kpi.label);
      await expect(kpis).toContainText('3'); await expect(kpis).toContainText('2');
      await expect(surface(p).getByRole('table', { name: c.scopes.table })).toContainText('profile');
      const clients = surface(p).getByRole('table', { name: c.clients.table });
      await expect(clients).toContainText('console-web'); await expect(clients).toContainText('partner-api');
      await expect(surface(p).getByRole('table', { name: c.apps.table })).toContainText('Portal Clientes');
      await expect(surface(p).getByRole('table', { name: c.apps.table })).not.toContainText('Legacy Portal');
      await expect(surface(p).getByRole('table', { name: c.providers.table })).toContainText('Corp OIDC');
      // Snippets follow the selected client and only ever show a placeholder for the secret.
      await expect(surface(p).getByText('client_id=console-web')).toBeVisible();
      await clients.getByRole('button', { name: 'partner-api', exact: true }).click();
      await expect(surface(p).getByText('client_id=partner-api')).toBeVisible();
      await expect(surface(p).getByText('client_secret=<CLIENT_SECRET>')).toBeVisible();
      for (const section of sections) expect(reads(p, `/v1/iam/realms/${realmId}/${section}?page[size]=100`)).toHaveLength(1);
      expect(reads(p, applicationsGet)).toHaveLength(1);
      expect(p.network.requests.filter(({ method }) => method !== 'GET')).toEqual([]);
      await check.assertLocale(p);
    });

    test('action', async ({ parity: p }) => {
      const c = copy(p);
      await open(p); await ready(p);
      const mark = () => p.network.requests.length;
      const sent = (start) => p.network.requests.slice(start).filter(({ path }) => !path.startsWith('/v1/auth/'));
      // Create from the page toolbar.
      let start = mark();
      await button(p, c.apps.createExternal).click();
      await field(p, c.app.displayName).fill('Partner Portal'); await field(p, c.app.slug).fill('partner-portal');
      await field(p, c.app.redirectUris).fill('https://partner.example.test/callback');
      await button(p, c.app.create).click();
      await expect(p.page.getByText(c.feedback.appCreated).first()).toBeVisible();
      await expect.poll(() => sent(start).length).toBe(2);
      expect(sent(start)[0]).toMatchObject({ method: 'POST', path: applicationsPath, body: { displayName: 'Partner Portal', slug: 'partner-portal', protocol: 'oidc', desiredState: 'active', redirectUris: ['https://partner.example.test/callback'], federatedProviders: [] } });
      expect(sent(start)[1]).toMatchObject({ method: 'GET', path: applicationsGet });
      // Edit.
      start = mark();
      await button(p, fill(c.apps.editNamed, { name: 'Portal Clientes' })).click();
      await field(p, c.app.displayName).fill('Portal B2B');
      await button(p, c.app.save).click();
      await expect.poll(() => sent(start).length).toBe(2);
      expect(sent(start)[0]).toMatchObject({ method: 'PUT', path: applicationPath(portal.applicationId), body: { displayName: 'Portal B2B', slug: 'portal-clientes', metadata: { managedBy: 'seed' } } });
      // Soft delete behind a destructive confirmation.
      start = mark();
      await button(p, fill(c.apps.deleteNamed, { name: 'Portal Clientes' })).click();
      await p.page.getByRole('alertdialog').getByRole('button', { name: c.confirm.confirm, exact: true }).click();
      await expect.poll(() => sent(start).length).toBe(2);
      expect(sent(start)[0]).toMatchObject({ method: 'PUT', path: applicationPath(portal.applicationId), body: { desiredState: 'soft_deleted' } });
      expect(sent(start)[1]).toMatchObject({ method: 'GET', path: applicationsGet });
      // Providers: add, toggle, edit, detach.
      await button(p, fill(c.apps.providersNamed, { name: 'Portal Clientes' })).click();
      start = mark();
      await field(p, c.provider.providerId).fill('new-idp'); await field(p, c.provider.alias).fill('Partner IDP'); await field(p, c.provider.displayName).fill('Partner Login');
      await field(p, c.provider.authorizationUrl).fill('https://partner-idp.example.test/auth'); await field(p, c.provider.tokenUrl).fill('https://partner-idp.example.test/token');
      await button(p, c.provider.create).click();
      await expect.poll(() => sent(start).length).toBe(2);
      expect(sent(start)[0]).toMatchObject({ method: 'POST', path: providersPath(portal.applicationId), body: { providerId: 'new-idp', alias: 'Partner IDP' } });
      start = mark();
      await button(p, fill(c.panel.disableNamed, { alias: 'Corp OIDC' })).click();
      await expect.poll(() => sent(start).length).toBe(2);
      expect(sent(start)[0]).toMatchObject({ method: 'PUT', path: `${providersPath(portal.applicationId)}/corp-oidc`, body: { providerId: 'corp-oidc', enabled: false } });
      start = mark();
      await button(p, fill(c.panel.detachNamed, { alias: 'Corp OIDC' })).click();
      await p.page.getByRole('alertdialog').getByRole('button', { name: c.confirm.confirm, exact: true }).click();
      await expect.poll(() => sent(start).length).toBe(2);
      expect(sent(start)[0]).toMatchObject({ method: 'PUT', path: applicationPath(portal.applicationId), body: { federatedProviders: [] } });
      // Wizard: no applications read, secret never rendered.
      start = mark();
      await toReview(p);
      await button(p, c.wizard.confirm).click();
      await expect(p.page.getByText(fill(c.wizard.created, { id: 'new-client' })).first()).toBeVisible();
      expect(sent(start)).toEqual([{ method: 'POST', path: iamClientsPath, body: { clientType: 'public', clientId: 'new-client', redirectUris: ['https://app.example.test/callback'], scopes: ['openid'], permissions: [] } }]);
      expect(await p.page.content()).not.toContain(syntheticSecret);
      expect(await p.page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(syntheticSecret);
    });

    test('error-empty', async ({ parity: p, server }) => {
      const c = copy(p);
      const visible = async (variants, locator, shell = '') => { await open(p, variants, shell); await expect(locator).toBeVisible(); };
      await visible({ authUsers: 'iam.realm.users.500' }, surface(p).getByTestId('auth-section-users-error').getByRole('button', { name: c.failure.retry }));
      await expect(surface(p).getByTestId('auth-section-users-error')).toContainText('500'); await expect(surface(p).getByTestId('auth-section-users-error')).toContainText('req_synthetic_console_auth');
      p.network.setVariants({ authUsers: 'success' }); const before = reads(p, `/v1/iam/realms/${realmId}/users?page[size]=100`).length;
      await surface(p).getByTestId('auth-section-users-error').getByRole('button', { name: c.failure.retry }).click();
      await expect(surface(p).getByTestId('auth-section-users-error')).toHaveCount(0);
      expect(reads(p, `/v1/iam/realms/${realmId}/users?page[size]=100`)).toHaveLength(before + 1);
      await open(p, { authScopes: 'iam.realm.scopes.400' });
      await expect(surface(p).getByTestId('auth-section-scopes-error').getByText(c.failure.noRetry)).toBeVisible();
      await expect(surface(p).getByTestId('auth-section-scopes-error').getByRole('button', { name: c.failure.retry })).toHaveCount(0);
      await visible({ authScopes: 'iam.realm.scopes.empty' }, surface(p).getByText(c.scopes.empty));
      await visible({ authClients: 'iam.realm.clients.empty' }, surface(p).getByText(c.clients.empty));
      await visible({ authApplications: 'workspace.applications.empty' }, surface(p).getByText(c.apps.empty));
      await visible({ authApplications: 'workspace.applications.no-providers' }, surface(p).getByText(c.providers.empty));
      await open(p, { authClients: 'iam.realm.clients.403', authApplications: 'workspace.applications.403' });
      await expect(surface(p).getByTestId('auth-section-clients-error').getByText(c.errors.noAccess)).toBeVisible();
      await expect(surface(p).getByTestId('auth-applications-error').getByText(c.errors.noAccess)).toBeVisible();
      await expect(surface(p).getByText('synthetic-backend-message')).toHaveCount(0);
      await expect(surface(p).getByRole('table', { name: c.scopes.table })).toBeVisible();
      await open(p, { authRoles: 'iam.realm.roles.404', authApplications: 'workspace.applications.404' });
      await expect(surface(p).getByTestId('auth-section-roles-error').getByRole('link', { name: c.failure.backOverview })).toHaveAttribute('href', /\/console\/overview$/);
      await expect(surface(p).getByTestId('auth-applications-error').getByRole('link', { name: c.failure.backWorkspaces })).toHaveAttribute('href', /\/console\/workspaces$/);
      await open(p, { authApplications: 'workspace.applications.400-then-success' });
      const start = p.network.requests.length;
      await surface(p).getByTestId('auth-applications-error').getByRole('button', { name: c.failure.retry }).click(); await ready(p);
      expect(p.network.requests.slice(start).map(({ method, path }) => `${method} ${path}`)).toEqual([`GET ${applicationsGet}`]);
      await visible({ authApplications: 'workspace.applications.network' }, surface(p).getByTestId('auth-applications-error').getByRole('button', { name: c.failure.retry }));
      await expect(surface(p).getByText('Portal Clientes')).toHaveCount(0);
      // Shell states: no tenant, no console realm, no workspace.
      for (const [shell, text] of [['shell.no-tenant', c.empty.noTenant], ['shell.tenant-without-realm', c.empty.noRealm]]) {
        const from = p.network.requests.length; await open(p, {}, shell); await expect(p.page.getByText(text)).toBeVisible();
        expect(p.network.requests.slice(from).filter(({ path }) => /\/v1\/(?:iam|workspaces\/[^/]+\/applications)/.test(path))).toEqual([]);
      }
      await open(p, {}, 'shell.no-workspace'); await expect(surface(p).getByText(c.apps.selectWorkspace)).toBeVisible();
      await expect(button(p, c.apps.createExternal)).toBeDisabled();
      // A failed save keeps the form.
      await open(p, { authApplicationUpdate: 'workspace.applications.put.500' }); await ready(p);
      await button(p, fill(c.apps.editNamed, { name: 'Portal Clientes' })).click(); await field(p, c.app.displayName).fill('Portal B2B'); await button(p, c.app.save).click();
      await expect(surface(p).getByRole('alert').filter({ hasText: c.errors.unavailable }).first()).toBeVisible();
      await expect(field(p, c.app.displayName)).toHaveValue('Portal B2B');
      // Wizard failure keeps its values and offers Reintentar.
      await open(p, { authIamClient: 'iam-clients.post.500' }); await ready(p); await toReview(p); await button(p, c.wizard.confirm).click();
      await expect(wizard(p).getByRole('button', { name: c.failure.retry })).toBeVisible(); await expect(wizard(p)).toContainText('new-client');
      // A repeated 401 refreshes once, then stops at login.
      p.network.setVariants({ authUsers: 'iam.realm.users.401' });
      const beforeUnauthorized = p.network.requests.length;
      await p.page.goto(server.url(manifest.route.slice(1)));
      await expect(p.page).toHaveURL(/\/login$/);
      const unauthorized = p.network.requests.slice(beforeUnauthorized);
      expect(unauthorized.filter(({ method, path }) => method === 'POST' && path === '/v1/auth/login-sessions/synthetic-session/refresh')).toHaveLength(1);
    });

    test('accessibility', async ({ parity: p }) => {
      const c = copy(p);
      const accessible = async () => { await check.assertAccessibility(p); await check.assertLocale(p); };
      await open(p); await ready(p); await accessible();
      const create = button(p, c.apps.createExternal);
      await create.focus(); await p.page.keyboard.press('Enter');
      await expect(field(p, c.app.displayName)).toBeVisible();
      await button(p, c.app.create).click();
      await expect(p.page.getByRole('link', { name: `${c.app.displayName}: ${c.validation.nameRequired}` })).toBeVisible();
      await accessible();
      await button(p, c.form.cancel).first().click();
      await button(p, fill(c.apps.providersNamed, { name: 'Portal Clientes' })).click();
      await expect(surface(p).getByRole('region', { name: fill(c.panel.aria, { name: 'Portal Clientes' }) })).toBeVisible(); await accessible();
      await button(p, fill(c.panel.detachNamed, { alias: 'Corp OIDC' })).click();
      await expect(p.page.getByRole('alertdialog')).toBeVisible(); await accessible();
      await p.page.keyboard.press('Escape');
      await expect(button(p, fill(c.panel.detachNamed, { alias: 'Corp OIDC' }))).toBeFocused();
      await button(p, c.panel.close).click();
      const trigger = button(p, c.wizard.open);
      await trigger.click(); await expect(wizard(p)).toBeVisible();
      await expect(wizard(p).locator('[aria-current="step"]:visible').first()).toBeVisible(); await accessible();
      await toReviewFrom(p); await accessible();
      await p.page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
    });

    test('runtime-health', async ({ parity: p }) => {
      const c = copy(p);
      await open(p); await ready(p);
      await button(p, c.apps.createExternal).click(); await button(p, c.form.cancel).first().click();
      await toReview(p);
      await expect(p.page).toHaveURL(/\/console\/auth$/);
      await p.page.keyboard.press('Escape');
      await expect(surface(p).getByRole('link', { name: c.openMembers })).toHaveAttribute('href', /\/console\/members$/);
      await check.assertRuntimeHealth(p);
    });

    test('responsive', async ({ parity: p }) => {
      const c = copy(p);
      await open(p); await ready(p); await check.assertResponsive(p, width);
      await button(p, c.apps.createExternal).click(); await expect(field(p, c.app.displayName)).toBeVisible(); await check.assertResponsive(p, width);
      await button(p, c.form.cancel).first().click();
      await button(p, c.wizard.open).click(); await expect(wizard(p)).toBeVisible();
      const sizes = await p.page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth);
    });

    test('visual-review', async ({ parity: p }, info) => {
      const c = copy(p);
      await open(p); await ready(p); await screenshot(p, info, 'auth-loaded');
      await button(p, c.apps.createExternal).click(); await expect(field(p, c.app.displayName)).toBeVisible(); await screenshot(p, info, 'auth-application-form'); await button(p, c.form.cancel).first().click();
      await button(p, fill(c.apps.providersNamed, { name: 'Portal Clientes' })).click(); await expect(surface(p).getByText(fill(c.panel.title, { name: 'Portal Clientes' }))).toBeVisible(); await screenshot(p, info, 'auth-provider-panel');
      await toReview(p); await screenshot(p, info, 'auth-wizard-review'); await p.page.keyboard.press('Escape');
      await open(p, { authUsers: 'iam.realm.users.500' }); await expect(surface(p).getByTestId('auth-section-users-error')).toBeVisible(); await screenshot(p, info, 'auth-users-500');
      await open(p, { authClients: 'iam.realm.clients.403' }); await expect(surface(p).getByTestId('auth-section-clients-error')).toBeVisible(); await screenshot(p, info, 'auth-clients-403');
      await open(p, { authApplications: 'workspace.applications.empty', authScopes: 'iam.realm.scopes.empty', authClients: 'iam.realm.clients.empty' }); await expect(surface(p).getByText(c.apps.empty)).toBeVisible(); await screenshot(p, info, 'auth-empty');
    });

    test('kit-conformance', async ({ parity: p }) => { await open(p); await ready(p); await check.kitConformance(manifest); await check.assertLocale(p); });
  });
}

async function toReviewFrom(p) {
  const c = copy(p);
  const next = () => wizard(p).getByRole('button', { name: c.wizard.next, exact: true });
  await next().click();
  await wizard(p).getByLabel(new RegExp(`^${c.wizard.fields.clientId}`)).fill('new-client'); await next().click();
  await wizard(p).getByLabel(new RegExp(`^${c.wizard.steps.redirects}`)).fill('https://app.example.test/callback'); await next().click(); await next().click();
  await expect(wizard(p).getByText(c.wizard.review, { exact: true }).first()).toBeVisible();
}
