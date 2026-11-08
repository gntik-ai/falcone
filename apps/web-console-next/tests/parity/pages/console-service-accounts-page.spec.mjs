import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import manifest, { accountPath, active, base, endpoints, issuancePath, issued, otherWorkspaceId, requestId, revocationPath, rotated, rotationPath, rotatedSecret, syntheticSecret, tenantBId, tenantBWorkspaceId, workspaceId } from './console-service-accounts-page.manifest.ts';
import { seedHistoryPrincipal } from './console-flow-history-page.session.mjs';
import { openLegacy } from './console-service-accounts-page.legacy.mjs';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';

const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-service-accounts-page.json`, import.meta.url), 'utf8'))]));
const common = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/common.json`, import.meta.url), 'utf8'))]));
const copy = (p) => bundles[p.locale];
const fill = (text, values) => Object.entries(values).reduce((out, [key, value]) => out.replaceAll(`{${key}}`, value), text);
const surface = (p) => p.page.getByTestId('console-service-accounts-page');
const grid = (p) => surface(p).getByRole('table', { name: copy(p).table.caption });
const ready = (p) => expect(grid(p)).toBeVisible();
const rowButton = (p, kind, name = active.displayName) => surface(p).getByRole('button', { name: fill(copy(p).row[`${kind}Named`], { name }), exact: true });
const alertDialog = (p) => p.page.getByRole('alertdialog');
const disclosure = (p, mode) => p.page.getByRole('dialog', { name: copy(p).disclosure[`${mode}Title`] });
const polite = (p) => p.page.locator('[data-live-announcer="polite"]');
const assertive = (p) => p.page.locator('[data-live-announcer="assertive"]');
const heading = (p) => p.page.locator('main h1');
const nameField = (p) => surface(p).getByRole('textbox', { name: copy(p).create.nameLabel, exact: true });
const submit = (p) => surface(p).getByRole('button', { name: copy(p).create.submit, exact: true });
const retryIn = (scope, p) => scope.getByRole('button', { name: copy(p).failure.retry, exact: true });
const pageWrites = (p, since) => p.network.requests.slice(since).filter(({ method, path }) => method !== 'GET' && path.includes('/service-accounts'));
const listReads = (p, since) => p.network.requests.slice(since).filter(({ method, path }) => method === 'GET' && path === base());
const settle = (p) => p.page.waitForTimeout(300);
const mark = (p) => p.network.requests.length;

// The Spanish page keeps the legacy client-state labels (Enabled, Disabled) on purpose. The allowance
// is specific to this page: every other shared rule of the locale check still applies.
async function assertServiceAccountsLocale(p) {
  await expect(p.page.locator('html')).toHaveAttribute('lang', p.locale);
  const forbidden = new Set(['Search...', 'Search…', 'No results found.', 'No results found', 'Loading...', 'Loading…', 'Toggle sidebar', 'Open menu', 'Close menu', 'Select an option', 'Select workspace', 'Previous page', 'Next page']);
  const flatten = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => typeof value === 'string' ? [[prefix + key, value]] : flatten(value, `${prefix}${key}.`));
  const legacy = new Set([bundles.es.clientStates.enabled, bundles.es.clientStates.disabled]);
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
    }
    return values.map((value) => value.replace(/\s+/g, ' ').trim()).filter(Boolean);
  });
  const bad = values.filter((text) => /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/.test(text) || (p.locale === 'es' && forbidden.has(text)));
  expect(bad, `locale: unexpected copy ${bad.join(', ')}`).toEqual([]);
}
// Screenshots mask every secret; traces are off for this page (see test.use below).
async function screenshot(p, info, name) {
  const mask = [p.page.getByText(rotatedSecret), p.page.getByText(syntheticSecret)];
  const body = await p.page.screenshot({ fullPage: true, animations: 'disabled', mask });
  await info.attach(`${name}-${p.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}
// Moves the shell to a second tenant, or a second workspace, without clicking through a modal:
// a real user switches through the context panel; the modal cases dispatch the same change event.
function seedContext(context) {
  document.addEventListener('readystatechange', () => {
    if (document.readyState === 'interactive') localStorage.setItem('in-falcone.console-active-context', JSON.stringify(context));
  }, { once: true });
}
async function installSwitchShell(p) {
  await p.page.addInitScript(seedHistoryPrincipal, { tenantIds: ['synthetic-tenant', tenantBId], workspaceIds: [] });
  await p.page.addInitScript(seedContext, { userId: 'synthetic-user', tenantId: 'synthetic-tenant', workspaceId, updatedAt: '2026-06-01T12:00:00Z' });
  const workspace = (id, tenant, name) => ({ workspaceId: id, tenantId: tenant, displayName: name, slug: id, environment: 'dev', state: 'active' });
  await p.page.route(new RegExp(`/v1/tenants/${tenantBId}(?:\\?.*)?$`), async (route) => {
    const url = new URL(route.request().url());
    p.network.requests.push({ method: 'GET', path: url.pathname + url.search, body: undefined });
    await route.fulfill({ json: { tenant: { tenantId: tenantBId, displayName: 'Tenant B', slug: tenantBId, state: 'active' } } });
  });
  await p.page.route(/\/v1\/workspaces\?.*$/, async (route) => {
    const url = new URL(route.request().url());
    p.network.requests.push({ method: 'GET', path: url.pathname + url.search, body: undefined });
    const second = url.searchParams.get('filter[tenantId]') === tenantBId;
    await route.fulfill({ json: { items: second ? [workspace(tenantBWorkspaceId, tenantBId, 'Workspace B')] : [workspace(workspaceId, 'synthetic-tenant', 'Synthetic Workspace'), workspace(otherWorkspaceId, 'synthetic-tenant', 'Other Workspace')], page: { after: null } } });
  });
}
async function switchTenant(p) {
  await p.page.getByLabel(common[p.locale].shell.tenant).first().evaluate((select, value) => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, tenantBId);
}
async function switchWorkspace(p, modalOpen = false) {
  const trigger = p.page.getByRole('button', { name: new RegExp(common[p.locale].shell.workspace), includeHidden: true }).first();
  if (!modalOpen) {
    await trigger.click();
    await p.page.getByRole('menuitemradio', { name: /Other Workspace/ }).click();
    return;
  }
  // An open modal makes the rest of the page inert to pointer input, so the pointer sequence that a
  // user outside the modal would produce is replayed as DOM events. The menu opens in its own portal.
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) await trigger.dispatchEvent(type, { bubbles: true, button: 0 });
  await p.page.getByRole('menuitemradio', { name: /Other Workspace/ }).dispatchEvent('click');
}

// Performs the user steps that send an action's request and returns its surface and trigger.
async function drive(p, act) {
  const c = copy(p);
  if (act === 'create') {
    await nameField(p).fill('Created service'); await nameField(p).press('Enter');
    return { trigger: submit(p), surface: surface(p).getByRole('group', { name: c.failure.title.create }) };
  }
  if (act === 'issue') {
    await rowButton(p, 'reveal').click();
    return { trigger: rowButton(p, 'reveal'), surface: surface(p).getByRole('group', { name: c.failure.title.issue }) };
  }
  await rowButton(p, act).click();
  const dialog = alertDialog(p);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: c.confirm.typedName, exact: true }).fill(active.displayName);
  await dialog.getByRole('button', { name: c.confirm[act].action, exact: true }).click();
  return { trigger: rowButton(p, act), surface: dialog };
}
const targets = {
  create: { method: 'POST', path: base(), name: 'serviceAccountsCreate' }, issue: { method: 'POST', path: issuancePath(active.serviceAccountId), name: 'serviceAccountsIssue' },
  rotate: { method: 'POST', path: rotationPath(active.serviceAccountId), name: 'serviceAccountsRotate' }, revoke: { method: 'POST', path: revocationPath(active.serviceAccountId), name: 'serviceAccountsRevoke' },
  delete: { method: 'DELETE', path: accountPath(active.serviceAccountId), name: 'serviceAccountsDelete' },
};
const acts = Object.keys(targets);
const writesTo = (p, act, since) => pageWrites(p, since).filter(({ method, path }) => method === targets[act].method && path === targets[act].path);
async function succeeded(p, act) {
  const c = copy(p);
  if (act === 'create') await expect(nameField(p)).toHaveValue('');
  else if (act === 'issue') await expect(disclosure(p, 'reveal')).toBeVisible();
  else if (act === 'rotate') await expect(disclosure(p, 'rotate')).toBeVisible();
  else await expect(alertDialog(p)).toHaveCount(0);
  void c;
}

// Console, response and request bookkeeping shared by every cell.
function registerHooks() {
  test.beforeEach(async ({ parity: p }) => {
    const failures = [];
    const scoped = (url) => /\/v1\/workspaces\/[^/]+\/service-accounts|\/v1\/auth\/login-sessions\/[^/]+\/refresh/.test(new URL(url).pathname);
    p.page.on('response', (response) => { if (scoped(response.url()) && response.status() >= 400) failures.push({ url: response.url(), kind: String(response.status()) }); });
    p.page.on('requestfailed', (request) => { if (scoped(request.url())) failures.push({ url: request.url(), kind: 'network' }); });
    p.page.on('console', (message) => {
      if (message.type() !== 'error' || !consumeResourceDiagnostic(message.text(), message.location().url, failures)) return;
      const index = p.faults.indexOf(`console.error: ${message.text()}`); if (index >= 0) p.faults.splice(index, 1);
    });
  });
  test.afterEach(async ({ parity: p }) => {
    const pageRequests = new Set(Object.values(endpoints).map(({ method, path }) => `${method} ${path}`));
    const shellPaths = new Set(['/v1/tenants', '/v1/tenants/synthetic-tenant', `/v1/tenants/${tenantBId}`, '/v1/workspaces', '/v1/auth/signups/policy', '/v1/auth/login-sessions/synthetic-session/refresh']);
    for (const request of p.network.requests) {
      const url = new URL(request.path, 'http://synthetic.test');
      expect(pageRequests.has(`${request.method} ${url.pathname}`) || shellPaths.has(url.pathname), `unexpected request ${request.method} ${url.pathname}`).toBe(true);
    }
    await check.assertRuntimeHealth(p);
  });
}

// The read-only role is its own report cell: every write control is disabled with its reason and nothing is sent.
const viewerOpen = (p, variants = {}) => p.open(manifest.route, variants);
const writeControls = ['reveal', 'rotate', 'revoke', 'delete'];
const readOnlyNotice = (p) => surface(p).getByRole('status').filter({ hasText: copy(p).notice.readOnlyTitle }).first();
async function assertReadOnly(p) {
  const c = copy(p);
  // The role label and reason come from this page's catalog, never from the shared Spanish text.
  await expect(readOnlyNotice(p)).toContainText(c.roles.tenant_viewer); await expect(readOnlyNotice(p)).toContainText(c.denyReasons.tenant_viewer);
  for (const kind of writeControls) { await expect(rowButton(p, kind)).toBeDisabled(); await expect(rowButton(p, kind)).toHaveAttribute('title', c.denyReasons.tenant_viewer); }
  await expect(submit(p)).toBeDisabled();
}
const viewer = {
  async data(p) {
    const c = copy(p);
    await viewerOpen(p); await ready(p);
    for (const header of [c.table.name, c.table.clientState, c.table.credential, c.table.access, c.table.expires, c.table.actions]) await expect(grid(p).getByRole('columnheader', { name: header, exact: true })).toBeVisible();
    await expect(grid(p).getByRole('row')).toHaveCount(4);
    await expect(surface(p).getByText('Synthetic Tenant · Synthetic Workspace')).toBeVisible();
    await assertReadOnly(p); await assertServiceAccountsLocale(p);
  },
  async action(p) {
    await viewerOpen(p); await ready(p); const since = mark(p);
    // Disabled controls and a typed name send nothing; Enter in the field does not submit.
    await nameField(p).fill('Blocked'); await nameField(p).press('Enter');
    for (const kind of writeControls) await rowButton(p, kind).click({ force: true });
    await settle(p);
    await expect(alertDialog(p)).toHaveCount(0); await expect(p.page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0);
    expect(pageWrites(p, since)).toEqual([]);
  },
  async errorEmpty(p, server) {
    const c = copy(p);
    await viewerOpen(p, { serviceAccountsList: 'service-accounts-empty' }); await expect(surface(p).getByRole('heading', { name: c.states.empty })).toBeVisible(); await expect(readOnlyNotice(p)).toBeVisible(); await expect(submit(p)).toBeDisabled();
    await viewerOpen(p, { serviceAccountsList: 'service-accounts-403' }); await expect(surface(p).getByRole('heading', { name: c.states.listNoAccessTitle })).toBeVisible();
    await viewerOpen(p, { serviceAccountsList: 'service-accounts-404' }); await expect(surface(p).getByRole('heading', { name: c.states.listNotFoundTitle })).toBeVisible();
    for (const variant of ['service-accounts-500', 'service-accounts-network']) {
      await viewerOpen(p, { serviceAccountsList: variant }); await expect(retryIn(surface(p), p)).toBeVisible();
      p.network.setVariants({ serviceAccountsList: 'success' }); await retryIn(surface(p), p).click(); await ready(p);
      await assertReadOnly(p);
    }
    p.network.setVariants({ serviceAccountsList: 'service-accounts-loading-delayed' });
    const navigation = p.page.goto(server.url(manifest.route.slice(1)));
    await expect(surface(p).getByRole('status', { name: c.states.loading })).toBeVisible();
    await navigation; await ready(p);
    await assertServiceAccountsLocale(p);
  },
  async accessibility(p) {
    const accessible = async () => { await check.assertAccessibility(p); await assertServiceAccountsLocale(p); };
    await viewerOpen(p); await ready(p); await accessible();
    await viewerOpen(p, { serviceAccountsList: 'service-accounts-500' }); await expect(retryIn(surface(p), p)).toBeVisible(); await accessible();
  },
  async visual(p, info) {
    // Variants are reset before each capture, so the read-only capture always shows the list.
    await viewerOpen(p, { serviceAccountsList: 'service-accounts-500' }); await expect(retryIn(surface(p), p)).toBeVisible(); await screenshot(p, info, 'viewer-list-500');
    await viewerOpen(p, { serviceAccountsList: 'success' }); await ready(p); await screenshot(p, info, 'read-only');
  },
};

// Tracing stays off: a trace would record the synthetic secrets shown by the disclosure journeys.
// trace is a worker-scoped option, so it must be set at file level and not inside a describe group.
test.use({ trace: 'off' });

for (const role of ['tenant_owner', 'tenant_viewer']) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-service-accounts-page | ${role} | ${locale} | ${width}`, () => {
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: endpoints });
    registerHooks();
    const open = (p, variants = {}) => p.open(manifest.route, variants);

    test('data', async ({ parity: p }) => {
      if (role === 'tenant_viewer') return viewer.data(p);
      const c = copy(p);
      await open(p); await ready(p);
      for (const header of [c.table.name, c.table.clientState, c.table.credential, c.table.access, c.table.expires, c.table.actions]) await expect(grid(p).getByRole('columnheader', { name: header, exact: true })).toBeVisible();
      await expect(grid(p).getByRole('row')).toHaveCount(4);
      const [, billing, legacy, nightly] = await grid(p).getByRole('row').all();
      await expect(billing).toContainText(c.credentialStatuses.active); await expect(billing).toContainText(c.accessLevels.read_write); await expect(billing).toContainText(c.table.missing);
      await expect(legacy).toContainText(c.credentialStatuses.revoked); await expect(legacy).toContainText(c.table.revokedCaption); await expect(legacy).toContainText(c.accessLevels.denied);
      await expect(nightly).toContainText(c.credentialStatuses.rotated); await expect(nightly).toContainText(c.accessLevels.read_only); await expect(nightly.locator('time')).toHaveAttribute('datetime', '2026-07-01T09:30:00.000Z');
      await expect(surface(p).getByText('Synthetic Tenant · Synthetic Workspace')).toBeVisible();
      await assertServiceAccountsLocale(p);
      await open(p, { serviceAccountsList: 'unknown-credential-status' }); await expect(grid(p)).toContainText('suspended-by-policy');
      // Context switches with each surface open: nothing is sent, the surface and draft are gone, the new context shows, focus lands on the heading.
      await installSwitchShell(p);
      for (const kind of ['workspace', 'tenant']) for (const open_ of ['confirmation', 'disclosure', 'failure']) {
        await open(p, open_ === 'failure' ? { serviceAccountsIssue: '500' } : {}); await ready(p);
        await nameField(p).fill('Draft name');
        if (open_ === 'confirmation') { await rowButton(p, 'rotate').click(); await alertDialog(p).getByRole('textbox', { name: c.confirm.typedName, exact: true }).fill(active.displayName); }
        else if (open_ === 'disclosure') { await rowButton(p, 'reveal').click(); await expect(disclosure(p, 'reveal')).toBeVisible(); }
        else { await rowButton(p, 'reveal').click(); await expect(retryIn(surface(p), p)).toBeVisible(); }
        const since = mark(p);
        if (kind === 'tenant') await switchTenant(p); else await switchWorkspace(p, open_ !== 'failure');
        await expect(grid(p)).toContainText('Other workspace service');
        await expect(p.page.locator('[role="alertdialog"], [role="dialog"][aria-modal="true"]')).toHaveCount(0);
        await expect(retryIn(surface(p), p)).toHaveCount(0);
        await expect(nameField(p)).toHaveValue('');
        await expect(heading(p)).toBeFocused();
        expect(pageWrites(p, since)).toEqual([]);
        await expect(surface(p).getByText(kind === 'tenant' ? 'Tenant B · Workspace B' : 'Synthetic Tenant · Other Workspace')).toBeVisible();
      }
      await assertServiceAccountsLocale(p);
    });

    test('action', async ({ parity: p }, info) => {
      if (role === 'tenant_viewer') return viewer.action(p);
      test.setTimeout(300_000);
      const c = copy(p);
      // Create: Enter submits one POST, refetches once, announces the id and clears the field.
      await open(p); await ready(p); let since = mark(p);
      await nameField(p).fill('Created service'); await nameField(p).press('Enter');
      await expect(nameField(p)).toHaveValue(''); await expect(polite(p)).toContainText(fill(c.create.created, { id: 'synthetic-sa-created' })); await settle(p);
      expect(pageWrites(p, since)).toEqual([{ method: 'POST', path: base(), body: { displayName: 'Created service', entityType: 'service_account', desiredState: 'active' } }]);
      expect(listReads(p, since)).toHaveLength(1);
      // Revelar: masked disclosure, toggle found again by its new name, copy and the clipboard fallback.
      await open(p); await ready(p); since = mark(p);
      await p.page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(p.page.url()).origin });
      await rowButton(p, 'reveal').click();
      const reveal = disclosure(p, 'reveal');
      await expect(reveal).toBeVisible(); await expect(reveal).toHaveAttribute('aria-modal', 'true');
      await expect(reveal).toContainText(issued.credentialId); await expect(reveal).not.toContainText(syntheticSecret);
      await reveal.getByRole('button', { name: c.disclosure.show, exact: true }).click();
      const hide = reveal.getByRole('button', { name: c.disclosure.hide, exact: true });
      await expect(hide).toHaveAttribute('aria-pressed', 'true');
      await expect(reveal.getByRole('textbox', { name: c.disclosure.secretValue, exact: true })).toHaveValue(syntheticSecret);
      await reveal.getByRole('button', { name: c.disclosure.copyAria, exact: true }).click();
      await expect(reveal.getByText(c.disclosure.copied, { exact: true })).toBeVisible();
      expect(await p.page.evaluate(() => navigator.clipboard.readText())).toBe(syntheticSecret);
      await p.page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }));
      await reveal.getByRole('button', { name: c.disclosure.copyAria, exact: true }).click();
      await expect(reveal.getByText(c.disclosure.copyFallback, { exact: true })).toBeVisible();
      await expect(polite(p)).toContainText(c.disclosure.copyFallback);
      await reveal.getByRole('button', { name: c.disclosure.close, exact: true }).click();
      await expect(rowButton(p, 'reveal')).toBeFocused(); await settle(p);
      expect(pageWrites(p, since)).toEqual([{ method: 'POST', path: issuancePath(active.serviceAccountId), body: { requestedByUserId: 'synthetic-user' } }]);
      expect(listReads(p, since)).toHaveLength(1);
      // Rotar: Cancelar and Escape send nothing; the exact name sends one POST; one refetch; the fresh secret in the code block.
      await open(p); await ready(p); since = mark(p);
      await rowButton(p, 'rotate').click();
      const dialog = alertDialog(p);
      const typed = dialog.getByRole('textbox', { name: c.confirm.typedName, exact: true });
      await expect(typed).toBeFocused();
      await expect(dialog.getByRole('button', { name: c.confirm.rotate.action, exact: true })).toBeDisabled();
      await dialog.getByRole('button', { name: c.confirm.cancel, exact: true }).click();
      await expect(rowButton(p, 'rotate')).toBeFocused();
      await rowButton(p, 'rotate').click(); await p.page.keyboard.press('Escape'); await expect(rowButton(p, 'rotate')).toBeFocused();
      expect(pageWrites(p, since)).toEqual([]);
      await rowButton(p, 'rotate').click(); await typed.fill(active.displayName);
      await dialog.getByRole('button', { name: c.confirm.rotate.action, exact: true }).click();
      const fresh = disclosure(p, 'rotate');
      await expect(fresh).toBeVisible(); await expect(fresh.getByText(rotatedSecret, { exact: true })).toBeVisible(); await expect(fresh).toBeFocused();
      await expect(polite(p)).toContainText(fill(c.feedback.rotated, { name: active.displayName }));
      await screenshot(p, info, 'rotation-disclosure');
      await fresh.getByRole('button', { name: c.disclosure.close, exact: true }).click(); await expect(rowButton(p, 'rotate')).toBeFocused(); await settle(p);
      expect(pageWrites(p, since)).toEqual([{ method: 'POST', path: rotationPath(active.serviceAccountId), body: { reason: 'Console rotate' } }]);
      expect(listReads(p, since)).toHaveLength(1);
      // Revocar and Eliminar: nothing is sent before the exact name; each success refetches once and is announced.
      for (const [act, outcome] of [['revoke', c.feedback.revoked], ['delete', c.feedback.deleted]]) {
        await open(p); await ready(p); since = mark(p);
        await rowButton(p, act).click();
        await expect(alertDialog(p)).toContainText(c.confirm[act].irreversible);
        expect(pageWrites(p, since)).toEqual([]);
        await alertDialog(p).getByRole('textbox', { name: c.confirm.typedName, exact: true }).fill(active.displayName);
        await alertDialog(p).getByRole('button', { name: c.confirm[act].action, exact: true }).click();
        await expect(alertDialog(p)).toHaveCount(0); await expect(polite(p)).toContainText(outcome); await settle(p);
        expect(pageWrites(p, since)).toHaveLength(1); expect(listReads(p, since)).toHaveLength(1);
      }
      // Both builds, same fixtures, in every locale and width cell: requests, refetch counts and disclosure content match.
      // The legacy page is Spanish only, so its controls are located with the Spanish copy.
      await compareWithLegacy(p, info);
    });

    test('error-empty', async ({ parity: p, server }) => {
      if (role === 'tenant_viewer') return viewer.errorEmpty(p, server);
      test.setTimeout(300_000);
      const c = copy(p);
      // List states.
      await open(p, { serviceAccountsList: 'service-accounts-empty' }); await expect(surface(p).getByRole('heading', { name: c.states.empty })).toBeVisible();
      await open(p, { serviceAccountsList: 'service-accounts-403' }); await expect(surface(p).getByRole('heading', { name: c.states.listNoAccessTitle })).toBeVisible();
      await open(p, { serviceAccountsList: 'service-accounts-404' }); await expect(surface(p).getByRole('heading', { name: c.states.listNotFoundTitle })).toBeVisible();
      for (const variant of ['service-accounts-500', 'service-accounts-422', 'service-accounts-429', 'service-accounts-network']) {
        await open(p, { serviceAccountsList: variant }); await expect(retryIn(surface(p), p)).toBeVisible();
        if (variant !== 'service-accounts-network') await expect(surface(p)).toContainText(requestId);
        p.network.setVariants({ serviceAccountsList: 'success' }); await retryIn(surface(p), p).click(); await ready(p);
      }
      // The skeleton shows while the list loads and the create form stays usable.
      p.network.setVariants({ serviceAccountsList: 'service-accounts-loading-delayed' });
      const navigation = p.page.goto(server.url(manifest.route.slice(1)));
      await expect(surface(p).getByRole('status', { name: c.states.loading })).toBeVisible(); await expect(nameField(p)).toBeEnabled();
      await navigation; await ready(p);
      // Delayed actions: busy, repeat sends nothing, no early result.
      for (const act of acts) {
        await open(p, { [targets[act].name]: { variant: 'success', delayMs: 800 } }); await ready(p);
        const since = mark(p); const { trigger } = await drive(p, act);
        if (act === 'create') await expect(surface(p).getByRole('button', { name: c.create.submitting, exact: true })).toBeVisible();
        await expect(p.page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0);
        await settle(p); void trigger;
        expect(writesTo(p, act, since)).toHaveLength(1);
        await succeeded(p, act);
      }
      // Failures: no access, not found, 500, network and retry; one request per activation.
      for (const act of acts) {
        for (const status of ['403', '404', '500', 'network']) {
          await open(p, { [targets[act].name]: status }); await ready(p);
          const since = mark(p); const { trigger, surface: region } = await drive(p, act);
          if (status === '403') {
            await expect(region.getByRole('heading', { name: c.failure.noAccessTitle })).toBeVisible();
            await expect(region.getByRole('button', { name: c.confirm.close, exact: true })).toBeFocused();
            await region.getByRole('button', { name: c.confirm.close, exact: true }).click(); await expect(trigger).toBeFocused();
          } else if (status === '404') {
            await expect(region.getByRole('heading', { name: c.failure.notFoundTitle })).toBeVisible();
            await expect(region.getByRole('button', { name: c.confirm.close, exact: true })).toBeFocused();
            const reads = mark(p);
            await region.getByRole('button', { name: c.failure.backToList, exact: true }).click();
            await expect(heading(p)).toBeFocused(); await settle(p); expect(listReads(p, reads)).toHaveLength(1);
          } else {
            await expect(retryIn(region, p)).toBeFocused();
            if (status === '500') await expect(region).toContainText(requestId);
            await expect(assertive(p)).toContainText(c.failure.title[act]);
            await expect(p.page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0);
            p.network.setVariants({ [targets[act].name]: 'success' });
            await retryIn(region, p).click(); await succeeded(p, act); await settle(p);
            expect(writesTo(p, act, since)).toHaveLength(2);
          }
        }
      }
      // A revoked credential: localized alert, no Reintentar, no dialog.
      await open(p, { serviceAccountsIssue: '409-revoked' }); await ready(p); await rowButton(p, 'reveal').click();
      await expect(surface(p).getByText(c.errors.revoked)).toBeVisible(); await expect(retryIn(surface(p), p)).toHaveCount(0); await expect(disclosure(p, 'reveal')).toHaveCount(0);
      // Revoke and delete: mapped legacy messages; a 429 can be confirmed again.
      for (const act of ['revoke', 'delete']) for (const [status, message] of [['409', c.errors.conflict], ['429', c.errors.rateLimit], ['503', c.errors.unavailable]]) {
        await open(p, { [targets[act].name]: status }); await ready(p); await drive(p, act);
        await expect(alertDialog(p)).toContainText(message);
      }
      // After a network failure Reintentar reads the list first; an applied change is reported without a second write.
      for (const [act, outcome] of [['revoke', c.feedback.alreadyRevoked], ['delete', c.feedback.alreadyDeleted]]) {
        await open(p, { [targets[act].name]: 'network', serviceAccountsList: act === 'revoke' ? 'active-then-revoked' : 'active-then-without' }); await ready(p);
        const since = mark(p); const { surface: region } = await drive(p, act);
        await retryIn(region, p).click(); await expect(alertDialog(p)).toHaveCount(0); await expect(polite(p)).toContainText(fill(outcome, { name: active.displayName }));
        expect(writesTo(p, act, since)).toHaveLength(1); expect(listReads(p, since)).toHaveLength(1);
        // Not applied: one list read, then exactly one new write.
        await open(p, { [targets[act].name]: ['network', 'success'] }); await ready(p);
        const again = mark(p); const second = await drive(p, act);
        await retryIn(second.surface, p).click(); await expect(alertDialog(p)).toHaveCount(0); await settle(p);
        expect(writesTo(p, act, again)).toHaveLength(2);
      }
      // The primary button is no shortcut: after an uncertain outcome it also reads the list before the one new write.
      for (const act of ['revoke', 'delete']) {
        await open(p, { [targets[act].name]: ['network', 'success'] }); await ready(p);
        const since = mark(p); const { surface: region } = await drive(p, act);
        await expect(retryIn(region, p)).toBeVisible();
        const after = mark(p);
        await region.getByRole('button', { name: c.confirm[act].action, exact: true }).click();
        await expect(alertDialog(p)).toHaveCount(0); await settle(p);
        expect(p.network.requests[after]).toMatchObject({ method: 'GET', path: base() });
        expect(writesTo(p, act, since)).toHaveLength(2);
      }
      // Escape dismisses a mapped create or Revelar alert from the control that regains focus.
      for (const [act, name, trigger] of [['create', 'serviceAccountsCreate', submit], ['issue', 'serviceAccountsIssue', (q) => rowButton(q, 'reveal')]]) for (const status of ['409', '429']) {
        await open(p, { [name]: status }); await ready(p);
        await drive(p, act);
        await expect(trigger(p)).toBeFocused();
        await expect(surface(p).getByRole('alert')).toBeVisible();
        await p.page.keyboard.press('Escape');
        await expect(surface(p).getByRole('alert')).toHaveCount(0); await expect(trigger(p)).toBeFocused();
      }
      // 401: a successful refresh resends once with a fresh key; a failed one sends no resend and leads to login with the return path.
      for (const act of acts) {
        await open(p, { [targets[act].name]: 'refresh-ok' }); await ready(p);
        const since = mark(p); await drive(p, act); await succeeded(p, act);
        const posts = writesTo(p, act, since);
        expect(posts).toHaveLength(2); expect(posts[0].body).toEqual(posts[1].body);
        expect(p.network.requests.slice(since).filter(({ method, path }) => method === 'POST' && path.endsWith('/refresh'))).toHaveLength(1);
        await expect(polite(p)).toContainText(c.feedback.sessionRenewed);
      }
      for (const act of acts) {
        await open(p, { [targets[act].name]: '401', refresh: '401' }); await ready(p);
        const since = mark(p); await drive(p, act);
        await expect(p.page).toHaveURL(/\/login$/);
        expect(writesTo(p, act, since)).toHaveLength(1);
        expect(p.network.requests.slice(since).filter(({ method, path }) => method === 'POST' && path.endsWith('/refresh'))).toHaveLength(1);
        expect(await p.page.evaluate(() => JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')))).toBe(new URL(server.url(manifest.route.slice(1))).pathname);
      }
    });

    test('accessibility', async ({ parity: p }) => {
      if (role === 'tenant_viewer') return viewer.accessibility(p);
      const c = copy(p);
      const accessible = async () => { await check.assertAccessibility(p); await assertServiceAccountsLocale(p); };
      await open(p, { serviceAccountsRotate: '500', serviceAccountsIssue: '403' }); await ready(p); await accessible();
      // Keyboard path: Enter on Rotar opens the confirmation with the typed-name input focused; Escape cancels and returns to Rotar.
      await rowButton(p, 'rotate').focus(); await p.page.keyboard.press('Enter');
      await expect(alertDialog(p).getByRole('textbox', { name: c.confirm.typedName, exact: true })).toBeFocused(); await accessible();
      await p.page.keyboard.press('Escape'); await expect(rowButton(p, 'rotate')).toBeFocused();
      // Confirmation failures: 500 announces and focuses Reintentar; axe passes in the dark theme.
      await rowButton(p, 'rotate').click();
      await alertDialog(p).getByRole('textbox', { name: c.confirm.typedName, exact: true }).fill(active.displayName);
      await p.page.keyboard.press('Enter');
      await expect(retryIn(alertDialog(p), p)).toBeFocused(); await expect(assertive(p)).toContainText(c.failure.title.rotate); await accessible();
      await p.page.keyboard.press('Escape');
      for (const status of ['403', '404', '409', '429', 'network']) {
        await open(p, { serviceAccountsRevoke: status }); await ready(p); await drive(p, 'revoke');
        if (status === '403' || status === '404') await expect(alertDialog(p).getByRole('button', { name: c.confirm.close, exact: true })).toBeFocused();
        else if (status === 'network') await expect(retryIn(alertDialog(p), p)).toBeFocused();
        else await expect(alertDialog(p).getByRole('alert')).toBeVisible();
        await accessible();
      }
      // Reveal 403 sits in the result region; Cerrar returns focus to Revelar.
      await open(p, { serviceAccountsIssue: '403' }); await ready(p); await rowButton(p, 'reveal').click();
      await expect(surface(p).getByRole('group', { name: c.failure.title.issue }).getByRole('button', { name: c.confirm.close, exact: true })).toBeFocused(); await accessible();
      await surface(p).getByRole('button', { name: c.confirm.close, exact: true }).click(); await expect(rowButton(p, 'reveal')).toBeFocused();
      // Both disclosure branches: the panel takes focus; the toggle exposes aria-pressed.
      await open(p); await ready(p); await rowButton(p, 'reveal').click();
      const reveal = disclosure(p, 'reveal'); await expect(reveal).toBeFocused();
      await expect(reveal.getByRole('button', { name: c.disclosure.show, exact: true })).toHaveAttribute('aria-pressed', 'false'); await accessible();
      await reveal.getByRole('button', { name: c.disclosure.close, exact: true }).click();
      await rowButton(p, 'rotate').click(); await alertDialog(p).getByRole('textbox', { name: c.confirm.typedName, exact: true }).fill(active.displayName); await p.page.keyboard.press('Enter');
      await expect(disclosure(p, 'rotate')).toBeFocused(); await accessible();
      // Disabled actions expose their reason.
      await p.page.keyboard.press('Escape');
      await expect(rowButton(p, 'reveal', 'Legacy importer')).toHaveAttribute('title', c.row.revealRevoked);
      // Short viewports: the dialog footer (Copiar, Cerrar) stays reachable for both branches.
      for (const size of [{ width: 640, height: 450 }, { width: 667, height: 375 }]) {
        await p.page.setViewportSize(size);
        await rowButton(p, 'reveal').click(); const short = disclosure(p, 'reveal');
        await expect(short.getByRole('button', { name: c.disclosure.copyAria, exact: true })).toBeInViewport(); await expect(short.getByRole('button', { name: c.disclosure.close, exact: true })).toBeInViewport();
        await short.getByRole('button', { name: c.disclosure.close, exact: true }).click();
        await rowButton(p, 'rotate').click(); await alertDialog(p).getByRole('textbox', { name: c.confirm.typedName, exact: true }).fill(active.displayName); await p.page.keyboard.press('Enter');
        const fresh = disclosure(p, 'rotate');
        await expect(fresh.getByRole('button', { name: c.disclosure.copyAria, exact: true })).toBeInViewport(); await expect(fresh.getByRole('button', { name: c.disclosure.close, exact: true })).toBeInViewport();
        await fresh.getByRole('button', { name: c.disclosure.close, exact: true }).click();
      }
    });

    test('runtime-health', async ({ parity: p }) => {
      await open(p); await ready(p);
      if (role === 'tenant_viewer') { await check.assertRuntimeHealth(p); expect(p.faults.join('\n')).not.toContain(syntheticSecret); return; }
      await rowButton(p, 'reveal').click(); await expect(disclosure(p, 'reveal')).toBeVisible();
      await disclosure(p, 'reveal').getByRole('button', { name: copy(p).disclosure.close, exact: true }).click();
      await expect(p.page).toHaveURL(/\/console\/service-accounts$/);
      await check.assertRuntimeHealth(p);
      // The secret never reaches the console log or the fault log.
      expect(p.faults.join('\n')).not.toContain(syntheticSecret);
    });

    test('responsive', async ({ parity: p }) => {
      await open(p); await ready(p); await check.assertResponsive(p, width);
      if (role === 'tenant_viewer') return;
      await rowButton(p, 'reveal').click(); await expect(disclosure(p, 'reveal')).toBeInViewport();
      const sizes = await p.page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth);
    });

    test('visual-review', async ({ parity: p }, info) => {
      if (role === 'tenant_viewer') return viewer.visual(p, info);
      const c = copy(p);
      // A fresh fixture set before every capture: variants never leak between states.
      await open(p); await ready(p); await screenshot(p, info, 'service-accounts-list');
      await rowButton(p, 'rotate').click(); await screenshot(p, info, 'rotate-confirmation'); await p.page.keyboard.press('Escape');
      await rowButton(p, 'revoke').click(); await screenshot(p, info, 'revoke-confirmation'); await p.page.keyboard.press('Escape');
      await rowButton(p, 'delete').click(); await screenshot(p, info, 'delete-confirmation'); await p.page.keyboard.press('Escape');
      await rowButton(p, 'reveal').click(); await expect(disclosure(p, 'reveal')).toBeVisible(); await screenshot(p, info, 'reveal-disclosure-masked');
      await disclosure(p, 'reveal').getByRole('button', { name: c.disclosure.close, exact: true }).click();
      await open(p, { serviceAccountsRotate: '403' }); await ready(p); await drive(p, 'rotate'); await expect(alertDialog(p).getByRole('heading', { name: c.failure.noAccessTitle })).toBeVisible(); await screenshot(p, info, 'rotate-403');
      await open(p, { serviceAccountsRotate: '500' }); await ready(p); await drive(p, 'rotate'); await expect(retryIn(alertDialog(p), p)).toBeVisible(); await screenshot(p, info, 'rotate-500');
      await open(p, { serviceAccountsList: 'service-accounts-500' }); await expect(retryIn(surface(p), p)).toBeVisible(); await screenshot(p, info, 'list-500');
    });

    test('kit-conformance', async ({ parity: p }) => {
      // Open the page first: the shared teardown inspects the page and about:blank is not inspectable.
      await open(p); await ready(p);
      await check.kitConformance(manifest);
      await assertServiceAccountsLocale(p);
    });
  });
}

// Runs the same journeys against the legacy build and the Next build and compares what both send and show.
async function compareWithLegacy(p, info) {
  const c = copy(p);
  const viewport = p.page.viewportSize();
  const run = async (mode) => {
    // The legacy page has only Spanish copy; the Next page uses the cell's locale.
    const k = mode === 'legacy' ? bundles.es : c;
    const results = {};
    for (const flow of ['create', 'reveal', 'rotate', 'revoke', 'delete']) {
      const legacy = mode === 'legacy' ? await openLegacy({ browser: p.page.context().browser(), role: 'tenant_owner', locale: 'es', viewport, pageEndpoints: endpoints, route: manifest.route }) : null;
      const page = legacy ? legacy.page : p.page;
      const requests = legacy ? legacy.requests : p.network.requests;
      if (!legacy) await p.open(manifest.route);
      await expect(page.getByRole('table')).toBeVisible();
      const since = requests.length;
      const named = (kind) => page.getByRole('button', { name: fill(k.row[`${kind}Named`], { name: active.displayName }), exact: true });
      const confirm = async (act, label) => {
        const dialog = page.getByRole('alertdialog');
        if (mode === 'next' || act === 'delete') await (mode === 'next' ? dialog.getByRole('textbox', { name: k.confirm.typedName, exact: true }) : dialog.getByPlaceholder(active.displayName)).fill(active.displayName);
        await dialog.getByRole('button', { name: label, exact: true }).click();
      };
      let secret = null, credentialId = null;
      if (flow === 'create') { await page.getByRole('textbox', { name: k.create.nameLabel, exact: true }).fill('Created service'); await page.getByRole('button', { name: k.create.submit, exact: true }).click(); }
      else if (flow === 'reveal' || flow === 'rotate') {
        await named(flow === 'reveal' ? 'reveal' : 'rotate').click();
        if (flow === 'rotate' && mode === 'next') await confirm('rotate', k.confirm.rotate.action);
        const dialog = page.getByRole('dialog', { name: flow === 'reveal' ? k.disclosure.revealTitle : k.disclosure.rotateTitle });
        await expect(dialog).toBeVisible();
        credentialId = (await dialog.locator('dd').first().textContent())?.trim();
        if (mode === 'legacy') secret = (await dialog.locator('pre').textContent())?.trim();
        else if (flow === 'reveal') { await dialog.getByRole('button', { name: k.disclosure.show, exact: true }).click(); secret = await dialog.getByRole('textbox', { name: k.disclosure.secretValue, exact: true }).inputValue(); }
        else secret = (await dialog.getByText(rotatedSecret, { exact: true }).textContent())?.trim();
      } else if (flow === 'revoke') { await named('revoke').click(); await confirm('revoke', mode === 'legacy' ? 'Confirmar' : k.confirm.revoke.action); }
      else { await named('delete').click(); await confirm('delete', k.confirm.delete.action); }
      await page.waitForTimeout(500);
      results[flow] = { requests: requests.slice(since).filter(({ path }) => path.includes('/service-accounts')).map(({ method, path, body }) => ({ method, path, body })), secret, credentialId };
      if (legacy) { expect(legacy.faults).toEqual([]); await legacy.close(); }
    }
    return results;
  };
  const next = await run('next'), legacy = await run('legacy');
  for (const flow of Object.keys(next)) {
    // Successful requests, list refetch counts and the disclosed credential must match; the typed confirmation is the intended difference.
    expect(next[flow].requests, `parity: ${flow} requests`).toEqual(legacy[flow].requests);
    expect(next[flow].credentialId, `parity: ${flow} credential id`).toBe(legacy[flow].credentialId);
    expect(next[flow].secret, `parity: ${flow} secret`).toBe(legacy[flow].secret);
  }
  await info.attach('legacy-parity-summary', { body: JSON.stringify(Object.fromEntries(Object.entries(next).map(([flow, value]) => [flow, value.requests.map(({ method, path }) => `${method} ${path}`)])), null, 2), contentType: 'application/json' });
}
