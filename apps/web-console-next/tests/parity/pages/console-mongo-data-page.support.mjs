import { buildConsoleRefreshSessionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures';
import { docsUrl, fixtures } from './console-mongo-data-page.manifest.ts';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';

export const workspace = 'synthetic-workspace';
const base = (collection = 'orders', db = 'catalog') => `/v1/mongo/workspaces/${workspace}/data/${db}/collections/${collection}/documents`;
export const paths = { docs: base(), doc: `${base()}/ord_01`, keys: `/v1/workspaces/${workspace}/api-keys` };
export const urls = { docs: (options = {}) => docsUrl({ ...options, base: options.base ?? paths.docs }), preview: `${paths.docs}?page%5Bsize%5D=10` };
const initial = () => ({ errors: {}, recoverAfterFailure: [], empty: false, refresh: null, noWorkspace: false, role: 'tenant_owner', noId: false, inserted: false, updated: false, deleted: false, held: {} });

// Mocked backend for the document editor. Only the page's own requests, the shell bootstrap and the session refresh are
// answered; everything else is recorded as unmatched. Expected failures are registered as diagnostics so that the
// runtime-health check stays strict for any other console error. The key is a synthetic placeholder.
export async function installMongoDataHarness(parity, server) {
  await parity.page.addInitScript(() => {
    document.addEventListener('readystatechange', () => {
      if (document.readyState !== 'interactive') return;
      const raw = document.cookie.split('; ').find((entry) => entry.startsWith('mongo-data-role='));
      if (raw) {
        const key = 'in-falcone.console-shell-session', session = JSON.parse(sessionStorage.getItem(key));
        session.principal.workspaceIds = [];
        session.principal.platformRoles = [decodeURIComponent(raw.slice('mongo-data-role='.length))];
        sessionStorage.setItem(key, JSON.stringify(session));
      }
    }, { once: true });
  });
  const calls = [], unmatched = [], injected = [], attempts = {}, gates = {}, state = initial();
  parity.page.on('console', (message) => {
    if (consumeResourceDiagnostic(message.text(), message.location().url, injected)) {
      const index = parity.faults.indexOf(`console.error: ${message.text()}`);
      if (index >= 0) parity.faults.splice(index, 1);
    }
  });
  const docsFixture = (url) => {
    const collection = /\/collections\/([^/]+)\/documents/.exec(url.pathname)?.[1];
    if (collection === 'refunds') return fixtures['mongo:documents-collection-refunds'];
    if (collection !== 'orders') return fixtures['mongo:documents-empty'];
    if (state.empty) return fixtures['mongo:documents-empty'];
    if (state.noId) return fixtures['mongo:document-without-id'];
    if (url.searchParams.get('page[after]') === 'c1') return fixtures['mongo:documents-page-2'];
    const filter = url.searchParams.get('filter');
    // A filter of {"status":"paid"} matches one document; any other filter matches nothing.
    if (filter !== null) return filter === '{"status":"paid"}' ? fixtures['mongo:documents-filtered-paid'] : fixtures['mongo:documents-empty'];
    if (url.searchParams.get('page[size]') === '50') return fixtures['mongo:documents-size-50'];
    if (state.deleted) return fixtures['mongo:documents-after-delete'];
    if (state.updated) return fixtures['mongo:documents-after-update'];
    if (state.inserted) return fixtures['mongo:documents-after-insert'];
    return fixtures['mongo:documents-page-1'];
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
      const messages = { insert: 'synthetic insert failure', update: 'synthetic update failure', delete: 'synthetic delete failure' };
      return variant === 'network' ? { network: true } : { status: variant, body: { code: `HTTP_${variant}`, message: variant === 500 && messages[key] ? messages[key] : 'synthetic failure', requestId: 'mongo-browser-request' } };
    };
    // A held request waits until the test releases it, so busy and loading states are asserted without timing races.
    const gated = async (key) => { if (gates[key]) await gates[key]; };
    let response;
    if (method === 'GET' && /\/collections\/[^/]+\/documents$/.test(url.pathname) && url.pathname.startsWith(`/v1/mongo/workspaces/${workspace}/data/`)) {
      if (headers.apikey !== undefined) {
        if (headers.authorization !== undefined || path !== urls.preview) return reject();
        record(); await gated('preview'); response = failure('preview') ?? { body: fixtures['mongo:preview-2'] };
      } else {
        if (!url.searchParams.has('page[size]')) return reject();
        record(); await gated('docs'); response = failure('docs') ?? { body: docsFixture(url) };
      }
    } else if (method === 'POST' && path === paths.docs) {
      record(); await gated('insert'); response = failure('insert') ?? (() => { state.inserted = true; return { body: fixtures['mongo:insert-ok'] }; })();
    } else if (method === 'PATCH' && path === paths.doc) {
      record(); await gated('update'); response = failure('update') ?? { body: fixtures['mongo:update-ok'] }; if (response.body) state.updated = true;
    } else if (method === 'DELETE' && path === paths.doc) {
      record(); await gated('delete'); response = failure('delete') ?? { body: fixtures['mongo:delete-ok'] }; if (response.body) state.deleted = true;
    } else if (method === 'POST' && path === paths.keys && body?.keyType === 'anon') {
      record(); response = { body: fixtures['mongo:anon-key-issued-synthetic'] };
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
  return { calls, unmatched, state, urls, paths,
    // Drop the recorded requests only; fixture state (inserted, updated...) stays so that later reloads show it.
    reset() { calls.length = 0; },
    hold(key) { let release; gates[key] = new Promise((resolve) => { release = resolve; }); return () => { delete gates[key]; release(); }; },
    async open(patch = {}) {
      Object.assign(state, initial(), patch);
      for (const key of Object.keys(attempts)) delete attempts[key];
      for (const key of Object.keys(gates)) delete gates[key];
      calls.length = 0;
      await parity.page.context().addCookies([{ name: 'mongo-data-role', value: encodeURIComponent(state.role), url: `${server.origin}/` }]);
      await parity.open('/console/mongo/data');
    } };
}
