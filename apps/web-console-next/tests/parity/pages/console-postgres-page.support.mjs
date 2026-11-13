import { buildConsoleRefreshSessionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures';
import { fixtures, paths, pageUrl, ddlPreviewFixture, tableFixture } from './console-postgres-page.manifest.ts';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';
export async function installPostgresHarness(parity, server) {
  await parity.page.addInitScript(() => {
    document.addEventListener('readystatechange', () => {
      if (document.readyState !== 'interactive') return;
      const raw = document.cookie.split('; ').find((entry) => entry.startsWith('postgres-role='));
    if (raw) {
      const key = 'in-falcone.console-shell-session', session = JSON.parse(sessionStorage.getItem(key));
      session.principal.workspaceIds = [];
      session.principal.platformRoles = [decodeURIComponent(raw.slice('postgres-role='.length))];
      sessionStorage.setItem(key, JSON.stringify(session));
    }
    }, { once: true });
  });
  const calls = [], unmatched = [], injected = [];
  const state = { errors: {}, empty: [], delayed: [], cursors: [], recovered: false, missingQuery: false, missingDdl: false, quota: false, tables100: false, refresh: null, noTenant: false, noWorkspace: false, role: 'tenant_owner' };
  const attempts = {};
  parity.page.on('console', (message) => {
    if (consumeResourceDiagnostic(message.text(), message.location().url, injected)) {
      const index = parity.faults.indexOf(`console.error: ${message.text()}`);
      if (index >= 0) parity.faults.splice(index, 1);
    }
  });
  await parity.page.route('**/v1/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname + url.search, method = request.method();
    let body; try { body = request.postDataJSON() ?? undefined; } catch { body = undefined; }
    const reject = async () => { unmatched.push(`${method} ${path}`); await route.abort(); };
    const record = () => calls.push({ method, path, body });
    const kind = Object.keys(paths).find((key) => url.pathname === paths[key]);
    let response;
    if (method === 'GET' && kind) {
      const cursor = url.searchParams.get('page[after]');
      if (kind === 'security' ? url.search !== '' : path !== pageUrl(paths[kind], cursor ?? undefined) || cursor && cursor !== `next-${kind}`) return reject();
      record(); attempts[kind] = (attempts[kind] ?? 0) + 1;
      const failure = state.errors[kind];
      if (failure && !state.recovered && (failure !== 401 || attempts[kind] === 1)) response = { status: failure === 'network' ? 200 : failure, network: failure === 'network', body: { code: `HTTP_${failure}`, requestId: 'pg-browser-request' } };
      else if (state.empty.includes(kind) || cursor) response = { body: kind === 'security' ? null : { items: [], page: {} } };
      else {
        const value = structuredClone(fixtures[kind]);
        if (state.cursors.includes(kind)) value.page = { nextCursor: `next-${kind}` };
        if (kind === 'tables' && state.tables100) value.items = [tableFixture(), ...Array.from({ length: 99 }, (_, index) => tableFixture({ tableName: `table_${index}` }))];
        if (state.missingQuery && ['views', 'matviews'].includes(kind)) delete value.items[0].query;
        response = { body: value };
      }
      if (state.delayed.includes(kind)) response.delay = 800;
    } else if (method === 'GET' && /^\/v1\/metrics\/(tenants\/synthetic-tenant|workspaces\/synthetic-workspace)\/(quotas|overview)$/.test(url.pathname) && !url.search) {
      record(); response = { body: state.quota && url.pathname.endsWith('/quotas') ? { dimensions: [{ dimensionId: 'databases.count', hardLimit: 1, measuredValue: 1 }] } : { dimensions: [] } };
      if (state.delayed.includes('metrics')) response.delay = 800;
    } else if (method === 'PUT' && [paths.tables + '/accounts', paths.views + '/active_accounts', paths.matviews + '/accounts_snapshot'].includes(url.pathname) && !url.search && body?.dryRun === true && body?.executionMode === 'preview') {
      record(); response = { body: state.missingDdl ? {} : ddlPreviewFixture() }; if (state.delayed.includes('preview')) response.delay = 800;
    } else if (method === 'POST' && path === '/v1/workspaces/synthetic-workspace/databases') {
      record(); response = { body: { databaseId: 'pg-created' } };
    } else if (method === 'POST' && path === '/v1/auth/login-sessions/synthetic-session/refresh' && state.refresh) {
      record(); response = state.refresh === 'rejected' ? { status: 400, body: {} } : { body: buildConsoleRefreshSessionFixture() };
    } else if (method === 'GET' && ['/v1/tenants', '/v1/tenants/synthetic-tenant'].includes(url.pathname) && state.noTenant) {
      response = { body: { items: [], page: {} } };
    } else if (method === 'GET' && url.pathname === '/v1/workspaces' && state.noWorkspace) {
      const value = buildWorkspaceCollectionFixture();
      if (state.noWorkspace === 'empty') value.items = [];
      else value.items.push({ ...value.items[0], workspaceId: 'second-workspace', displayName: 'Second Workspace' });
      response = { body: value };
    } else if (method === 'GET' && ['/v1/tenants', '/v1/tenants/synthetic-tenant', '/v1/workspaces', '/v1/auth/signups/policy'].includes(url.pathname)) return route.fallback();
    else return reject();
    if (response.delay) await new Promise((resolve) => setTimeout(resolve, response.delay));
    if (response.network || response.status >= 400) injected.push({ url: request.url(), kind: response.network ? 'network' : String(response.status) });
    if (response.network) await route.abort('failed'); else await route.fulfill({ status: response.status ?? 200, json: response.body });
  });
  return { calls, unmatched, state, async open(patch = {}) {
    Object.assign(state, { errors: {}, empty: [], delayed: [], cursors: [], recovered: false, missingQuery: false, missingDdl: false, quota: false, tables100: false, refresh: null, noTenant: false, noWorkspace: false, role: 'tenant_owner' }, patch);
    for (const key of Object.keys(attempts)) delete attempts[key]; calls.length = 0;
    await parity.page.context().addCookies([{ name: 'postgres-role', value: encodeURIComponent(state.role), url: `${server.origin}/` }]);
    if (state.delayed.includes('databases')) { await parity.page.goto(server.url('console/postgres')); return; }
    await parity.open('/console/postgres');
  } };
}
