import { buildConsoleRefreshSessionFixture } from '@in-falcone/console-api/fixtures';
import { createScenario, databasePath, scenarios, workspaceId } from './console-workspace-database-page.manifest.ts';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';

const cookie = 'database-parity-overrides';
export function createDatabaseHarness(parity) {
  const messages = [], injected = [];
  const state = { scenario: createScenario('workspace-database.get.success'), id: '', shell: undefined, recovered: false, workspaceReads: 0 };
  const workspace = (id, label) => ({ workspaceId: id, tenantId: 'synthetic-tenant', displayName: label, slug: id, state: 'active' });
  const record = (request, url, body) => parity.network.requests.push({ method: request.method(), path: url.pathname + url.search, body });
  // The test only logs methods, paths and empty bodies. Response credentials stay in memory.
  parity.page.route('**/v1/**', async (route) => {
    const request = route.request(), url = new URL(request.url());
    let body;
    try { body = request.postDataJSON() ?? undefined; } catch { body = undefined; }
    let response;
    if (url.pathname === databasePath || url.pathname === `${databasePath}/credential-rotations`) {
      record(request, url, body); response = state.scenario.handle(request.method(), url.pathname + url.search, body);
      if (!response) { parity.faults.push('Unexpected database request'); await route.abort(); return; }
    } else if (url.pathname === '/v1/workspaces' && state.shell) {
      if (request.method() !== 'GET' || url.search !== '?page%5Bsize%5D=100&sort=displayName&filter%5BtenantId%5D=synthetic-tenant') { parity.faults.push('Unexpected workspaces request'); await route.abort(); return; }
      state.workspaceReads++; record(request, url, body);
      if (state.shell === 'loading') await new Promise((resolve) => setTimeout(resolve, 1500));
      response = state.shell === 'error' && !state.recovered ? { status: 500, body: { code: 'HTTP_500' } }
        : { status: 200, body: { items: state.shell === 'empty' ? [] : [workspace(workspaceId, 'Synthetic Workspace'), workspace('synthetic-other', 'Other Workspace')], page: { after: null } } };
    } else if (url.pathname === '/v1/workspaces/synthetic-other/database' && request.method() === 'GET' && !url.search) {
      record(request, url, body); response = { status: 404, body: { code: 'HTTP_404' } };
    } else if (url.pathname === '/v1/auth/login-sessions/synthetic-session/refresh' && state.id.includes('.401-')) {
      record(request, url, undefined);
      response = state.id.endsWith('rejected') ? { status: 400, body: { code: 'REFRESH_REJECTED' } } : { status: 200, body: buildConsoleRefreshSessionFixture() };
    } else if (request.method() === 'GET' && url.pathname === '/v1/postgres/databases' && url.search === '?page%5Bsize%5D=100') {
      response = { status: 200, body: { items: [], page: { after: null } } };
    } else {
      const allowed = request.method() === 'GET' && ['/v1/tenants', '/v1/tenants/synthetic-tenant', '/v1/workspaces', '/v1/auth/signups/policy'].includes(url.pathname);
      if (!allowed) { parity.faults.push(`Unexpected API request: ${request.method()} ${url.pathname}`); await route.abort(); return; }
      await route.fallback(); return;
    }
    if (response.delayMs) await new Promise((resolve) => setTimeout(resolve, response.delayMs));
    if (response.network || response.status >= 400) injected.push({ url: request.url(), kind: response.network ? 'network' : String(response.status) });
    if (response.network) await route.abort('failed'); else await route.fulfill({ status: response.status ?? 200, json: response.body });
  });
  parity.page.on('console', (message) => {
    messages.push(message.text());
    const status = /^Failed to load resource: the server responded with a status of (\d{3})/.exec(message.text())?.[1];
    const index = injected.findIndex((failure) => failure.url === message.location().url && failure.kind === status);
    const consumed = index >= 0 ? (injected.splice(index, 1), true) : consumeResourceDiagnostic(message.text(), message.location().url, injected);
    if (consumed) {
      const fault = parity.faults.indexOf(`console.error: ${message.text()}`);
      if (fault >= 0) parity.faults.splice(fault, 1);
    }
  });
  return {
    state, messages,
    async install() {
      await parity.page.addInitScript((cookie) => {
        document.addEventListener('readystatechange', () => {
          if (document.readyState !== 'interactive') return;
          const raw = document.cookie.split('; ').find((entry) => entry.startsWith(`${cookie}=`));
          if (!raw) return;
          const { role, active } = JSON.parse(decodeURIComponent(raw.slice(cookie.length + 1)));
          const key = 'in-falcone.console-shell-session', session = JSON.parse(sessionStorage.getItem(key));
          session.principal.platformRoles = [role]; session.principal.tenantIds = ['synthetic-tenant']; session.principal.workspaceIds = [];
          sessionStorage.setItem(key, JSON.stringify(session));
          if (active) localStorage.setItem('in-falcone.console-active-context', JSON.stringify({ userId: session.principal.userId, tenantId: 'synthetic-tenant', workspaceId: active, updatedAt: '2026-01-01' }));
        }, { once: true });
      }, cookie);
    },
    async use(id, server) {
      if (!Object.hasOwn(scenarios, id)) throw new Error(`Unknown database fixture: ${id}`);
      Object.assign(state, { id, scenario: createScenario(id), shell: scenarios[id].shell, recovered: false, workspaceReads: 0 });
      parity.network.requests.length = 0;
      await parity.page.context().addCookies([{ name: cookie, value: encodeURIComponent(JSON.stringify({ role: scenarios[id].role ?? 'superadmin', active: scenarios[id].shell === 'two' ? workspaceId : null })), url: `${server.origin}/` }]);
    },
    calls: () => parity.network.requests.filter(({ path }) => /\/database(?:\/credential-rotations)?$|\/refresh$/.test(path)),
  };
}
