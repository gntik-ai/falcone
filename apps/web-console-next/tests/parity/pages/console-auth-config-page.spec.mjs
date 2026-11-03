import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { callbackUrl, configPath, forbiddenReason, providerPath, syntheticSecret } from './console-auth-config-page.manifest.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';
import { seedHistoryPrincipal } from './console-flow-history-page.session.mjs';
const bundles = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.console-auth-config-page.json`, import.meta.url), 'utf8'))]));
const copy = (parity) => bundles[parity.locale];
const surface = (parity) => parity.page.getByTestId('console-auth-config-page');
const named = (text, name) => text.replace('{name}', name);
const button = (parity, key, name) => surface(parity).getByRole('button', { name: name ? named(copy(parity)[key], name) : copy(parity)[key], exact: true });
const box = (parity, key) => surface(parity).getByRole('checkbox', { name: copy(parity).methods[key].label });
const row = (parity, name) => surface(parity).getByRole('table', { name: copy(parity).providersTable, exact: true }).getByRole('row').filter({ hasText: name });
const configCalls = (parity) => parity.network.requests.filter(({ path }) => path.startsWith(`/v1/tenants/synthetic-tenant/auth-config`));
const writes = (parity) => configCalls(parity).filter(({ method }) => method !== 'GET');
const pickTemplate = async (parity, dialog, label) => { await dialog.getByRole('combobox', { name: copy(parity).fieldTemplate, exact: true }).click(); await parity.page.getByRole('option', { name: label, exact: true }).click(); };
const providerDialog = (parity) => parity.page.getByRole('dialog', { name: new RegExp(`^(${bundles[parity.locale].dialogCreateTitle}|${bundles[parity.locale].dialogEditTitle})$`) });
async function ready(parity) { await expect(surface(parity).getByRole('group', { name: copy(parity).methodsTitle, exact: true })).toBeVisible(); }
async function screenshot(parity, info, name) {
  const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
  await info.attach(`${name}-${parity.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}
async function openCreate(parity, variants = {}) {
  await parity.open(manifest.route, variants); await ready(parity);
  await button(parity, 'createProvider').click();
  return providerDialog(parity);
}
async function fillCreate(parity, dialog) {
  await pickTemplate(parity, dialog, 'GitHub');
  await dialog.getByLabel(copy(parity).fieldClientId, { exact: false }).first().fill('synthetic-github-client');
  await dialog.getByLabel(copy(parity).fieldSecret, { exact: false }).first().fill(syntheticSecret);
}
const githubBody = { providerId: 'github', displayName: '', enabled: true, config: { clientId: 'synthetic-github-client', defaultScope: '', clientSecret: syntheticSecret } };

for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`console-auth-config-page | tenant_owner | ${locale} | ${width}`, () => {
    test.use({ role: 'tenant_owner', locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity }) => {
      const injected = [];
      const scoped = (url) => new URL(url).pathname.startsWith('/v1/tenants/synthetic-tenant/auth-config');
      parity.page.on('response', (response) => { if (scoped(response.url()) && response.status() >= 400) injected.push({ url: response.url(), kind: String(response.status()) }); });
      parity.page.on('requestfailed', (request) => { if (scoped(request.url())) injected.push({ url: request.url(), kind: 'network' }); });
      parity.page.on('console', (message) => {
        if (message.type() !== 'error' || !consumeResourceDiagnostic(message.text(), message.location().url, injected)) return;
        const index = parity.faults.indexOf(`console.error: ${message.text()}`);
        if (index >= 0) parity.faults.splice(index, 1);
      });
    });
    test('data', async ({ parity }) => {
      await parity.open(manifest.route); await ready(parity);
      const c = copy(parity);
      await expect(surface(parity).getByRole('heading', { name: c.title, level: 1 })).toBeVisible();
      await expect(surface(parity).getByText('synthetic-realm', { exact: true })).toBeVisible();
      const expected = { registrationAllowed: 'false', loginWithEmailAllowed: 'true', resetPasswordAllowed: 'true', rememberMe: 'false', verifyEmail: 'false' };
      for (const [key, value] of Object.entries(expected)) await expect(box(parity, key)).toHaveAttribute('aria-checked', value);
      await expect(surface(parity).getByRole('toolbar', { name: c.toolbarLabel, exact: true })).toBeVisible();
      const google = row(parity, 'Google'), gitlab = row(parity, 'GitLab');
      for (const text of ['google', c.enabled, c.secretSet, callbackUrl]) await expect(google).toContainText(text);
      for (const text of [c.disabled, c.secretNotSet, '/realms/synthetic-realm/broker/gitlab/endpoint']) await expect(gitlab).toContainText(text);
      expect(configCalls(parity)).toEqual([{ method: 'GET', path: configPath, body: undefined }]);
      await check.assertLocale(parity);
    });
    test('action', async ({ parity }) => {
      await parity.page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
      const c = copy(parity);
      await parity.open(manifest.route, { 'auth-config-put': 'success' }); await ready(parity);
      // Login methods: only the two changed keys are sent, the form re-seeds and the result region takes focus.
      await expect(button(parity, 'save')).toBeDisabled();
      await box(parity, 'registrationAllowed').click(); await box(parity, 'rememberMe').click();
      await expect(button(parity, 'save')).toBeEnabled();
      await button(parity, 'save').click();
      const region = surface(parity).getByRole('region', { name: c.announcementRegion, exact: true });
      await expect(region).toContainText(c.saved); await expect(region).toBeFocused();
      expect(writes(parity)).toEqual([{ method: 'PUT', path: configPath, body: { registrationAllowed: true, rememberMe: true } }]);
      await expect(box(parity, 'registrationAllowed')).toHaveAttribute('aria-checked', 'true');
      // Descartar sends nothing; Recargar reissues the GET.
      await box(parity, 'verifyEmail').click(); await button(parity, 'discard').click();
      await expect(box(parity, 'verifyEmail')).toHaveAttribute('aria-checked', 'false');
      expect(writes(parity)).toHaveLength(1);
      const reads = configCalls(parity).filter(({ method }) => method === 'GET').length;
      await parity.page.getByRole('button', { name: c.reload, exact: true }).first().click(); await ready(parity);
      expect(configCalls(parity).filter(({ method }) => method === 'GET')).toHaveLength(reads + 1);
      // Copiar URL copies and announces it.
      await surface(parity).getByRole('button', { name: named(c.copyUrlNamed, 'Google'), exact: true }).click();
      await expect(surface(parity).getByRole('region', { name: c.announcementRegion, exact: true })).toContainText(c.urlCopied);
      // Create: the synthetic secret travels only in this request body.
      const dialog = await openCreate(parity); await fillCreate(parity, dialog);
      await dialog.getByRole('button', { name: c.dialogSave, exact: true }).click();
      await expect(providerDialog(parity)).toHaveCount(0); await expect(row(parity, 'GitHub')).toBeVisible();
      expect(writes(parity).at(-1)).toEqual({ method: 'PUT', path: providerPath('github'), body: githubBody });
      await expect(surface(parity).getByRole('region', { name: c.announcementRegion, exact: true })).toContainText(c.providerUpdated);
      // Edit with an empty secret omits clientSecret and keeps the secret badge.
      await parity.open(manifest.route); await ready(parity);
      await button(parity, 'editNamed', 'Google').click();
      const editor = providerDialog(parity);
      await expect(editor.getByLabel(c.fieldSecret, { exact: false }).first()).toHaveValue('');
      await editor.getByLabel(c.fieldName, { exact: false }).first().fill('Updated');
      await editor.getByRole('button', { name: c.dialogSave, exact: true }).click();
      await expect(row(parity, 'Updated')).toContainText(c.secretSet);
      expect(writes(parity).at(-1)).toEqual({ method: 'PUT', path: providerPath('google'), body: { providerId: 'google', displayName: 'Updated', enabled: true, config: { clientId: 'synthetic-google-client', defaultScope: 'openid email' } } });
      // Toggle sends only the provider id and the inverted flag.
      await parity.open(manifest.route); await ready(parity);
      await button(parity, 'disableNamed', 'Google').click();
      await expect(button(parity, 'enableNamed', 'Google')).toBeVisible();
      expect(writes(parity).at(-1)).toEqual({ method: 'PUT', path: providerPath('google'), body: { providerId: 'google', enabled: false } });
      // Delete is confirmed, then sent, announced and followed by a reload.
      await parity.open(manifest.route, { 'auth-config-get': ['success-two-providers', 'after-delete'] }); await ready(parity);
      const before = configCalls(parity).length;
      await button(parity, 'deleteNamed', 'Google').click();
      const confirm = parity.page.getByRole('alertdialog');
      await expect(confirm).toContainText(c.deleteImpact);
      await confirm.getByRole('button', { name: c.deleteConfirm, exact: true }).click();
      await expect(row(parity, 'Google')).toHaveCount(0);
      await expect(surface(parity).getByRole('region', { name: c.announcementRegion, exact: true })).toContainText(named(c.providerDeleted, 'Google'));
      expect(configCalls(parity).slice(before).map(({ method, path }) => `${method} ${path}`)).toEqual([`DELETE ${providerPath('google')}`, `GET ${configPath}`]);
    });
    test('error-empty', async ({ parity }) => {
      const c = copy(parity);
      // No organisation: an empty state and no auth-config request.
      await parity.open(manifest.route, { tenant: 'empty', tenants: 'empty' });
      await expect(surface(parity).getByRole('heading', { name: c.selectOrganization, exact: true })).toBeVisible(); expect(configCalls(parity)).toHaveLength(0);
      await check.assertLocale(parity);
      // No providers: first-run empty state with the realm and Crear proveedor.
      await parity.open(manifest.route, { 'auth-config-get': 'no-providers' });
      await expect(surface(parity).getByRole('heading', { name: c.emptyProviders, exact: true })).toBeVisible();
      await expect(button(parity, 'createProvider')).toBeVisible(); await expect(surface(parity).getByRole('table')).toHaveCount(0);
      await check.assertAccessibility(parity);
      // Read failures.
      await parity.open(manifest.route, { 'auth-config-get': '403' });
      await expect(surface(parity).getByRole('heading', { name: c.noAccess, exact: true })).toBeVisible();
      await expect(surface(parity).getByText(c.errors['403'], { exact: true })).toBeVisible();
      await expect(parity.page.getByText(forbiddenReason)).toHaveCount(0);
      await expect(surface(parity).getByRole('checkbox')).toHaveCount(0);
      await check.assertLocale(parity); await check.assertAccessibility(parity);
      await parity.open(manifest.route, { 'auth-config-get': '404' });
      await expect(surface(parity).getByRole('link', { name: c.backToOverview, exact: true })).toHaveAttribute('href', /\/console\/overview$/);
      await parity.open(manifest.route, { 'auth-config-get': ['500', 'success-two-providers'] });
      await expect(surface(parity).getByText('req_synthetic_auth_config_500', { exact: true })).toBeVisible();
      await check.assertAccessibility(parity);
      await surface(parity).getByRole('button', { name: c.retry, exact: true }).click(); await ready(parity);
      await parity.open(manifest.route, { 'auth-config-get': ['success-two-providers', 'network'] }); await ready(parity);
      await parity.page.getByRole('button', { name: c.reload, exact: true }).first().click();
      await expect(surface(parity).getByRole('heading', { name: c.loadError, exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('checkbox')).toHaveCount(0); await expect(surface(parity).getByRole('table')).toHaveCount(0);
      // A failed save keeps the draft.
      for (const variant of ['403', '500']) {
        await parity.open(manifest.route, { 'auth-config-put': variant }); await ready(parity);
        await box(parity, 'verifyEmail').click(); await button(parity, 'save').click();
        await expect(surface(parity).getByText(variant === '403' ? c.errors['403'] : c.errors['5xx'], { exact: true }).first()).toBeVisible();
        await expect(box(parity, 'verifyEmail')).toHaveAttribute('aria-checked', 'true'); await expect(button(parity, 'save')).toBeEnabled();
      }
      // Provider failures: toggle 409 and 403.
      for (const [variant, message] of [['409', c.providerConflict], ['403', c.errors['403']]]) {
        await parity.open(manifest.route, { 'auth-config-idp-google': variant }); await ready(parity);
        await button(parity, 'disableNamed', 'Google').click();
        await expect(surface(parity).getByText(message, { exact: true }).first()).toBeVisible();
      }
      // Dialog 500 keeps the other fields and clears the secret; the secret never reaches the DOM.
      const dialog = await openCreate(parity, { 'auth-config-idp-create': '500' }); await fillCreate(parity, dialog);
      await dialog.getByRole('button', { name: c.dialogSave, exact: true }).click();
      await expect(dialog.getByText(c.errors['5xx'], { exact: true })).toBeVisible();
      await expect(dialog.getByLabel(c.fieldClientId, { exact: false }).first()).toHaveValue('synthetic-github-client');
      await expect(dialog.getByLabel(c.fieldSecret, { exact: false }).first()).toHaveValue('');
      expect(await parity.page.content()).not.toContain(syntheticSecret);
      // Duplicate alias on create: message shown, submit blocked, nothing sent.
      await parity.open(manifest.route); await ready(parity);
      const start = writes(parity).length;
      await button(parity, 'createProvider').click();
      const duplicate = providerDialog(parity);
      await expect(duplicate.getByText(c.duplicateAlias, { exact: true }).first()).toBeVisible();
      await expect(duplicate.getByRole('button', { name: c.dialogSave, exact: true })).toBeDisabled();
      expect(writes(parity)).toHaveLength(start);
      // Delete: cancel sends nothing, a 500 keeps the confirmation open with its error.
      await parity.open(manifest.route, { 'auth-config-idp-delete': '500' }); await ready(parity);
      // The harness keeps every request of the test, so compare against a checkpoint taken before this scenario.
      const checkpoint = writes(parity).length;
      const trigger = button(parity, 'deleteNamed', 'Google');
      await trigger.click(); await parity.page.getByRole('alertdialog').getByRole('button', { name: c.cancel, exact: true }).click();
      await expect(parity.page.getByRole('alertdialog')).toHaveCount(0); await expect(trigger).toBeFocused();
      expect(writes(parity).slice(checkpoint)).toHaveLength(0);
      await trigger.click(); await parity.page.getByRole('alertdialog').getByRole('button', { name: c.deleteConfirm, exact: true }).click();
      await expect(parity.page.getByRole('alertdialog').getByText(c.errors['5xx'], { exact: true })).toBeVisible();
      expect(writes(parity).slice(checkpoint)).toEqual([{ method: 'DELETE', path: providerPath('google'), body: undefined }]);
    });
    test('accessibility', async ({ parity }) => {
      const c = copy(parity);
      await parity.open(manifest.route); await ready(parity); await check.assertAccessibility(parity);
      await expect(surface(parity).getByRole('group', { name: c.methodsTitle, exact: true }).getByRole('checkbox')).toHaveCount(5);
      // Keyboard path: checkbox, Descartar, Guardar; focus lands on the result region after saving.
      await box(parity, 'verifyEmail').focus(); await parity.page.keyboard.press('Space');
      await expect(box(parity, 'verifyEmail')).toHaveAttribute('aria-checked', 'true');
      await button(parity, 'discard').focus(); await expect(button(parity, 'discard')).toBeFocused();
      await parity.page.keyboard.press('Tab'); await expect(button(parity, 'save')).toBeFocused();
      parity.network.setVariants({ 'auth-config-put': 'success' });
      await parity.page.keyboard.press('Enter');
      await expect(surface(parity).getByRole('region', { name: c.announcementRegion, exact: true })).toBeFocused();
      // The dialog returns focus to its trigger and the secret is described by its help text.
      const trigger = button(parity, 'editNamed', 'Google'); await trigger.focus(); await parity.page.keyboard.press('Enter');
      const dialog = providerDialog(parity); await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel(c.fieldSecret, { exact: false }).first()).toHaveAccessibleDescription(c.fieldSecretSetHelp);
      await check.assertAccessibility(parity); await check.assertLocale(parity);
      await parity.page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
      const remove = button(parity, 'deleteNamed', 'Google'); await remove.focus(); await parity.page.keyboard.press('Enter');
      await expect(parity.page.getByRole('alertdialog')).toBeVisible(); await check.assertAccessibility(parity);
      await parity.page.keyboard.press('Escape'); await expect(parity.page.getByRole('alertdialog')).toHaveCount(0); await expect(remove).toBeFocused();
    });
    test('runtime-health', async ({ parity }) => {
      const c = copy(parity);
      const logs = [];
      parity.page.on('console', (message) => logs.push(message.text()));
      await parity.open('/console/overview');
      if (width < 1024) await parity.page.getByRole('button', { name: locale === 'es' ? 'Abrir navegación' : 'Open navigation', exact: true }).click();
      const link = parity.page.getByRole('link', { name: locale === 'es' ? 'Autenticación de la organización' : 'Tenant authentication', exact: true }).first();
      await expect(link).toHaveAttribute('href', /\/console\/auth-config$/);
      let documents = 0;
      parity.page.on('request', (request) => { if (request.isNavigationRequest() && request.frame() === parity.page.mainFrame()) documents++; });
      await link.click(); await ready(parity); expect(documents).toBe(0);
      // Loading, saving and the dialogs; the secret appears only in the create request body.
      await box(parity, 'verifyEmail').click(); parity.network.setVariants({ 'auth-config-put': 'success' }); await button(parity, 'save').click();
      await expect(surface(parity).getByRole('region', { name: c.announcementRegion, exact: true })).toBeVisible();
      const dialog = await openCreate(parity, { 'auth-config-idp-create': 'create-success' }); await fillCreate(parity, dialog);
      await dialog.getByRole('button', { name: c.dialogSave, exact: true }).click();
      await expect(row(parity, 'GitHub')).toBeVisible();
      await button(parity, 'deleteNamed', 'GitHub').click(); await parity.page.getByRole('alertdialog').getByRole('button', { name: c.cancel, exact: true }).click();
      expect(await parity.page.content()).not.toContain(syntheticSecret);
      expect(await parity.page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]))).not.toContain(syntheticSecret);
      expect(logs.join('\n')).not.toContain(syntheticSecret);
      expect(parity.network.requests.filter(({ body }) => JSON.stringify(body ?? '').includes(syntheticSecret))).toHaveLength(1);
      await check.assertRuntimeHealth(parity);
      // 401 refreshes once, then replays.
      await parity.open(manifest.route, { 'auth-config-get': ['401', 'success-two-providers'] }); await ready(parity);
      expect(configCalls(parity).slice(-2)).toEqual(Array(2).fill({ method: 'GET', path: configPath, body: undefined }));
      expect(parity.network.requests.filter(({ path }) => path.endsWith('/refresh'))).toHaveLength(1);
      await parity.open(manifest.route, { 'auth-config-get': '401', refresh: '401' });
      await expect(parity.page.getByRole('heading', { name: locale === 'es' ? 'Accede a In Falcone Console' : 'Sign in to In Falcone Console', exact: true })).toBeVisible();
    });
    test('responsive', async ({ parity }) => {
      await parity.open(manifest.route); await ready(parity); await check.assertResponsive(parity, width);
      const c = copy(parity);
      await box(parity, 'verifyEmail').click();
      await button(parity, 'save').scrollIntoViewIfNeeded(); await expect(button(parity, 'save')).toBeInViewport();
      await expect(button(parity, 'createProvider')).toBeVisible(); await button(parity, 'createProvider').scrollIntoViewIfNeeded();
      for (const key of ['editNamed', 'disableNamed', 'deleteNamed']) {
        const action = button(parity, key, 'Google'); await action.scrollIntoViewIfNeeded(); await expect(action).toBeEnabled();
      }
      const url = surface(parity).getByText(callbackUrl, { exact: true });
      await url.scrollIntoViewIfNeeded(); await check.assertResponsive(parity, width);
      expect(await url.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await button(parity, 'createProvider').click();
      // An open modal hides the main landmark from the accessibility tree, so measure the document and the dialog directly.
      const dialog = providerDialog(parity); await expect(dialog).toBeVisible();
      const sizes = await parity.page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      expect(sizes.scrollWidth, `responsive: horizontal overflow with the dialog open at ${width}px`).toBeLessThanOrEqual(sizes.clientWidth);
      const bounds = await dialog.boundingBox();
      expect(bounds.x, `responsive: dialog left edge at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width, `responsive: dialog right edge at ${width}px`).toBeLessThanOrEqual(width);
      await expect(dialog.getByRole('button', { name: c.dialogSave, exact: true })).toBeVisible();
    });
    test('visual-review', async ({ parity }, info) => {
      const c = copy(parity);
      const cases = [
        ['loaded', {}, async () => { await ready(parity); }],
        ['dirty', {}, async () => { await ready(parity); await box(parity, 'verifyEmail').click(); await expect(surface(parity).getByText(c.unsaved, { exact: true })).toBeVisible(); }],
        ['empty', { 'auth-config-get': 'no-providers' }, async () => { await expect(surface(parity).getByRole('heading', { name: c.emptyProviders, exact: true })).toBeVisible(); }],
        ['no-access', { 'auth-config-get': '403' }, async () => { await expect(surface(parity).getByRole('heading', { name: c.noAccess, exact: true })).toBeVisible(); }],
        ['error', { 'auth-config-get': '500' }, async () => { await expect(surface(parity).getByRole('heading', { name: c.loadError, exact: true })).toBeVisible(); await expect(surface(parity).getByText('req_synthetic_auth_config_500', { exact: true })).toBeVisible(); }],
      ];
      for (const [name, variants, act] of cases) {
        await parity.open(manifest.route, variants); await act();
        await check.assertLocale(parity); await screenshot(parity, info, name);
      }
    });
    test('kit-conformance', async ({ parity }) => {
      await check.kitConformance(manifest); await parity.open(manifest.route); await ready(parity);
      await expect(surface(parity).getByRole('searchbox')).toHaveCount(0);
      await expect(surface(parity).getByRole('group', { name: copy(parity).methodsTitle, exact: true }).getByRole('checkbox')).toHaveCount(5);
      await check.assertLocale(parity);
    });
  });
}

// A read-only user: same page, no controls that change anything.
for (const locale of ['es', 'en']) {
  test.describe(`console-auth-config-page | tenant_viewer | ${locale}`, () => {
    test.use({ role: 'tenant_viewer', locale, viewport: { width: 1280, height: 900 }, pageEndpoints: manifest.endpoints });
    test('read-only view', async ({ parity }, info) => {
      const c = copy(parity);
      await parity.open(manifest.route); await ready(parity);
      for (const key of Object.keys(c.methods)) await expect(box(parity, key)).toBeDisabled();
      for (const name of [c.save, c.discard, c.createProvider]) await expect(surface(parity).getByRole('button', { name, exact: true })).toHaveCount(0);
      await expect(surface(parity).getByRole('toolbar')).toHaveCount(0);
      await expect(surface(parity).getByText(c.providersDescriptionRead, { exact: true })).toBeVisible();
      await expect(surface(parity).getByRole('button', { name: named(c.editNamed, 'Google') })).toHaveCount(0);
      expect(writes(parity)).toHaveLength(0);
      await check.assertLocale(parity); await check.assertAccessibility(parity); await screenshot(parity, info, 'read-only');
    });
  });
}
