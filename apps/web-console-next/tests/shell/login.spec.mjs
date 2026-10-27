import { readFileSync } from 'node:fs';
import { test, expect } from '../parity/harness.mjs';
import manifest, { loginPath } from '../parity/pages/login-page.manifest.ts';
import { loginToConsole } from '../parity/pages/login-helper.mjs';
import { assertRuntimeHealth, assertResponsive, assertAccessibility } from '../parity/checks.mjs';

// These login-only ports run against CI's /next/ build as well as the root build.
test.use({ pageEndpoints: manifest.endpoints, trace: 'off' });
for (const locale of ['es', 'en']) for (const width of [375, 768, 1280]) {
  const copy = JSON.parse(readFileSync(new URL(`../../src/locales/${locale}/pages.login-page.json`, import.meta.url), 'utf8'));
  test.describe(`login journeys | ${locale} | ${width}`, () => {
    test.use({ locale, viewport: { width, height: 900 } });
    test.beforeEach(async ({ parity }) => {
      await parity.page.addInitScript(() => {
        sessionStorage.removeItem('in-falcone.console-shell-session');
        sessionStorage.removeItem('in-falcone.console-protected-route');
      });
    });
    test('protected deep link restores its query and hash without a document request', async ({ parity, server }) => {
      const page = parity.page;
      await page.goto(server.url('console/settings?x=1#h'));
      await expect(page).toHaveURL(server.url('login'));
      await expect(page.getByRole('heading', { level: 1, name: copy.title, exact: true })).toBeVisible();
      await assertResponsive(parity, width); await assertAccessibility(parity);
      const documents = [];
      page.on('request', (request) => { if (request.resourceType() === 'document') documents.push(request.url()); });
      await page.evaluate(() => { window.__loginDocument = true; });
      await loginToConsole(page, copy, '  operations  ');
      await expect(page).toHaveURL(server.url('console/settings?x=1#h'));
      expect(await page.evaluate(() => window.__loginDocument)).toBe(true);
      expect(documents).toEqual([]);
      expect(parity.network.requests.filter((request) => request.path === loginPath)).toEqual([
        { method: 'POST', path: loginPath, body: { username: 'operations', password: 'synthetic-login-password', rememberMe: false } },
      ]);
      await assertRuntimeHealth(parity);
    });
    test('sign-out revokes the shared session and protects the next console visit', async ({ parity, server }) => {
      const page = parity.page;
      await parity.open('/login');
      await loginToConsole(page, copy);
      await expect(page).toHaveURL(server.url('console/overview'));
      await page.getByRole('button', { name: locale === 'es' ? 'Menú de usuario' : 'User menu', exact: true }).click();
      await page.getByRole('menuitem', { name: locale === 'es' ? 'Cerrar sesión' : 'Sign out', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: copy.title, exact: true })).toBeVisible();
      expect(await page.evaluate(() => sessionStorage.getItem('in-falcone.console-shell-session'))).toBeNull();
      expect(parity.network.requests.filter((request) => request.method === 'DELETE')).toEqual([
        { method: 'DELETE', path: '/v1/auth/login-sessions/synthetic-session', body: { refreshToken: 'synthetic-refresh-token' } },
      ]);
      await page.goto(server.url('console/overview'));
      await expect(page).toHaveURL(server.url('login'));
      await assertRuntimeHealth(parity);
    });
  });
}
