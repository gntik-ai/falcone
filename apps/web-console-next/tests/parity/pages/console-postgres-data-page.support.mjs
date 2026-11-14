import { buildConsoleRefreshSessionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures';
import { fixtures, rowsUrl } from './console-postgres-data-page.manifest.ts';
import { fixtures as postgresFixtures, paths as postgresPaths, pageUrl as postgresPageUrl } from './console-postgres-page.manifest.ts';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';

export const workspace = 'synthetic-workspace';
const base = (table = 'accounts', db = 'app_db', schema = 'public') => `/v1/postgres/workspaces/${workspace}/data/${db}/schemas/${schema}/tables/${table}`;
export const paths = { rows: `${base()}/rows`, byKey: `${base()}/rows/by-primary-key`, keys: `/v1/workspaces/${workspace}/api-keys` };
export const urls = { rows: (options = {}) => rowsUrl({ ...options, base: options.base ?? paths.rows }), preview: `${paths.rows}?page%5Bsize%5D=10` };
const initial = () => ({ errors: {}, recoverAfterFailure: [], empty: [], refresh: null, noWorkspace: false, role: 'tenant_owner', noId: false, inserted: false, patched: false, deleted: false, revoked: false, held: {} });

// Mocked backend for the row editor. Only the page's own requests, the shell bootstrap and the session refresh are
// answered; everything else is recorded as unmatched. Expected failures are registered as diagnostics so that the
// runtime-health check stays strict for any other console error.
export async function installPostgresDataHarness(parity, server) {
  await parity.page.addInitScript(() => {
    document.addEventListener('readystatechange', () => {
      if (document.readyState !== 'interactive') return;
      const raw = document.cookie.split('; ').find((entry) => entry.startsWith('postgres-data-role='));
      if (raw) {
        const key = 'in-falcone.console-shell-session', session = JSON.parse(sessionStorage.getItem(key));
        session.principal.workspaceIds = [];
        session.principal.platformRoles = [decodeURIComponent(raw.slice('postgres-data-role='.length))];
        sessionStorage.setItem(key, JSON.stringify(session));
      }
    }, { once: true });
  });
  const calls = [], navigation = [], unmatched = [], injected = [], attempts = {}, gates = {}, state = initial();
  parity.page.on('console', (message) => {
    if (consumeResourceDiagnostic(message.text(), message.location().url, injected)) {
      const index = parity.faults.indexOf(`console.error: ${message.text()}`);
      if (index >= 0) parity.faults.splice(index, 1);
    }
  });
  const rowsFixture = (url) => {
    const table = /\/tables\/([^/]+)\/rows/.exec(url.pathname)?.[1];
    if (table !== 'accounts') return { items: [{ id: 'ord_1' }], page: {}, count: 1 };
    if (state.empty.includes('rows')) return fixtures['pg-rows-empty'];
    if (state.noId) return { items: [{ email: 'anon@example.test' }], page: {}, count: 1 };
    if (url.searchParams.get('page[after]') === 'c1') return fixtures['pg-rows-page2'];
    if (state.deleted) return fixtures['pg-rows-after-delete'];
    if (state.patched) return fixtures['pg-rows-after-patch'];
    if (state.inserted) return fixtures['pg-rows-after-insert'];
    const filters = [...url.searchParams.keys()].filter((key) => !['page[size]', 'page[after]', 'countMode'].includes(key));
    // A filter on id=eq.acc_01 matches one row; any other filter matches nothing.
    if (filters.length === 1 && filters[0] === 'id' && url.searchParams.get('id') === 'eq.acc_01') return fixtures['pg-rows-filtered'];
    if (filters.length) return fixtures['pg-rows-empty'];
    return fixtures['pg-rows-page1'];
  };
  await parity.page.route('**/v1/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname + url.search, method = request.method(), headers = request.headers();
    let body; try { body = request.postDataJSON() ?? undefined; } catch { body = undefined; }
    const reject = async () => { unmatched.push(`${method} ${path}`); await route.abort(); };
    const record = (extra = {}) => calls.push({ method, path, body, apikey: headers.apikey, authorization: headers.authorization, ...extra });
    const failure = (key) => {
      const variant = state.errors[key];
      if (!variant) return null;
      attempts[key] = (attempts[key] ?? 0) + 1;
      if (state.recoverAfterFailure.includes(key) && attempts[key] > 1) return null;
      if (variant === 401 && attempts[key] > 1) return null;
      return variant === 'network' ? { network: true } : { status: variant, body: { code: `HTTP_${variant}`, message: variant === 500 && key === 'insert' ? 'synthetic insert failure' : 'synthetic failure', requestId: 'pg-browser-request' } };
    };
    // A held request waits until the test releases it, so busy and loading states are asserted without timing races.
    const gated = async (key) => { if (gates[key]) await gates[key]; };
    let response;
    if (method === 'GET' && /\/tables\/[^/]+\/rows$/.test(url.pathname) && url.pathname.startsWith(`/v1/postgres/workspaces/${workspace}/data/`)) {
      const previewing = headers.apikey !== undefined;
      if (previewing) {
        if (headers.authorization !== undefined || path !== urls.preview) return reject();
        record(); await gated('preview'); response = failure('preview') ?? { body: fixtures['pg-rows-preview-apikey'] };
      } else {
        const params = [...url.searchParams.keys()];
        if (!params.includes('page[size]') || url.searchParams.get('countMode') !== 'exact') return reject();
        record(); await gated('rows'); response = failure('rows') ?? { body: rowsFixture(url) };
      }
    } else if (method === 'POST' && path === paths.rows) {
      record(); await gated('insert'); response = failure('insert') ?? (() => { state.inserted = true; return { body: fixtures['pg-row-insert-ok'] }; })();
    } else if (method === 'PATCH' && url.pathname === paths.byKey && url.search === '?id=acc_01') {
      record(); await gated('patch'); response = failure('patch') ?? { body: fixtures['pg-row-patch-ok'] }; if (response.body) state.patched = true;
    } else if (method === 'DELETE' && url.pathname === paths.byKey && url.search === '?id=acc_01') {
      record(); await gated('delete'); response = failure('delete') ?? { body: fixtures['pg-row-delete-ok'] }; if (response.body) state.deleted = true;
    } else if (method === 'GET' && path === paths.keys) {
      record(); await gated('keys'); response = failure('keys') ?? { body: state.empty.includes('keys') ? fixtures['pg-api-keys-empty'] : state.revoked ? fixtures['pg-api-keys-after-revoke'] : fixtures['pg-api-keys'] };
    } else if (method === 'POST' && path === paths.keys && (body?.keyType === 'anon' || body?.keyType === 'service')) {
      record(); response = { body: fixtures[body.keyType === 'anon' ? 'pg-api-key-issue-anon' : 'pg-api-key-issue-service'] };
    } else if (method === 'DELETE' && path === `${paths.keys}/key-anon-1`) {
      record(); response = { body: fixtures['pg-api-key-revoke-ok'] }; state.revoked = true;
    } else if (method === 'GET' && path === postgresPageUrl(postgresPaths.databases)) {
      // Navigation target only: the /console/postgres page lists databases when the journey leaves the data page. It is
      // recorded apart from `calls`, so the data page's own request assertions stay strict.
      navigation.push(`${method} ${path}`); response = { body: postgresFixtures.databases };
    } else if (method === 'POST' && path === '/v1/auth/login-sessions/synthetic-session/refresh' && state.refresh) {
      record(); response = state.refresh === 'rejected' ? { status: 400, body: {} } : { body: buildConsoleRefreshSessionFixture() };
    } else if (method === 'GET' && url.pathname === '/v1/workspaces' && state.noWorkspace) {
      const value = buildWorkspaceCollectionFixture();
      if (state.noWorkspace === 'empty') value.items = [];
      else value.items.push({ ...value.items[0], workspaceId: 'second-workspace', displayName: 'Second Workspace' });
      response = { body: value };
    } else if (method === 'GET' && url.pathname === '/v1/workspaces' && state.errors.workspaces) {
      response = { status: state.errors.workspaces, body: { code: `HTTP_${state.errors.workspaces}`, message: 'synthetic failure' } };
    } else if (method === 'GET' && ['/v1/tenants', '/v1/tenants/synthetic-tenant', '/v1/workspaces', '/v1/auth/signups/policy'].includes(url.pathname)) return route.fallback();
    else return reject();
    if (response.network || response.status >= 400) injected.push({ url: request.url(), kind: response.network ? 'network' : String(response.status) });
    if (response.network) await route.abort('failed'); else await route.fulfill({ status: response.status ?? 200, json: response.body });
  });
  return { calls, navigation, unmatched, state, urls, paths,
    // Drop the recorded requests only; fixture state (inserted, patched...) stays so that later reloads show it.
    reset() { calls.length = 0; },
    hold(key) { let release; gates[key] = new Promise((resolve) => { release = resolve; }); return () => { delete gates[key]; release(); }; },
    async open(patch = {}) {
      Object.assign(state, initial(), patch);
      for (const key of Object.keys(attempts)) delete attempts[key];
      for (const key of Object.keys(gates)) delete gates[key];
      calls.length = 0;
      await parity.page.context().addCookies([{ name: 'postgres-data-role', value: encodeURIComponent(state.role), url: `${server.origin}/` }]);
      await parity.open('/console/postgres/data');
    } };
}
