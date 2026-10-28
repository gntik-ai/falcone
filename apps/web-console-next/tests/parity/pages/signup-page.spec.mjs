import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { active, pending, policyPath, signupPath } from './signup-page.manifest.ts';
import { sessionFor } from '../fixtures/shell.ts';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';

// Credentials must never enter retained browser traces or visual attachments.
test.use({ trace: 'off' });
const copies = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.signup-page.json`, import.meta.url), 'utf8'))]));
const secret = 'super-secret-123';
const sessionKey = 'in-falcone.console-shell-session';
async function capture(page, info, state, locale, width) {
  const body = await page.screenshot({ fullPage: true, animations: 'disabled', mask: [page.locator('input[name="password"]')] });
  const hash = createHash('sha256').update(body).digest('hex');
  await info.attach(`${state}-${locale}-${width}-sha256-${hash}`, { body, contentType: 'image/png' });
}
for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`signup-page | tenant_owner | ${locale} | ${width}`, () => {
    const copy = copies[locale];
    test.use({ role: 'tenant_owner', locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity }) => {
      await parity.page.addInitScript(() => { sessionStorage.removeItem('in-falcone.console-shell-session'); });
      // The shared harness predates signup POST diagnostics. Admit only a browser
      // resource error matching an injected POST response at its exact URL.
      const injected = [];
      parity.page.on('response', (response) => {
        if (new URL(response.url()).pathname === signupPath && response.status() >= 400) injected.push({ url: response.url(), kind: String(response.status()) });
      });
      parity.page.on('requestfailed', (request) => {
        if (new URL(request.url()).pathname === signupPath) injected.push({ url: request.url(), kind: 'network' });
      });
      parity.page.on('console', (message) => {
        const text = message.text();
        // 422 is absent from the shared diagnostic helper's historical status list.
        const known = consumeResourceDiagnostic(text.replace('status of 422', 'status of 400'), message.location().url,
          injected.map((entry) => entry.kind === '422' ? { ...entry, kind: '400' } : entry));
        if (!known) return;
        const index = parity.faults.lastIndexOf(`console.error: ${text}`);
        if (index >= 0) parity.faults.splice(index, 1);
        const matched = injected.findIndex((entry) => entry.url === message.location().url);
        if (matched >= 0) injected.splice(matched, 1);
      });
    });
    const control = (page, name) => page.locator(`input[name="${name}"]`);
    const save = (page) => page.getByRole('button', { name: copy.submit, exact: true });
    async function open(parity, variants = {}, query = '') {
      await parity.open(`/signup${query}`, variants);
      await expect(parity.page.getByRole('heading', { level: 1, name: copy.title, exact: true })).toBeVisible();
    }
    async function ready(parity, variants = {}, query = '') { await open(parity, variants, query); await expect(save(parity.page)).toBeVisible(); }
    async function fill(page, { tenant = 'ten_console', workspace = '' } = {}) {
      for (const [name, value] of Object.entries({ username: 'nuevo-operador', displayName: 'Nuevo Operador', primaryEmail: 'nuevo@example.com', tenantId: tenant, workspaceId: workspace, password: secret })) await control(page, name).fill(value);
    }
    async function send(parity, variant = 'active') {
      await ready(parity, { signup: variant }); await fill(parity.page); await save(parity.page).click();
    }
    function requestBudget(parity, requests = parity.network.requests) {
      expect(requests.every(({ method, path }) => method === 'GET' && path === policyPath || method === 'POST' && path === signupPath)).toBe(true);
    }
    async function noLeaks(parity, output = []) {
      const exposed = await parity.page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage }, state: history.state, text: document.body.textContent }));
      expect(JSON.stringify(exposed)).not.toContain(secret);
      expect(output.join('\n')).not.toContain(secret);
    }
    test('data', async ({ parity }) => {
      await ready(parity, {}, '?tenantId=%20ten_console%20&workspaceId=%20wrk_console%20');
      const page = parity.page;
      await expect(page).toHaveTitle(copy.documentTitle);
      for (const [name, field] of Object.entries(copy.fields)) {
        await expect(control(page, name)).toHaveAttribute('placeholder', field.placeholder);
        await expect(control(page, name)).toHaveAccessibleName(field.label);
      }
      await expect(control(page, 'tenantId')).toHaveValue('ten_console');
      await expect(control(page, 'workspaceId')).toHaveValue('wrk_console');
      await expect(control(page, 'password')).toHaveAttribute('minlength', '12');
      await expect(page.getByText(copy.fields.password.help.replace('{min}', '12'), { exact: true })).toBeVisible();
      await expect(page.locator('body')).not.toContainText(/EP-\d|US-UI|Realm|\/v1\/|Acme|SSO/);
      await check.assertLocale(parity); requestBudget(parity);
      await ready(parity, {}, '?tenant=ten_alt');
      await expect(control(page, 'tenantId')).toHaveValue('ten_alt');
      await ready(parity);
      for (const name of Object.keys(copy.fields)) await expect(control(page, name)).toHaveValue('');
    });
    test('action', async ({ parity, server }) => {
      const page = parity.page;
      const output = [];
      page.on('console', (message) => output.push(message.text()));
      // Mirrored legacy signup journey and exact pending handoff fixture.
      for (const variant of ['success', 'statusPending']) {
        await ready(parity, { signup: variant }, '?tenantId=ten_console&workspaceId=wrk_console');
        await page.evaluate(() => { window.__signupDocument = true; });
        await fill(page, { workspace: 'wrk_console' });
        const start = parity.network.requests.length;
        const posted = page.waitForRequest((request) => new URL(request.url()).pathname === signupPath && request.method() === 'POST');
        await save(page).click();
        expect((await posted).headers()['idempotency-key']).toMatch(/^idem_/);
        await expect(page).toHaveURL(server.url('signup/pending-activation'));
        expect(await page.evaluate(() => window.__signupDocument)).toBe(true);
        const state = await page.evaluate(() => history.state.usr);
        expect(state).toEqual({ registrationId: pending.registrationId, state: variant === 'statusPending' ? 'active' : pending.state, statusView: pending.statusView, activationMode: pending.activationMode, createdAt: pending.createdAt, message: pending.message });
        expect(parity.network.requests.slice(start).filter(({ path }) => path === signupPath)).toEqual([{ method: 'POST', path: signupPath, body: { username: 'nuevo-operador', displayName: 'Nuevo Operador', primaryEmail: 'nuevo@example.com', password: secret, tenantId: 'ten_console', workspaceId: 'wrk_console' } }]);
        await expect(page.getByRole('region', { name: copy.notifications })).toContainText(copy.pendingTitle);
        await noLeaks(parity, output);
      }
      await send(parity);
      await expect(page.getByRole('group', { name: copy.successTitle })).toBeFocused();
      await expect(page.getByText(copy.reference.replace('{id}', active.registrationId))).toBeVisible();
      const loginUrl = new URL(server.url('login?tenantId=ten_console'));
      await expect(page.getByRole('link', { name: copy.continue })).toHaveAttribute('href', loginUrl.pathname + loginUrl.search);
      await expect(page.getByRole('region', { name: copy.notifications })).toContainText(copy.successTitle);
      await noLeaks(parity, output);
      await page.getByRole('link', { name: copy.continue }).click();
      await expect(page).toHaveURL(server.url('login?tenantId=ten_console'));
      await ready(parity, {}, '?tenantId=ten_console');
      await fill(page); await page.getByRole('button', { name: copy.discard }).click();
      await expect(control(page, 'username')).toHaveValue('');
      await expect(control(page, 'tenantId')).toHaveValue('ten_console');
      const budget = parity.network.requests.length;
      await save(page).click();
      await expect(control(page, 'username')).toBeFocused();
      expect(parity.network.requests.length).toBe(budget);
      await page.getByRole('link', { name: copy.homeLabel }).click();
      await expect(page).toHaveURL(server.url(''));
    });
    test('error-empty', async ({ parity, server }) => {
      const page = parity.page;
      await open(parity, { signupPolicy: { variant: 'success', delayMs: 1500 } });
      await expect(page.locator('form')).toHaveCount(0);
      // The skeleton repeats this text in an sr-only status label.
      const loadingCallout = page.getByRole('status', { name: copy.loadingTitle, exact: true });
      await expect(loadingCallout).toBeVisible();
      await expect(loadingCallout.locator('..')).toHaveAttribute('aria-busy', 'true');
      await expect(save(page)).toBeVisible();
      await open(parity, { signupPolicy: 'empty' });
      await expect(page.getByText(copy.disabledTitle, { exact: true })).toBeVisible();
      await expect(page.locator('form')).toHaveCount(0);
      for (const status of ['401', '403', '404', '500', 'network']) {
        await open(parity, { signupPolicy: status });
        if (status === '403' || status === '404') await expect(page.getByRole('heading', { name: status === '403' ? copy.disabledTitle : copy.notFoundTitle, exact: true })).toBeVisible();
        else {
          await expect(page.getByRole('heading', { name: copy.policyErrorTitle, exact: true })).toBeVisible();
          parity.network.setVariants({});
          const start = parity.network.requests.length;
          await page.getByRole('button', { name: copy.retry, exact: true }).click();
          await expect(save(page)).toBeVisible();
          expect(parity.network.requests.slice(start).map(({ method, path }) => ({ method, path }))).toEqual([{ method: 'GET', path: policyPath }]);
        }
      }
      for (const status of ['400', '401', '403', '404', '409', '422', '500', 'network']) {
        await send(parity, status);
        const title = status === '400' ? copy.invalidTitle : status === '403' ? copy.deniedTitle : status === '404' ? copy.notFoundTitle : status === '409' ? copy.conflictTitle : copy.submitErrorTitle;
        await expect(page.locator('#signup-feedback')).toContainText(title);
        await expect(control(page, 'username')).toHaveValue('nuevo-operador');
        await expect(page.locator('[data-live-announcer="assertive"]').last()).toContainText(title);
        if (status === '500' || status === 'network') {
          parity.network.setVariants({ signup: 'active' });
          await page.getByRole('button', { name: copy.retry, exact: true }).click();
          await expect(page.getByRole('group', { name: copy.successTitle })).toBeFocused();
        }
      }
      for (const endpoint of ['policy', 'submit']) for (const stored of [false, true]) {
        await ready(parity);
        const before = stored ? JSON.stringify(sessionFor('tenant_owner')) : null;
        await page.evaluate(({ key, before }) => { if (before) sessionStorage.setItem(key, before); else sessionStorage.removeItem(key); }, { key: sessionKey, before });
        if (endpoint === 'policy') {
          // A remount reads policy without rerunning document seed scripts.
          await page.getByRole('link', { name: copy.homeLabel }).click();
          parity.network.setVariants({ signupPolicy: '401' });
          await page.getByRole('link', { name: locale === 'es' ? 'Solicitar acceso' : 'Request access', exact: true }).click();
          await expect(page.getByRole('heading', { name: copy.policyErrorTitle, exact: true })).toBeVisible();
        } else {
          parity.network.setVariants({ signup: '401' });
          await fill(page); await save(page).click();
          await expect(page.locator('#signup-feedback')).toContainText(copy.submitErrorTitle);
        }
        await expect(page).toHaveURL(server.url('signup'));
        expect(await page.evaluate((key) => sessionStorage.getItem(key), sessionKey)).toBe(before);
      }
      requestBudget(parity);
      await check.assertRuntimeHealth(parity);
    });
    test('accessibility', async ({ parity }) => {
      const page = parity.page;
      await ready(parity);
      await control(page, 'username').focus();
      for (const name of ['username', 'displayName', 'primaryEmail', 'tenantId', 'workspaceId', 'password']) {
        await expect(control(page, name)).toBeFocused(); await page.keyboard.press('Tab');
      }
      await expect(page.getByRole('link', { name: copy.existing })).toBeFocused(); await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: copy.discard })).toBeFocused(); await page.keyboard.press('Tab');
      await expect(save(page)).toBeFocused();
      await check.assertAccessibility(parity);
      await save(page).click();
      await expect(control(page, 'username')).toBeFocused();
      await expect(page.getByRole('region', { name: copy.validationTitle })).toBeVisible();
      expect(await page.getByRole('region', { name: copy.validationTitle }).getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('href')))).toEqual(['#username', '#displayName', '#primaryEmail', '#tenantId', '#password']);
      await check.assertAccessibility(parity);
      for (const state of ['empty', '403', '404', '500']) { await open(parity, { signupPolicy: state }); await expect(page.locator('form')).toHaveCount(0); await check.assertAccessibility(parity); }
      await send(parity, 'active');
      await expect(page.getByRole('group', { name: copy.successTitle })).toBeFocused();
      await check.assertAccessibility(parity);
    });
    test('runtime-health', async ({ parity }) => {
      await ready(parity);
      await fill(parity.page); await save(parity.page).click();
      await expect(parity.page.getByRole('group', { name: copy.successTitle })).toHaveCount(0);
      await expect(parity.page).toHaveURL(/\/signup\/pending-activation$/);
      const own = parity.network.requests.filter(({ path }) => path !== '/v1/auth/status-views/pending_activation');
      requestBudget(parity, own);
      expect(own.map(({ method, path }) => ({ method, path }))).toEqual([{ method: 'GET', path: policyPath }, { method: 'POST', path: signupPath }]);
      await check.assertRuntimeHealth(parity);
    });
    test('responsive', async ({ parity }) => {
      for (const state of ['active', 'longActive', '403', '500']) {
        await send(parity, state);
        await expect(parity.page.locator(state === 'active' || state === 'longActive' ? '[role="group"]' : '#signup-feedback')).toBeVisible();
        await check.assertResponsive(parity, width);
      }
    });
    test('visual-review', async ({ parity }, info) => {
      await ready(parity); await capture(parity.page, info, 'enabled', locale, width);
      await save(parity.page).click(); await expect(control(parity.page, 'username')).toBeFocused();
      await capture(parity.page, info, 'required', locale, width);
      await open(parity, { signupPolicy: 'empty' }); await expect(parity.page.getByText(copy.disabledTitle, { exact: true })).toBeVisible();
      await capture(parity.page, info, 'disabled', locale, width);
      for (const state of ['403', '404', '409', '500', 'active']) {
        await send(parity, state);
        await expect(parity.page.locator(state === 'active' ? '[role="group"]' : '#signup-feedback')).toBeVisible();
        await check.assertLocale(parity);
        await capture(parity.page, info, state, locale, width);
      }
    });
    test('kit-conformance', async ({ parity }) => {
      await ready(parity); await check.kitConformance(manifest); await check.assertLocale(parity);
    });
  });
}
