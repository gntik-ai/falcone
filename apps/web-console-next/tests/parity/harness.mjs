import { test as base, expect } from '@playwright/test';
import { startServer } from '../csp/server.mjs';
import { sessionFor } from './fixtures/shell.ts';
import { createParityNetwork } from './network.ts';

export { expect };
export const test = base.extend({
  role: ['superadmin', { option: true }],
  server: [async ({}, use) => {
    const server = await startServer();
    try { await use(server); } finally { await server.close(); }
  }, { scope: 'worker' }],
  parity: [async ({ page, server, role, locale }, use) => {
    const requests = [], unmatched = [], faults = [];
    const fixtures = createParityNetwork(role);
    await page.clock.setFixedTime(new Date('2026-06-01T12:00:00Z'));
    await page.exposeBinding('__parityFault', (_, message) => { faults.push(message); });
    page.on('pageerror', (error) => faults.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error' || /#426|suspended while responding to synchronous input/i.test(message.text())) faults.push(`console.${message.type()}: ${message.text()}`);
    });
    await page.addInitScript(({ session, locale }) => {
      let seed = 1075;
      Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
      sessionStorage.setItem('in-falcone.console-shell-session', JSON.stringify(session));
      localStorage.setItem('falcone-next-locale', locale);
      localStorage.setItem('falcone-next-theme', 'dark');
      localStorage.removeItem('in-falcone.console-active-context');
      window.addEventListener('unhandledrejection', (event) => { void window.__parityFault(`unhandledrejection: ${event.reason}`); });
      window.addEventListener('securitypolicyviolation', (event) => { void window.__parityFault(`securitypolicyviolation: ${event.violatedDirective}`); }, true);
    }, { session: sessionFor(role), locale });
    // No browser request may leave the local test server.
    await page.route('**/*', async (route) => {
      if (new URL(route.request().url()).origin === server.origin) return route.continue();
      unmatched.push(`External request ${route.request().method()} ${new URL(route.request().url()).pathname}`);
      await route.abort();
    });
    await page.route('**/v1/**', async (route) => {
      const request = route.request(), url = new URL(request.url());
      const method = request.method(), path = url.pathname;
      if (url.origin !== server.origin) {
        unmatched.push(`External request ${method} ${path}`);
        await route.abort();
        return;
      }
      let body;
      try { body = request.postDataJSON() ?? undefined; } catch { body = request.postData(); }
      requests.push({ method, path: path + url.search, body });
      const response = await fixtures.respond(method, path);
      if (!response) {
        unmatched.push(`${method} ${path}${url.search}`);
        await route.fulfill({ status: 404, json: { error_msg: '404 Route Not Found' } });
        return;
      }
      if (response.network) await route.abort('failed');
      else await route.fulfill({ status: response.status, json: response.body });
    });
    const network = { requests, registerEndpoints: fixtures.registerEndpoints, setVariants: fixtures.setVariants };
    const parity = {
      page, locale, role, network, faults,
      async open(route, variants = {}, { waitForReady = true } = {}) {
        fixtures.setVariants(variants);
        await page.goto(server.url(route.replace(/^\//, '')));
        if (!waitForReady) return;
        await expect(page.locator('main')).toBeVisible();
        await expect(page.locator('main h1')).toBeVisible();
        await expect(page.locator('main section[aria-busy="true"]')).toHaveCount(0);
        const context = page.getByRole('region', { name: locale === 'es' ? 'Contexto activo' : 'Active context', exact: true });
        if (await context.count()) await expect(context).toHaveAttribute('aria-busy', 'false');
        await page.evaluate(() => document.fonts.ready);
      },
    };
    try { await use(parity); }
    finally { expect(unmatched, `Unmatched requests:\n${unmatched.join('\n')}`).toEqual([]); }
  }, { auto: true }],
});
