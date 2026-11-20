import { test as base, expect as baseExpect } from '@playwright/test';
import { startServer } from '../csp/server.mjs';
import { endpoints, responseFor, sessionFor } from './fixtures/shell.ts';
import { createEndpointRegistry } from './endpoint-registry.ts';
import { consumeResourceDiagnostic } from './resource-diagnostics.mjs';
import { catalogResponse, isPlansQuery } from './pages/console-plan-catalog-page.manifest.ts';
import { sectionFailureEndpoints } from './pages/console-functions-page.manifest.ts';
import { assertNoSampleData } from './checks.mjs';

const expect = baseExpect;
// The parity fixture of the test that is running in this worker (tests run one at a time per worker).
let current;
// assertNoSampleData runs on every settled state: after open(), after every action and readiness assertion a journey runs
// (the wrappers below), after every check in checks.mjs, and once more before teardown.
const settle = async () => {
  if (!current || current.settling) return;
  current.settling = true;
  try { await current.assertNoSampleData(); } finally { current.settling = false; }
};
const ACTIONS = ['click', 'dblclick', 'tap', 'fill', 'pressSequentially', 'press', 'check', 'uncheck', 'setChecked', 'selectOption', 'clear', 'dragTo'];
function instrumentActions(page) {
  const prototype = Object.getPrototypeOf(page.locator('html'));
  if (prototype.parityInstrumented) return;
  for (const name of ACTIONS) {
    const original = prototype[name];
    if (typeof original !== 'function') continue;
    prototype[name] = async function (...args) {
      const result = await original.apply(this, args);
      if (current && ['fill', 'pressSequentially'].includes(name)) current.network.supplied.push(String(args[0]));
      await settle();
      return result;
    };
  }
  prototype.parityInstrumented = true;
}
const wrapMatchers = (matchers) => new Proxy(matchers, {
  get(target, property) {
    const value = Reflect.get(target, property);
    if (['not', 'resolves', 'rejects'].includes(property)) return wrapMatchers(value);
    if (typeof value !== 'function') return value;
    return (...args) => {
      const result = value.apply(target, args);
      return typeof result?.then === 'function' ? result.then(async (outcome) => { await settle(); return outcome; }) : result;
    };
  },
});
// Journeys import this expect: every awaited matcher (a readiness assertion) is followed by the sample-data check.
// The harness itself uses the plain expect.
const checkedExpect = new Proxy(baseExpect, { apply: (target, thisArg, args) => wrapMatchers(Reflect.apply(target, thisArg, args)) });
export { checkedExpect as expect };
export const test = base.extend({
  role: ['superadmin', { option: true }],
  preserveLocale: [false, { option: true }],
  pageEndpoints: [{}, { option: true }],
  server: [async ({}, use) => {
    const server = await startServer();
    try { await use(server); } finally { await server.close(); }
  }, { scope: 'worker' }],
  parity: [async ({ page, server, role, locale, pageEndpoints, preserveLocale }, use) => {
    const requests = [], unmatched = [], faults = [], injectedFailures = [], supplied = [];
    const guardRequest = async (route) => {
      if (/apikey/i.test(route.request().url())) {
        unmatched.push('API key URL forbidden');
        await route.abort();
        return false;
      }
      const request = route.request();
      const headers = new Headers(request.headers());
      if (/^\/v1\/flows\/workspaces\/[^/]+\/executions\/[^/]+\/events$/.test(new URL(request.url()).pathname) &&
          !/^Bearer\s+\S+$/i.test(headers.get('authorization') ?? '')) {
        unmatched.push('Flow events bearer required');
        await route.abort();
        return false;
      }
      return true;
    };
    const registry = createEndpointRegistry(endpoints, responseFor, pageEndpoints);
    // The selected variants decide whether a functions section 500 was injected by the fixture or is a real failure.
    let selectedVariants = {};
    const setVariants = (value) => { selectedVariants = value; registry.setVariants(value); };
    const selectsFailure = (selected) => [selected].flat().some((item) => item === '500' || item?.variant === '500');
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
      if (!await guardRequest(route)) return;
      if (new URL(route.request().url()).origin === server.origin) return route.continue();
      unmatched.push(`External request ${route.request().method()} ${new URL(route.request().url()).pathname}`);
      await route.abort();
    });
    await page.route('**/v1/**', async (route) => {
      if (!await guardRequest(route)) return;
      const request = route.request(), url = new URL(request.url());
      const method = request.method(), path = url.pathname;
      let body;
      try { body = request.postDataJSON() ?? undefined; } catch { body = request.postData(); }
      requests.push({ method, path: path + url.search, body });
      if (body !== undefined) supplied.push(typeof body === 'string' ? body : JSON.stringify(body));
      const name = registry.find(method, path, body);
      // Other page journeys can now navigate back to the migrated catalog.
      if (url.origin === server.origin && !name && isPlansQuery(method, url)) {
        const response = catalogResponse('45-mixed', url);
        await route.fulfill({ status: response.status, json: response.body });
        return;
      }
      if (url.origin !== server.origin || !name || (name === 'capabilities' && (url.search || body !== undefined))) {
        unmatched.push(`${method} ${path}${url.search}`);
        await route.fulfill({ status: 404, json: { error_msg: '404 Route Not Found' } });
        return;
      }
      const response = registry.responseFor(name, role, body);
      if (response.delayMs) await new Promise((done) => setTimeout(done, response.delayMs));
      if ((/^\/v1\/auth\/(?:login-sessions(?:\/[^/]+\/refresh)?|signups\/policy|status-views\/[^/]+)$/.test(path) && (response.network || response.status >= 400)) ||
          (path === '/v1/async-operation-query' && (response.network || response.status === 500)) ||
          (sectionFailureEndpoints.includes(name) && response.status === 500 && selectsFailure(selectedVariants[name])) ||
          ((path === '/v1/tenant/effective-capabilities' || /^\/v1\/workspaces\/[^/]+\/realtime$/.test(path) || path === '/v1/platform/runtime/knative') && (response.network || [401, 403, 404, 500].includes(response.status)))) {
        injectedFailures.push({ url: request.url(), kind: response.network ? 'network' : String(response.status) });
      }
      if (response.network) await route.abort('failed');
      else {
        supplied.push(JSON.stringify(response.body ?? null));
        await route.fulfill({ status: response.status ?? 200, json: response.body });
      }
    });
    const network = { requests, setVariants, supplied };
    const parity = {
      page, locale, role, network, faults,
      async open(route, variants = {}) {
        setVariants(variants);
        await page.goto(server.url(route.replace(/^\//, '')));
        await expect(page.locator('main')).toBeVisible();
        await expect(page.locator('main h1')).toBeVisible();
        await expect(page.locator('main section[aria-busy="true"]')).toHaveCount(0);
        // The region sits in the ConsoleShell sidebar header, which is display:none below lg. A role query skips hidden elements,
        // so match the region by markup: at 375 px it must still gate the settle, not pass vacuously.
        const context = page.locator(`section[aria-label="${locale === 'es' ? 'Contexto activo' : 'Active context'}"]`);
        // One retrying assertion, no separate existence check: the shell may re-render the region between a count() and a follow-up expect.
        await expect(context.and(page.locator('[aria-busy="true"]'))).toHaveCount(0);
        await page.evaluate(() => document.fonts.ready);
        await settle();
      },
      assertNoSampleData: () => assertNoSampleData(parity),
    };
    instrumentActions(page);
    current = parity;
    try { await use(parity); await settle(); }
    finally { current = undefined; expect(unmatched, `Unmatched requests:\n${unmatched.join('\n')}`).toEqual([]); }
  }, { auto: true }],
});
