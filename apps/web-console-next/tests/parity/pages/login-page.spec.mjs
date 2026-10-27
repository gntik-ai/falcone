import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import manifest, { loginPath, pendingPath } from './login-page.manifest.ts';
import { sessionFor } from '../fixtures/shell.ts';
import { test, expect } from '../harness.mjs';
import * as check from '../checks.mjs';
import { loginToConsole } from './login-helper.mjs';

// Never persist a trace of credential entry, including on test failure.
test.use({ trace: 'off' });

const copies = Object.fromEntries(['es', 'en'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../../../src/locales/${locale}/pages.login-page.json`, import.meta.url), 'utf8'))]));
const policyPath = '/v1/auth/signups/policy';
const refreshPath = '/v1/auth/login-sessions/synthetic-session/refresh';
const sessionKey = 'in-falcone.console-shell-session';
async function capture(page, info, state, locale, width) {
  const body = await page.screenshot({ fullPage: true, animations: 'disabled', mask: [page.locator('input[name="password"]')] });
  const sha256 = createHash('sha256').update(body).digest('hex');
  await info.attach(`${state}-${locale}-${width}-sha256-${sha256}`, { body, contentType: 'image/png' });
}
for (const role of manifest.roles) for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  test.describe(`login-page | ${role} | ${locale} | ${width}`, () => {
    const copy = copies[locale];
    // Credential entry is excluded from retained traces, including failures.
    test.use({ role, locale, viewport: { width, height: 900 }, pageEndpoints: manifest.endpoints });
    test.beforeEach(async ({ parity }) => {
      await parity.page.addInitScript(() => {
        sessionStorage.removeItem('in-falcone.console-shell-session');
        sessionStorage.removeItem('in-falcone.console-protected-route');
      });
    });
    const heading = (page) => page.getByRole('heading', { level: 1, name: copy.title, exact: true });
    const retry = (page) => page.getByRole('button', { name: copy.retry, exact: true });
    async function open(parity, variants = {}, query = '') {
      await parity.open(`/login${query}`, variants);
      await expect(heading(parity.page)).toBeVisible();
      await expect(parity.page.getByRole('button', { name: copy.labels.submit, exact: true })).toBeEnabled();
    }
    async function restricted(parity, outcome = 'success') {
      const initial = Array.isArray(outcome) ? outcome[0] : outcome;
      await open(parity, { login: 'auth.login-sessions.409-pending-activation', pending: outcome });
      await loginToConsole(parity.page, copy);
      await expect(parity.page.getByText(copy.statuses.pending_activation.title, { exact: true })).toBeVisible();
      if (initial !== 'success') await expect(parity.page.getByRole('heading', { name: initial === '403' ? copy.statusDeniedTitle : initial === '404' ? copy.statusMissingTitle : initial === 'network' ? copy.networkTitle : copy.statusErrorTitle, exact: true })).toBeVisible();
    }
    test('data', async ({ parity }) => {
      await open(parity, {}, '?tenantId=synthetic-tenant&workspaceId=synthetic-workspace');
      const page = parity.page;
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('link', { name: copy.labels.signup, exact: true })).toHaveAttribute('href', /\/signup\?tenantId=synthetic-tenant&workspaceId=synthetic-workspace$/);
      await expect(page.getByText(copy.contextBoth.replace('{tenantId}', 'synthetic-tenant').replace('{workspaceId}', 'synthetic-workspace'))).toBeVisible();
      await open(parity, { signupPolicy: 'empty' });
      await expect(page.getByText(copy.signupDisabledTitle, { exact: true })).toBeVisible();
      await expect(page.getByText(copy.invitationOnly)).toBeVisible();
      await expect(page.getByRole('link', { name: copy.labels.signup, exact: true })).toHaveCount(0);
      await open(parity, { login: 'auth.login-sessions.409-credentials-expired' });
      await loginToConsole(page, copy);
      await expect(page.getByText(copy.statuses.credentials_expired.title, { exact: true })).toBeVisible();
      await expect(page.getByText(copy.statuses.credentials_expired.message)).toBeVisible();
      await expect(page.getByRole('link', { name: copy.actions.recover_password, exact: true })).toHaveAttribute('href', /\/password-recovery\?source=status#recover$/);
      await expect(page.locator('body')).not.toContainText(/RAW_SERVER_TITLE|RAW_SERVER_LABEL|EP-\d+|US-UI|Acme|req_8f2c41d07a9b|SSO/);
    });
    test('action', async ({ parity, server }) => {
      const page = parity.page;
      // Ported protected deep-link journey; verify the /next/ build through server.url.
      await page.goto(server.url('console/settings?x=1#h'));
      await expect(page).toHaveURL(server.url('login'));
      await expect(heading(page)).toBeVisible();
      await page.evaluate(() => { window.__loginDocument = true; });
      await loginToConsole(page, copy, '  operations  ');
      await expect(page).toHaveURL(server.url('console/settings?x=1#h'));
      expect(await page.evaluate(() => window.__loginDocument)).toBe(true);
      expect(parity.network.requests.filter((request) => request.path === loginPath)).toEqual([{ method: 'POST', path: loginPath, body: { username: 'operations', password: 'synthetic-login-password', rememberMe: false } }]);
      // Ported sign-out journey: revoke, return to login and protect another visit.
      await page.getByRole('button', { name: locale === 'es' ? 'Menú de usuario' : 'User menu', exact: true }).click();
      await page.getByRole('menuitem', { name: locale === 'es' ? 'Cerrar sesión' : 'Sign out', exact: true }).click();
      await expect(heading(page)).toBeVisible();
      expect(await page.evaluate((key) => sessionStorage.getItem(key), sessionKey)).toBeNull();
      await page.goto(server.url('console/overview'));
      await expect(heading(page)).toBeVisible();
      for (const [area, variants] of [
        ['login', { login: ['500', 'success'] }], ['policy', { signupPolicy: ['500', 'success'] }],
        ['status', { login: 'auth.login-sessions.409-pending-activation', pending: ['500', 'success'] }],
      ]) {
        await open(parity, variants);
        if (area !== 'policy') await loginToConsole(page, copy);
        await expect(retry(page)).toBeVisible();
        const start = parity.network.requests.length;
        await retry(page).click();
        if (area === 'login') await expect(page).toHaveURL(server.url(role === 'tenant_viewer' ? 'console/observability' : 'console/overview'));
        else if (area === 'policy') await expect(page.getByRole('link', { name: copy.labels.signup, exact: true })).toBeFocused();
        else await expect(page.locator('[data-status]')).toBeFocused();
        const expected = area === 'login' ? loginPath : area === 'policy' ? policyPath : pendingPath;
        expect(parity.network.requests.slice(start).filter((request) => [loginPath, policyPath, pendingPath, refreshPath].includes(request.path)).map(({ method, path }) => ({ method, path }))).toEqual([{ method: area === 'login' ? 'POST' : 'GET', path: expected }]);
      }
      for (const expired of [true, false]) {
        await open(parity);
        const stored = sessionFor(role);
        if (expired) stored.expiresAt = stored.tokenSet.expiresAt = '2000-01-01T00:00:00Z';
        parity.network.setVariants({});
        await page.evaluate(({ stored, url }) => {
          sessionStorage.setItem('in-falcone.console-shell-session', JSON.stringify(stored));
          history.pushState({ idx: (history.state?.idx ?? 0) + 1 }, '', url);
          dispatchEvent(new PopStateEvent('popstate'));
        }, { stored, url: server.url('') });
        await expect(page.getByRole('heading', { name: locale === 'es' ? 'Consola In Falcone' : 'In Falcone Console', exact: true })).toBeVisible();
        const before = parity.network.requests.length;
        await page.getByRole('link', { name: locale === 'es' ? 'Ir al login' : 'Go to login', exact: true }).click();
        await expect(page).toHaveURL(server.url(role === 'tenant_viewer' ? 'console/observability' : 'console/overview'));
        const arrival = parity.network.requests.slice(before);
        expect(arrival.filter((request) => request.path === refreshPath)).toHaveLength(expired ? 1 : 0);
        expect(arrival.filter((request) => request.path === loginPath)).toHaveLength(0);
      }
    });
    test('error-empty', async ({ parity, server }) => {
      const page = parity.page;
      await open(parity);
      await page.getByRole('button', { name: copy.labels.submit, exact: true }).click();
      await expect(page.getByRole('alert')).toHaveCount(2);
      expect(parity.network.requests.filter((request) => request.path === loginPath)).toHaveLength(0);
      for (const variant of ['401', '403', '404', '500', 'network']) {
        await open(parity, { signupPolicy: variant });
        await expect(page.getByRole('heading', { name: variant === '403' ? copy.policyDeniedTitle : variant === '404' ? copy.policyMissingTitle : variant === 'network' ? copy.networkTitle : copy.policyErrorTitle, exact: true })).toBeVisible();
        await expect(page.getByText(copy.signupDisabledTitle, { exact: true })).toHaveCount(0);
        await expect(page.getByRole('link', { name: copy.labels.signup, exact: true })).toHaveCount(0);
        await restricted(parity, variant);
        if (variant === '500') await expect(page.getByText('synthetic-status-request', { exact: true })).toBeVisible();
      }
      await restricted(parity, '500-no-request-id');
      await expect(page.getByRole('button', { name: copy.copyRequestId, exact: true })).toHaveCount(0);
      for (const variant of ['400', '401', '403', '500', 'network']) {
        await open(parity, { login: variant }); await loginToConsole(page, copy);
        if (['400', '401', '403'].includes(variant)) await expect(page.getByRole('alert')).toContainText(copy.credentialTitle);
        else await expect(page.getByRole('heading', { name: variant === 'network' ? copy.networkTitle : copy.loginErrorTitle, exact: true })).toBeVisible();
      }
      for (const code of ['401', '504']) {
        const session = sessionFor(role); session.expiresAt = session.tokenSet.expiresAt = '2000-01-01T00:00:00Z';
        parity.network.setVariants({ refresh: code });
        await page.evaluate(({ session, key }) => {
          sessionStorage.setItem(key, JSON.stringify(session));
          sessionStorage.setItem('in-falcone.console-auth-status-hint', JSON.stringify({ statusView: 'login', title: 'RAW_HINT', message: 'RAW_HINT' }));
        }, { session, key: sessionKey });
        const before = parity.network.requests.length;
        // Router navigation preserves the seeded storage and does not run init scripts.
        await page.evaluate((url) => { history.pushState(null, '', url); dispatchEvent(new PopStateEvent('popstate')); }, server.url(''));
        await expect(page.getByRole('heading', { name: locale === 'es' ? 'Consola In Falcone' : 'In Falcone Console', exact: true })).toBeVisible();
        await page.getByRole('link', { name: locale === 'es' ? 'Ir al login' : 'Go to login', exact: true }).click();
        await expect(heading(page)).toBeVisible();
        await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), sessionKey)).toBeNull();
        await expect(page.getByText(copy.expiredHintTitle, { exact: true })).toBeVisible();
        expect(parity.network.requests.slice(before).filter((request) => request.path === refreshPath)).toHaveLength(code === '401' ? 1 : 2);
        expect(parity.network.requests.slice(before).filter((request) => request.path === loginPath)).toHaveLength(0);
      }
    });
    test('accessibility', async ({ parity, context }) => {
      const page = parity.page;
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await open(parity); await check.assertAccessibility(parity); await check.assertLocale(parity);
      await expect(page.getByLabel(copy.labels.username, { exact: true })).toBeFocused();
      for (const control of [
        page.getByLabel(copy.labels.password, { exact: true }), page.getByRole('checkbox', { name: copy.labels.rememberMe, exact: true }),
        page.getByRole('button', { name: copy.labels.submit, exact: true }), page.getByRole('link', { name: copy.labels.passwordRecovery, exact: true }),
        page.getByRole('link', { name: copy.labels.signup, exact: true }),
      ]) {
        await page.keyboard.press('Tab');
        await expect(control).toBeFocused();
        expect(await control.evaluate((node) => {
          const hasOutline = (element) => { const style = getComputedStyle(element); return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0; };
          return hasOutline(node) || hasOutline(node.parentElement);
        })).toBe(true);
      }
      for (const area of ['policy', 'status']) for (const variant of ['403', '404']) {
        if (area === 'policy') await open(parity, { signupPolicy: variant }); else await restricted(parity, variant);
        const before = parity.network.requests.length;
        await page.getByRole('button', { name: copy.returnToForm, exact: true }).click();
        await expect(page.getByLabel(copy.labels.username, { exact: true })).toBeFocused();
        expect(parity.network.requests).toHaveLength(before);
        await check.assertAccessibility(parity);
      }
      await restricted(parity, '500');
      const before = parity.network.requests.length;
      const copyButton = page.getByRole('button', { name: copy.copyRequestId, exact: true });
      await copyButton.focus(); await page.keyboard.press('Enter');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('synthetic-status-request');
      expect(parity.network.requests).toHaveLength(before);
      await expect(page.getByText(copy.copied, { exact: true }).first()).toBeVisible();
      await check.assertAccessibility(parity); await check.assertLocale(parity);
    });
    test('runtime-health', async ({ parity, server }) => {
      const page = parity.page, output = [];
      page.on('console', (message) => output.push(message.text()));
      for (const variants of [{ signupPolicy: '401' }, { signupPolicy: ['network', 'success'] }]) {
        await open(parity, variants);
        await retry(page).click();
        await expect(heading(page)).toBeVisible();
        await expect(page).toHaveURL(server.url('login'));
      }
      await restricted(parity, '401');
      expect(parity.network.requests.filter((request) => request.path === refreshPath)).toHaveLength(0);
      await restricted(parity, ['network', 'success']);
      await retry(page).click(); await expect(page.locator('[data-status]')).toBeFocused();
      await page.getByRole('link', { name: copy.labels.passwordRecovery, exact: true }).click();
      await expect(page).toHaveURL(server.url('password-recovery'));
      await open(parity);
      await page.getByRole('link', { name: copy.labels.signup, exact: true }).click();
      await expect(page).toHaveURL(server.url('signup'));
      expect(output.join('\n')).not.toContain('synthetic-login-password');
      for (const request of parity.network.requests) if (request.path !== loginPath) expect(JSON.stringify(request)).not.toContain('synthetic-login-password');
      await check.assertRuntimeHealth(parity);
    });
    test('responsive', async ({ parity }) => {
      for (const variant of ['success', '500', '404']) {
        await open(parity, { signupPolicy: variant }); await check.assertResponsive(parity, width);
      }
      for (const variant of ['403', '500']) { await restricted(parity, variant); await check.assertResponsive(parity, width); }
      const form = await parity.page.locator('form').boundingBox();
      const aside = await parity.page.getByRole('region', { name: copy.asideTitle, exact: true }).boundingBox();
      expect(aside.y).toBeGreaterThan(form.y + form.height);
    });
    test('visual-review', async ({ parity }, info) => {
      // SHA256 artifacts require independent checker assessment and operator approval.
      for (const variant of ['success', 'empty', '403', '500']) {
        await open(parity, { signupPolicy: variant }); await check.assertLocale(parity);
        await capture(parity.page, info, `policy-${variant}`, locale, width);
      }
      await open(parity, { signupPolicy: { variant: 'success', delayMs: 2000 } });
      await capture(parity.page, info, 'policy-loading', locale, width);
      await open(parity); await parity.page.getByRole('button', { name: copy.labels.submit, exact: true }).click();
      await capture(parity.page, info, 'required', locale, width);
      for (const variant of ['401', '403', '500']) {
        await open(parity, { login: variant }); await loginToConsole(parity.page, copy);
        await expect(parity.page.getByText(copy.credentialTitle, { exact: true }).first().or(parity.page.getByRole('heading', { name: copy.loginErrorTitle, exact: true }))).toBeVisible();
        await capture(parity.page, info, `login-${variant}`, locale, width);
      }
      for (const variant of ['success', '403', '404', '500', 'network']) {
        await restricted(parity, variant); await check.assertLocale(parity);
        await capture(parity.page, info, `status-${variant}`, locale, width);
      }
    });
    test('kit-conformance', async () => { await check.kitConformance(manifest); });
  });
}
