import { buildConsoleRefreshSessionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures';
import { fixtures, idempotency, collectionRow, databaseRow, documentRow } from './console-mongo-page.manifest.ts';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';

// The shell fixture supplies synthetic-tenant and synthetic-workspace.
const workspace = 'synthetic-workspace';
const base = '/v1/mongo/databases/catalog';
export const paths = {
  databases: '/v1/mongo/databases', collections: `${base}/collections`, views: `${base}/views`, detail: `${base}/collections/orders`, indexes: `${base}/collections/orders/indexes`,
  documents: `/v1/mongo/workspaces/${workspace}/data/catalog/collections/orders/documents`,
};
export const readUrl = (kind, cursor) => kind === 'detail' ? paths.detail
  : kind === 'documents' ? `${paths.documents}?page%5Bsize%5D=20${cursor ? `&page%5Bafter%5D=${encodeURIComponent(cursor)}` : ''}`
  : `${paths[kind]}?page[size]=100${cursor ? `&page[after]=${encodeURIComponent(cursor)}` : ''}`;
export const submitPath = `/v1/workspaces/${workspace}/databases`;
const kinds = Object.keys(paths);
const fresh = () => ({ errors: {}, empty: [], delayed: [], cursors: [], recovered: false, quota: false, refresh: null, noTenant: false, noWorkspace: false, role: 'tenant_owner', onlyId: false, noValidator: false, errorsOnNext: null, create: ['create-success'] });

export async function installMongoHarness(parity, server) {
  await parity.page.addInitScript(() => {
    document.addEventListener('readystatechange', () => {
      if (document.readyState !== 'interactive') return;
      const raw = document.cookie.split('; ').find((entry) => entry.startsWith('mongo-role='));
      if (raw) {
        const key = 'in-falcone.console-shell-session', session = JSON.parse(sessionStorage.getItem(key));
        session.principal.workspaceIds = [];
        session.principal.platformRoles = [decodeURIComponent(raw.slice('mongo-role='.length))];
        sessionStorage.setItem(key, JSON.stringify(session));
      }
    }, { once: true });
  });
  const calls = [], unmatched = [], injected = [], attempts = {};
  const state = fresh();
  let creates = 0;
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
    const record = (extra = {}) => calls.push({ method, path, body, ...extra });
    const kind = kinds.find((key) => url.pathname === paths[key]);
    let response;
    if (method === 'GET' && kind) {
      const cursor = url.searchParams.get('page[after]');
      if (path !== readUrl(kind, cursor ?? undefined) || (cursor && cursor !== `next-${kind}`)) return reject();
      record(); attempts[kind] = (attempts[kind] ?? 0) + 1;
      const failure = state.errors[kind], nextPage = { databases: databaseRow('archive'), collections: collectionRow('audit'), views: { viewName: 'events_view', viewOn: 'events', pipeline: [] }, indexes: { indexName: 'created_1', keys: [{ fieldName: 'created', direction: 1 }] }, documents: documentRow('doc-9') };
      // `errorsOnNext` fails only the cursor page; every other failure applies to the first page.
      const failing = failure && !state.recovered && (failure !== 401 || attempts[kind] === 1) && (Boolean(cursor) === (state.errorsOnNext === kind) || (!state.errorsOnNext && !cursor));
      if (failing) response = { status: failure === 'network' ? 200 : failure, network: failure === 'network', body: { code: `HTTP_${failure}`, requestId: 'mongo-browser-request', message: 'raw-backend-message' } };
      else if (cursor) response = { body: { items: [nextPage[kind]], page: kind === 'documents' ? { after: null, size: 20 } : {} } };
      else if (state.empty.includes(kind)) response = { body: kind === 'detail' ? fixtures.detailNoValidator : { items: [], page: {} } };
      else {
        const value = structuredClone(kind === 'detail' ? (state.noValidator ? fixtures.detailNoValidator : fixtures.detail) : kind === 'indexes' && state.onlyId ? fixtures.indexesOnlyId : fixtures[kind]);
        if (state.cursors.includes(kind)) value.page = kind === 'documents' ? { after: `next-${kind}`, size: 20 } : { nextCursor: `next-${kind}` };
        response = { body: value };
      }
      if (state.delayed.includes(kind)) response.delay = 800;
    } else if (method === 'GET' && /^\/v1\/metrics\/(tenants\/synthetic-tenant|workspaces\/synthetic-workspace)\/(quotas|overview)$/.test(url.pathname) && !url.search) {
      record(); response = { body: state.quota && url.pathname.endsWith('/quotas') ? { dimensions: [{ dimensionId: 'databases.count', hardLimit: 1, measuredValue: 1 }] } : { dimensions: [] } };
    } else if (method === 'POST' && path === submitPath) {
      const name = state.create[Math.min(creates++, state.create.length - 1)];
      record({ key: request.headers()['idempotency-key'], requestId: request.headers()['x-request-id'] });
      if (name === 'network') response = { network: true };
      else { const fixture = idempotency[name]; response = { status: fixture.status, body: fixture.body, headers: { ...fixture.headers, ...(fixture.replayed ? { 'X-Idempotency-Replayed': fixture.replayed } : {}) } }; }
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
    if (response.network) await route.abort('failed'); else await route.fulfill({ status: response.status ?? 200, json: response.body, headers: response.headers });
  });
  return { calls, unmatched, state, async open(patch = {}) {
    Object.assign(state, fresh(), patch); creates = 0;
    for (const key of Object.keys(attempts)) delete attempts[key]; calls.length = 0;
    await parity.page.context().addCookies([{ name: 'mongo-role', value: encodeURIComponent(state.role), url: `${server.origin}/` }]);
    if (state.delayed.includes('databases')) { await parity.page.goto(server.url('console/mongo')); return; }
    await parity.open('/console/mongo');
  } };
}
