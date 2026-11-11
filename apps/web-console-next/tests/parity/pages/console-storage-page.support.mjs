import { createEndpointRegistry } from '../endpoint-registry.ts';
import { endpoints, mockUsage } from './console-storage-page.manifest.ts';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';

// Page-local exact-query registry: the common registry intentionally matches only pathnames.
// No token or presigned URL is recorded; assertions compare request auth only in memory.
export async function installStorageHarness(parity) {
  const registry = createEndpointRegistry({}, () => { throw new Error('Unexpected shell response'); }, endpoints);
  const injected = [], calls = [], unmatched = [];
  let variants = {}, context = 'one', refreshRejected = false;
  const set = (next = {}) => { variants = next; registry.setVariants(next); };
  parity.page.on('console', (message) => {
    if (message.type() !== 'error' || !consumeResourceDiagnostic(message.text(), message.location().url, injected)) return;
    const index = parity.faults.indexOf(`console.error: ${message.text()}`);
    if (index >= 0) parity.faults.splice(index, 1);
  });
  // Selection is applied after the shared harness init script, before app modules execute.
  await parity.page.addInitScript(() => {
    document.addEventListener('readystatechange', () => {
      if (document.readyState !== 'interactive') return;
      const key = 'in-falcone.console-shell-session';
      const session = JSON.parse(sessionStorage.getItem(key));
      session.principal.workspaceIds = ['synthetic-workspace', 'synthetic-other'];
      session.principal.tenantIds = ['synthetic-tenant', 'synthetic-other-tenant'];
      sessionStorage.setItem(key, JSON.stringify(session));
      localStorage.setItem('in-falcone.console-active-context', JSON.stringify({ userId: session.principal.userId, tenantId: 'synthetic-tenant', workspaceId: 'synthetic-workspace', updatedAt: '2026-01-01' }));
    }, { once: true });
  });
  await parity.page.route('**/v1/tenants?*', async (route) => {
    if (context !== 'tenant') return route.fallback();
    const tenant = (id, label) => ({ tenantId: id, displayName: label, slug: id, state: 'active' });
    await route.fulfill({ json: { items: [tenant('synthetic-tenant', 'Synthetic Tenant'), tenant('synthetic-other-tenant', 'Other Tenant')], page: {} } });
  });
  await parity.page.route('**/v1/workspaces?*', async (route) => {
    if (context === 'one') return route.fallback();
    const otherTenant = new URL(route.request().url()).searchParams.get('filter[tenantId]') === 'synthetic-other-tenant';
    const workspace = (id, label) => ({ workspaceId: id, tenantId: otherTenant ? 'synthetic-other-tenant' : 'synthetic-tenant', displayName: label, slug: id, state: 'active' });
    const first = workspace('synthetic-workspace', 'Synthetic Workspace'), other = workspace('synthetic-other', 'Other Workspace');
    await route.fulfill({ json: { items: context === 'none' ? [] : otherTenant ? [other] : [first, other], page: {} } });
  });
  await parity.page.route('**/v1/auth/login-sessions/*/refresh', async (route) => {
    if (!refreshRejected) return route.fallback();
    injected.push({ url: route.request().url(), kind: '401' });
    parity.network.requests.push({ method: 'POST', path: new URL(route.request().url()).pathname, body: undefined });
    await route.fulfill({ status: 401, json: { code: 'HTTP_401' } });
  });
  await parity.page.route('**/v1/storage/**', async (route) => {
    const request = route.request(), url = new URL(request.url());
    const path = url.pathname + url.search;
    let body; try { body = request.postDataJSON() ?? undefined; } catch { body = undefined; }
    // Parse query parameters to tolerate URL bracket normalization, but enforce their exact key/value set.
    const equivalent = (candidate) => {
      const expected = new URL(candidate, 'https://local.invalid');
      return expected.pathname === url.pathname && JSON.stringify([...expected.searchParams].sort()) === JSON.stringify([...url.searchParams].sort());
    };
    if (request.method() === 'GET' && url.pathname === '/v1/storage/workspaces/synthetic-other/usage' && !url.search && ['workspace', 'tenant'].includes(context)) {
      calls.push({ name: 'otherUsage', method: 'GET', path, body: undefined });
      parity.network.requests.push({ method: 'GET', path, body: undefined });
      await route.fulfill({ json: mockUsage() }); return;
    }
    const name = Object.keys(endpoints).find((key) => endpoints[key].method === request.method() && equivalent(endpoints[key].path));
    if (!name) { unmatched.push(`${request.method()} ${path}`); await route.abort(); return; }
    calls.push({ name, method: request.method(), path, body });
    // The request inventory contains paths and bodies only, never authentication or returned URLs.
    parity.network.requests.push({ method: request.method(), path, body });
    const response = registry.responseFor(name, parity.role, body);
    if (response.delayMs) await new Promise((done) => setTimeout(done, response.delayMs));
    if (response.network || response.status >= 400) injected.push({ url: request.url(), kind: response.network ? 'network' : String(response.status) });
    if (response.network) await route.abort('failed');
    else await route.fulfill({ status: response.status ?? 200, json: response.body });
  });
  return { calls, unmatched, set, context: (value) => { context = value; }, rejectRefresh: (value) => { refreshRejected = value; },
    async open(next = {}, shell = {}) { calls.length = 0; set(next); context = shell.workspaces ?? 'one'; refreshRejected = Boolean(shell.refreshRejected); await parity.open('/console/storage', shell.noTenant ? { tenants: 'empty' } : {}); },
  };
}
