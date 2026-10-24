import { test as base, expect } from '@playwright/test';
import { startServer } from '../csp/server.mjs';
import { endpoints, responseFor, sessionFor } from './fixtures/shell.ts';
import { createEndpointRegistry } from './endpoint-registry.ts';
import { consumeResourceDiagnostic } from './resource-diagnostics.mjs';

export { expect };
export const test = base.extend({
  role: ['superadmin', { option: true }],
  preserveLocale: [false, { option: true }],
  pageEndpoints: [{}, { option: true }],
  server: [async ({}, use) => {
    const server = await startServer();
    try { await use(server); } finally { await server.close(); }
  }, { scope: 'worker' }],
  parity: [async ({ page, server, role, locale, pageEndpoints, preserveLocale }, use) => {
    const requests = [], unmatched = [], faults = [], injectedFailures = [];
    const registry = createEndpointRegistry(endpoints, responseFor, pageEndpoints);
    await page.clock.setFixedTime(new Date('2026-06-01T12:00:00Z'));
    await page.exposeBinding('__parityFault', (_, message) => { faults.push(message); });
    page.on('pageerror', (error) => faults.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error' && consumeResourceDiagnostic(message.text(), message.location().url, injectedFailures)) return;
      if (message.type() === 'error' || /#426|suspended while responding to synchronous input/i.test(message.text())) faults.push(`console.${message.type()}: ${message.text()}`);
    });
    await page.addInitScript(({ session, locale, preserveLocale }) => {
      let seed = 1075;
      Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
      sessionStorage.setItem('in-falcone.console-shell-session', JSON.stringify(session));
      if (!preserveLocale || !localStorage.getItem('falcone-next-locale')) localStorage.setItem('falcone-next-locale', locale);
      localStorage.setItem('falcone-next-theme', 'dark');
      localStorage.removeItem('in-falcone.console-active-context');
      window.addEventListener('unhandledrejection', (event) => { void window.__parityFault(`unhandledrejection: ${event.reason}`); });
      window.addEventListener('securitypolicyviolation', (event) => { void window.__parityFault(`securitypolicyviolation: ${event.violatedDirective}`); }, true);
    }, { session: sessionFor(role), locale, preserveLocale });
    // No browser request may leave the local test server.
    await page.route('**/*', async (route) => {
      if (new URL(route.request().url()).origin === server.origin) return route.continue();
      unmatched.push(`External request ${route.request().method()} ${new URL(route.request().url()).pathname}`);
      await route.abort();
    });
    await page.route('**/v1/**', async (route) => {
      const request = route.request(), url = new URL(request.url());
      const method = request.method(), path = url.pathname;
      let body;
      try { body = request.postDataJSON() ?? undefined; } catch { body = request.postData(); }
      requests.push({ method, path: path + url.search, body });
      const name = registry.find(method, path, body);
      if (url.origin !== server.origin || !name) {
        unmatched.push(`${method} ${path}${url.search}`);
        await route.fulfill({ status: 404, json: { error_msg: '404 Route Not Found' } });
        return;
      }
      const response = registry.responseFor(name, role, body);
      if (response.delayMs) await new Promise((done) => setTimeout(done, response.delayMs));
      if ((path === '/v1/async-operation-query' && (response.network || response.status === 500)) ||
          (path === '/v1/platform/runtime/knative' && (response.network || [401, 403, 404, 500].includes(response.status)))) {
        injectedFailures.push({ url: request.url(), kind: response.network ? 'network' : String(response.status) });
      }
      if (response.network) await route.abort('failed');
      else await route.fulfill({ status: response.status ?? 200, json: response.body });
    });
    const network = { requests, setVariants: (value) => registry.setVariants(value) };
    const parity = {
      page, locale, role, network, faults,
      async open(route, variants = {}) {
        registry.setVariants(variants);
        await page.goto(server.url(route.replace(/^\//, '')));
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
