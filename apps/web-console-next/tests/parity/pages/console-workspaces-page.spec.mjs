import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { endpoints, tenantId, tenant, quotasPath, overviewPath, createPath, rawMessage, success } from './console-workspaces-page.manifest.ts';
import { seedHistoryPrincipal } from './console-flow-history-page.session.mjs';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';
const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-workspaces-page.json`, import.meta.url), 'utf8'))]));
const shellBundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/common.json`, import.meta.url), 'utf8'))]));
const copy = (p) => bundles[p.locale];
const surface = (p) => p.page.getByTestId('console-workspaces-page');
const wizard = (p) => p.page.getByTestId('workspace-wizard');
const action = (p, key) => p.page.getByRole('button', { name: copy(p)[key], exact: true });
const metrics = (p, path) => p.network.requests.filter((request) => request.path === path);
const writes = (p) => p.network.requests.filter(({ path, method }) => path === createPath && method === 'POST');
async function ready(p) { await expect(surface(p)).toBeVisible(); await expect.poll(() => metrics(p, quotasPath).length).toBeGreaterThan(0); }
async function openWizard(p) { await action(p, 'create').click(); await expect(wizard(p)).toBeVisible(); }
async function nameStep(p) { await openWizard(p); await action(p, 'next').click(); await expect(wizard(p).getByRole('textbox', { name: copy(p).nameLabel })).toBeFocused(); }
async function config(p) { await nameStep(p); await wizard(p).getByRole('textbox', { name: copy(p).nameLabel }).fill('Synthetic workspace'); await expect(action(p, 'next')).toBeEnabled(); await action(p, 'next').click(); }
async function summary(p) { await config(p); await wizard(p).getByRole('textbox', { name: copy(p).description }).fill('Synthetic description'); await action(p, 'next').click(); await expect(wizard(p).getByRole('heading', { name: copy(p).summary })).toBeVisible(); }
// gap-kit-builtin-copy-english: the u0-owned switcher has an untranslatable empty label.
// Exclude only that shell control, preserving the locale check on every page and wizard string.
async function pageLocale(p) {
  await p.page.evaluate((label) => {
    for (const region of document.querySelectorAll('section[aria-label]')) {
      if (region.getAttribute('aria-label') !== label) continue;
      for (const button of region.querySelectorAll('button')) {
        if (button.textContent.trim() !== 'Select workspace') continue;
        button.dataset.parityWorkspaceDisplay = button.style.display;
        button.style.display = 'none';
      }
    }
  }, shellBundles[p.locale].shell.context);
  try { await check.assertLocale(p); }
  finally {
    await p.page.evaluate(() => {
      for (const button of document.querySelectorAll('[data-parity-workspace-display]')) {
        button.style.display = button.dataset.parityWorkspaceDisplay;
        delete button.dataset.parityWorkspaceDisplay;
      }
    });
  }
}
async function snapshot(p, info, name) {
  const body = await p.page.screenshot({ fullPage: true, animations: 'disabled' });
  await info.attach(`${name}-${p.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}
async function responsive(p, width) {
  await p.page.setViewportSize({ width, height: 900 });
  const dimensions = await p.page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth, overflowing: [...document.querySelectorAll('[data-testid="workspace-wizard"] input, [data-testid="workspace-wizard"] footer')].filter((node) => node.getBoundingClientRect().right > innerWidth + 1).length }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport); expect(dimensions.overflowing).toBe(0);
}
for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-workspaces-page | ${locale} | ${width}`, () => {
    test.use({ role: 'tenant_owner', locale, viewport: { width, height: 900 }, pageEndpoints: endpoints });
    let noTenant;
    async function open(p, variants = {}, shell = 'shell.tenant-admin') { noTenant = shell === 'shell.no-active-tenant'; await p.open(manifest.route, variants); }
    test.beforeEach(async ({ parity: p }) => {
      noTenant = false;
      await p.page.route(/\/v1\/tenants(?:\/synthetic-tenant)?(?:\?.*)?$/, async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const url = new URL(route.request().url()); p.network.requests.push({ method: 'GET', path: url.pathname + url.search, body: undefined });
        await route.fulfill({ json: url.pathname === '/v1/tenants' ? { items: noTenant ? [] : [tenant], page: { after: null } } : { tenant: noTenant ? null : tenant } });
      });
      await p.page.route(/\/v1\/workspaces\?.*$/, async (route) => {
        const url = new URL(route.request().url()); p.network.requests.push({ method: 'GET', path: url.pathname + url.search, body: undefined }); await route.fulfill({ json: { items: [], page: { after: null } } });
      });
      const failures = [], scoped = (url) => /\/v1\/(?:metrics\/tenants|tenants\/[^/]+\/workspaces)/.test(url);
      p.page.on('response', (response) => { if (scoped(response.url()) && response.status() >= 400) failures.push({ url: response.url(), kind: String(response.status()) }); });
      p.page.on('requestfailed', (request) => { if (scoped(request.url())) failures.push({ url: request.url(), kind: 'network' }); });
      p.page.on('console', (message) => {
        if (message.type() !== 'error' || !consumeResourceDiagnostic(message.text(), message.location().url, failures)) return;
        const index = p.faults.indexOf(`console.error: ${message.text()}`); if (index >= 0) p.faults.splice(index, 1);
      });
    });
    test.afterEach(async ({ parity: p }) => {
      const allowed = new Set([quotasPath, overviewPath, createPath, '/v1/tenants', `/v1/tenants/${tenantId}`, '/v1/workspaces', '/v1/auth/signups/policy', '/v1/auth/login-sessions/synthetic-session/refresh']);
      for (const request of p.network.requests) {
        const url = new URL(request.path, 'http://synthetic.test'); expect(allowed.has(url.pathname)).toBe(true);
        if ([quotasPath, overviewPath, createPath].includes(url.pathname)) { expect(url.search).toBe(''); expect(request.method).toBe(url.pathname === createPath ? 'POST' : 'GET'); }
      }
      expect(p.network.requests.some(({ path }) => path.startsWith('/v1/metrics/workspaces/'))).toBe(false);
      await check.assertRuntimeHealth(p);
    });
    test('data', async ({ parity: p }) => {
      await open(p); await ready(p); const c = copy(p);
      await expect(surface(p).getByRole('heading', { name: c.title })).toBeVisible(); await expect(surface(p).getByText(tenant.displayName)).toBeVisible(); await expect(surface(p).getByRole('heading', { name: c.inventory })).toBeVisible();
      await config(p); await expect(wizard(p).getByRole('textbox', { name: c.maxFunctions })).toHaveValue('10'); await expect(wizard(p).getByRole('textbox', { name: c.maxDatabases })).toHaveValue('5'); await wizard(p).getByRole('textbox', { name: c.description }).fill('Synthetic description'); await action(p, 'next').click();
      for (const value of [tenantId, 'Synthetic workspace', 'Synthetic description', '10', '5']) await expect(wizard(p).getByText(value, { exact: true })).toBeVisible();
      await pageLocale(p);
      if (locale === 'en') {
        await p.page.addInitScript(() => document.addEventListener('readystatechange', () => { if (document.readyState === 'interactive') localStorage.removeItem('falcone-next-locale'); }, { once: true }));
        await open(p); await expect(surface(p).getByRole('heading', { name: bundles.en.title })).toBeVisible(); await expect(p.page.locator('html')).toHaveAttribute('lang', 'en');
        await p.page.getByRole('button', { name: 'User menu', exact: true }).click(); await p.page.getByRole('combobox', { name: 'Language' }).selectOption('es'); await expect(surface(p).getByRole('heading', { name: bundles.es.title })).toBeVisible(); await expect(p.page.locator('html')).toHaveAttribute('lang', 'es');
      }
    });
    test('action', async ({ parity: p, server }) => {
      await open(p); await ready(p); const c = copy(p);
      expect(metrics(p, quotasPath)).toHaveLength(1); expect(metrics(p, overviewPath)).toHaveLength(1); await summary(p); await action(p, 'finish').evaluate((button) => { button.click(); button.click(); });
      await expect(wizard(p).getByTestId('workspace-create-success').getByRole('heading', { name: c.successTitle })).toBeVisible(); expect(writes(p)).toEqual([{ method: 'POST', path: createPath, body: { name: 'Synthetic workspace', description: 'Synthetic description', initialLimits: { maxFunctions: 10, maxDatabases: 5 } } }]); await action(p, 'exit').click(); await expect(action(p, 'create')).toBeFocused();
      await open(p, { workspacesCreate: 'tenant-workspaces.create.500-then-success' }); await summary(p); await action(p, 'finish').click(); await action(p, 'retry').click(); await expect(wizard(p).getByTestId('workspace-create-success').getByRole('heading', { name: c.successTitle })).toBeVisible(); expect(writes(p)).toHaveLength(3); expect(writes(p).slice(-2)[0].body).toEqual(writes(p).at(-1).body);
      await p.page.goto(server.url('console/overview'));
      if (width < 1024) await p.page.getByRole('button', { name: locale === 'es' ? 'Abrir navegación' : 'Open navigation', exact: true }).click();
      const link = p.page.getByRole('navigation').getByRole('link', { name: shellBundles[locale].navigation.workspaces, exact: true });
      await expect(link).toHaveAttribute('href', new URL(server.url('console/workspaces')).pathname);
      await p.page.evaluate(() => { window.__workspacesDocument = 'synthetic-marker'; }); await link.click(); await ready(p); expect(await p.page.evaluate(() => window.__workspacesDocument)).toBe('synthetic-marker');
    });
    test('error-empty', async ({ parity: p, server }) => {
      const c = copy(p);
      await open(p, {}, 'shell.no-active-tenant'); await expect(surface(p).getByRole('heading', { name: c.noTenant })).toBeVisible(); await openWizard(p); await expect(action(p, 'next')).toBeDisabled(); expect(p.network.requests.filter(({ path }) => path.startsWith('/v1/metrics/'))).toEqual([]);
      await open(p, { workspacesQuotas: 'metrics.tenant-quotas.exhausted' }); await nameStep(p); await wizard(p).getByRole('textbox', { name: c.nameLabel }).fill('Synthetic workspace'); await expect(wizard(p).getByText(c.quotaExhausted, { exact: true })).toBeVisible(); await expect(action(p, 'next')).toBeDisabled();
      for (const [endpoint, prefix] of [['workspacesQuotas', 'metrics.tenant-quotas'], ['workspacesOverview', 'metrics.tenant-overview']]) for (const kind of ['500', 'network', '403', '404']) {
        await open(p, { [endpoint]: `${prefix}.${kind}-then-success` }); await nameStep(p); await wizard(p).getByRole('textbox', { name: c.nameLabel }).fill('Synthetic workspace'); await expect(action(p, 'next')).toBeEnabled(); const before = [metrics(p, quotasPath).length, metrics(p, overviewPath).length]; await action(p, 'retry').click(); await expect(action(p, 'retry')).toHaveCount(0); await expect(wizard(p).getByRole('textbox', { name: c.nameLabel })).toBeFocused(); expect(metrics(p, quotasPath)).toHaveLength(before[0] + 1); expect(metrics(p, overviewPath)).toHaveLength(before[1] + 1);
      }
      for (const kind of ['403', '404', '409', '422', '500', 'network']) {
        await open(p, { workspacesCreate: `tenant-workspaces.create.${kind}` }); await summary(p); await action(p, 'finish').click(); await expect(action(p, 'details')).toHaveAttribute('aria-expanded', 'false'); await expect(wizard(p).getByText(rawMessage, { exact: true })).toHaveCount(0); const announcements = await p.page.locator('[aria-live], [role="alert"]').allTextContents(); expect(announcements.join(' ')).not.toContain(rawMessage); expect(announcements.join(' ')).not.toContain('Failed to fetch'); await action(p, 'details').click(); await expect(wizard(p).getByText(kind === 'network' ? 'Failed to fetch' : new RegExp(rawMessage), { exact: true })).toBeVisible(); await action(p, 'backSummary').click(); await expect(action(p, 'finish')).toBeFocused();
      }
      let posts = [];
      p.page.on('request', (request) => { if (new URL(request.url()).pathname === createPath) posts.push(request); });
      await open(p, { workspacesCreate: 'tenant-workspaces.create.401-refresh-success' }); await summary(p); await action(p, 'finish').click(); await expect(wizard(p).getByTestId('workspace-create-success').getByRole('heading', { name: c.successTitle })).toBeVisible(); expect(posts).toHaveLength(2); expect(posts[0].postDataJSON()).toEqual(posts[1].postDataJSON()); expect(posts[0].headers()['idempotency-key']).not.toBe(posts[1].headers()['idempotency-key']);
      posts = []; await open(p, { workspacesCreate: 'tenant-workspaces.create.401-refresh-failure', refresh: '401' }); await summary(p); await action(p, 'finish').click(); await expect(p.page).toHaveURL(/\/login$/); expect(posts).toHaveLength(1); expect(await p.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(server.url('console/workspaces')).pathname);
    });
    test('accessibility', async ({ parity: p }) => {
      const c = copy(p); await open(p); await ready(p); await check.assertAccessibility(p); await nameStep(p); const input = wizard(p).getByRole('textbox', { name: c.nameLabel }); await input.fill('   '); await expect(input).toHaveAttribute('aria-invalid', 'true'); await expect(input).toHaveAccessibleDescription(c.nameRequired); await expect(action(p, 'next')).toBeDisabled(); await check.assertAccessibility(p);
      await input.fill('Synthetic workspace'); await input.press('Enter');
      for (const key of ['maxFunctions', 'maxDatabases']) {
        const field = wizard(p).getByRole('textbox', { name: c[key] });
        for (const value of ['', '0', '1.5', '1e3', 'abc', '5 5']) { await field.fill(value); await expect(field).toHaveAttribute('aria-invalid', 'true'); await expect(field).toHaveAttribute('aria-describedby', new RegExp(`${key}-error`)); await expect(action(p, 'next')).toBeDisabled(); }
        await field.fill(' 7 ');
      }
      await action(p, 'next').click(); await check.assertAccessibility(p); await p.page.keyboard.press('Escape'); await expect(action(p, 'create')).toBeFocused();
      await open(p, { workspacesCreate: 'tenant-workspaces.create.403' }); await summary(p); await action(p, 'finish').click(); await expect(wizard(p).getByRole('heading', { name: c.deniedTitle })).toBeFocused(); await expect(action(p, 'details')).toHaveAttribute('aria-expanded', 'false'); await check.assertAccessibility(p); await action(p, 'backSummary').click(); await expect(action(p, 'finish')).toBeFocused();
      for (const [endpoint, variant] of [['workspacesQuotas', 'metrics.tenant-quotas.500'], ['workspacesOverview', 'metrics.tenant-overview.network'], ['workspacesQuotas', 'metrics.tenant-quotas.403'], ['workspacesOverview', 'metrics.tenant-overview.404']]) { await open(p, { [endpoint]: variant }); await nameStep(p); await action(p, 'retry').focus(); await action(p, 'retry').click(); await expect(action(p, 'retry')).toBeFocused(); await check.assertAccessibility(p); }
      await p.page.addInitScript(seedHistoryPrincipal, { platformRoles: ['tenant_viewer'] }); await open(p, {}, 'shell.tenant-viewer'); await expect(action(p, 'create')).toHaveCount(0); await expect(surface(p).getByTestId('workspaces-read-only-indicator')).toContainText(c.roleLabels.tenant_viewer); await check.assertAccessibility(p); await pageLocale(p);
    });
    test('kit-conformance', async ({ parity: p }) => { await open(p); await ready(p); await check.kitConformance(manifest); await pageLocale(p); });
    test('runtime-health', async ({ parity: p }) => {
      await open(p, { workspacesQuotas: 'metrics.tenant-quotas.delayed' }); await nameStep(p); await expect(wizard(p).locator('[aria-busy="true"]')).toBeVisible(); await expect(action(p, 'next')).toBeDisabled(); await p.page.keyboard.press('Escape'); await expect(action(p, 'create')).toBeFocused(); await check.assertRuntimeHealth(p);
    });
    test('responsive', async ({ parity: p }) => {
      await open(p); await ready(p); await responsive(p, width); await config(p); await responsive(p, width);
      for (const [endpoint, variant] of [['workspacesOverview', 'metrics.tenant-overview.network'], ['workspacesQuotas', 'metrics.tenant-quotas.403'], ['workspacesOverview', 'metrics.tenant-overview.404']]) { await open(p, { [endpoint]: variant }); await nameStep(p); await responsive(p, width); }
      await open(p, { workspacesCreate: 'tenant-workspaces.create.403' }); await summary(p); await action(p, 'finish').click(); await action(p, 'details').click(); await responsive(p, width);
      await open(p, {}, 'shell.no-active-tenant'); await responsive(p, width);
    });
    test('visual-review', async ({ parity: p }, info) => {
      await open(p, { workspacesQuotas: 'metrics.tenant-quotas.available' }, 'shell.tenant-admin'); await ready(p); await snapshot(p, info, 'shell.tenant-admin'); await openWizard(p); await snapshot(p, info, 'wizard-tenant'); await action(p, 'next').click(); await snapshot(p, info, 'wizard-name'); await wizard(p).getByRole('textbox', { name: copy(p).nameLabel }).fill('Synthetic workspace'); await expect(action(p, 'next')).toBeEnabled(); await action(p, 'next').click(); await snapshot(p, info, 'wizard-configuration'); await action(p, 'next').click(); await snapshot(p, info, 'wizard-summary'); await action(p, 'finish').click(); await expect(wizard(p).getByTestId('workspace-create-success').getByRole('heading', { name: copy(p).successTitle })).toBeVisible(); await snapshot(p, info, 'tenant-workspaces.create.success');
      for (const [endpoint, variant] of [['workspacesQuotas', 'metrics.tenant-quotas.500'], ['workspacesQuotas', 'metrics.tenant-quotas.403'], ['workspacesOverview', 'metrics.tenant-overview.404']]) { await open(p, { [endpoint]: variant }); await nameStep(p); await snapshot(p, info, variant); }
      await open(p, { workspacesCreate: 'tenant-workspaces.create.403' }); await summary(p); await action(p, 'finish').click(); await expect(wizard(p).getByRole('heading', { name: copy(p).deniedTitle })).toBeVisible(); await snapshot(p, info, 'tenant-workspaces.create.403');
      await open(p, {}, 'shell.no-active-tenant'); await expect(surface(p).getByRole('heading', { name: copy(p).noTenant })).toBeVisible(); await snapshot(p, info, 'shell.no-active-tenant');
      await p.page.addInitScript(seedHistoryPrincipal, { platformRoles: ['tenant_viewer'] }); await open(p, {}, 'shell.tenant-viewer'); await expect(surface(p).getByTestId('workspaces-read-only-indicator')).toBeVisible(); await snapshot(p, info, 'shell.tenant-viewer');
    });
  });
}
