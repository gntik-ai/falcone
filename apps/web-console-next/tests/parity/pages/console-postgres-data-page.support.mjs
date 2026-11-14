import { buildConsoleRefreshSessionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures';
import { keysAfterIssue, pg } from './console-postgres-data-page.manifest.ts';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';

export const workspace = 'synthetic-workspace';
const rowsRoute = new RegExp(`^/v1/postgres/workspaces/${workspace}/data/app_db/schemas/(?:public|other)/tables/(accounts|orders)/rows(/by-primary-key)?$`);
const keysRoute = new RegExp(`^/v1/workspaces/${workspace}/api-keys(?:/(key-\\d+))?$`);
const mainParams = new Set(['page[size]', 'page[after]', 'countMode', 'plan', 'id']);
const defaults = () => ({
  rowsFailure: null, keysFailure: null, rowsFixture: 'pg-rows-page1', keysFixture: 'pg-api-keys', empty: [], slow: [], insert: 'ok', issue: 'ok', preview: 'ok',
  refresh: null, workspaces: null, role: 'tenant_owner', recovered: { rows: false, keys: false, workspaces: false },
});

// A mocked backend for /console/postgres/data. `calls` records every page request with its headers,
// so a scenario asserts only what it sent. Failures it injects are registered as expected diagnostics;
// every other console error, CSP violation or unmatched /v1 request still fails the journey.
export async function installPostgresDataHarness(parity, server) {
  await parity.page.addInitScript(() => {
    document.addEventListener('readystatechange', () => {
      if (document.readyState !== 'interactive') return;
      const raw = document.cookie.split('; ').find((entry) => entry.startsWith('pgdata-role='));
      if (!raw) return;
      const key = 'in-falcone.console-shell-session', session = JSON.parse(sessionStorage.getItem(key));
      session.principal.workspaceIds = [];
      session.principal.platformRoles = [decodeURIComponent(raw.slice('pgdata-role='.length))];
      sessionStorage.setItem(key, JSON.stringify(session));
    }, { once: true });
  });
  const calls = [], unmatched = [], injected = [], gates = {};
  const state = defaults();
  let attempts = {};
  parity.page.on('console', (message) => {
    if (consumeResourceDiagnostic(message.text(), message.location().url, injected)) {
      const index = parity.faults.indexOf(`console.error: ${message.text()}`);
      if (index >= 0) parity.faults.splice(index, 1);
    }
  });
  const gate = async (name) => {
    if (!state.slow.includes(name)) return;
    gates[name] ??= (() => { let release; const promise = new Promise((resolve) => { release = resolve; }); return { promise, release }; })();
    await gates[name].promise;
  };
  await parity.page.route('**/v1/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname + url.search, method = request.method(), headers = request.headers();
    let body; try { body = request.postDataJSON() ?? undefined; } catch { body = undefined; }
    const reject = async () => { unmatched.push(`${method} ${path}`); await route.abort(); };
    const record = () => calls.push({ method, path, body, apikey: headers.apikey, authorization: headers.authorization, accept: headers.accept, contentType: headers['content-type'], apiVersion: headers['x-api-version'], correlation: headers['x-correlation-id'] });
    const rows = rowsRoute.exec(url.pathname), keys = keysRoute.exec(url.pathname);
    let response;
    if (rows) {
      const byKey = Boolean(rows[2]);
      if (method === 'GET' && !byKey && headers.apikey) {
        if ([...url.searchParams.keys()].join() !== 'page[size]' || url.searchParams.get('page[size]') !== '10' || headers.authorization) return reject();
        record();
        if (state.preview === '401') response = { status: 401, body: { code: 'HTTP_401', message: 'key rejected' } };
        else { await gate('preview'); response = { body: pg['pg-rows-preview-apikey'] }; }
      } else if (method === 'GET' && !byKey) {
        if ([...url.searchParams.keys()].some((key) => !mainParams.has(key)) || url.searchParams.get('countMode') !== 'exact') return reject();
        record(); attempts.rows = (attempts.rows ?? 0) + 1;
        const failure = state.rowsFailure;
        if (failure && !state.recovered.rows && (failure !== 401 || attempts.rows === 1)) response = { status: failure === 'network' ? 200 : failure, network: failure === 'network', body: { code: `HTTP_${failure}`, requestId: 'pg-browser-request' } };
        else if (state.empty.includes('rows')) response = { body: pg['pg-rows-empty'] };
        else if (url.searchParams.get('page[after]') === 'c1') response = { body: pg['pg-rows-page2'] };
        else response = { body: structuredClone(pg[state.rowsFixture]) };
        if (state.slow.includes('rows')) { await gate('rows'); }
      } else if (method === 'POST' && !byKey && url.search === '') {
        record(); await gate('insert');
        if (state.insert === '500') response = { status: 500, body: { code: 'HTTP_500', message: 'insert exploded' } };
        else { state.rowsFixture = 'pg-rows-after-insert'; response = { body: pg['pg-row-insert-ok'] }; }
      } else if (method === 'PATCH' && byKey && url.search === '?id=acc-1') {
        record(); await gate('patch'); state.rowsFixture = 'pg-rows-after-patch'; response = { body: pg['pg-row-patch-ok'] };
      } else if (method === 'DELETE' && byKey && url.search === '?id=acc-1') {
        record(); state.rowsFixture = 'pg-rows-after-delete'; response = { body: pg['pg-row-delete-ok'] };
      } else return reject();
    } else if (keys) {
      if (method === 'GET' && !keys[1] && url.search === '') {
        record(); attempts.keys = (attempts.keys ?? 0) + 1;
        if (state.keysFailure && !state.recovered.keys) response = { status: state.keysFailure, body: { code: `HTTP_${state.keysFailure}`, requestId: 'pg-keys-request' } };
        else response = { body: state.empty.includes('keys') ? pg['pg-api-keys-empty'] : pg[state.keysFixture] ?? keysAfterIssue };
        if (state.slow.includes('keys')) await gate('keys');
      } else if (method === 'POST' && !keys[1] && url.search === '' && ['anon', 'service'].includes(body?.keyType)) {
        record();
        if (state.issue === '500') response = { status: 500, body: { code: 'HTTP_500', message: 'issue denied' } };
        else { if (body.keyType === 'anon') state.keysFixture = 'issued'; response = { body: pg[`pg-api-key-issue-${body.keyType}`] }; }
      } else if (method === 'DELETE' && keys[1] === 'key-1' && url.search === '') {
        record(); state.keysFixture = 'pg-api-keys-after-revoke'; response = { body: pg['pg-api-key-revoke-ok'] };
      } else return reject();
    } else if (method === 'POST' && path === '/v1/auth/login-sessions/synthetic-session/refresh' && state.refresh) {
      record(); response = state.refresh === 'rejected' ? { status: 400, body: {} } : { body: buildConsoleRefreshSessionFixture() };
    } else if (method === 'GET' && url.pathname === '/v1/workspaces' && state.workspaces) {
      record(); attempts.workspaces = (attempts.workspaces ?? 0) + 1;
      if (typeof state.workspaces === 'number' && !state.recovered.workspaces) response = { status: state.workspaces, body: { code: `HTTP_${state.workspaces}` } };
      else {
        const value = buildWorkspaceCollectionFixture();
        if (state.workspaces === 'empty') value.items = [];
        else if (state.workspaces === 'two' || typeof state.workspaces === 'number') value.items.push({ ...value.items[0], workspaceId: 'synthetic-second-workspace', displayName: 'Second Workspace' });
        response = { body: value };
      }
    } else if (method === 'GET' && ['/v1/tenants', '/v1/tenants/synthetic-tenant', '/v1/workspaces', '/v1/auth/signups/policy'].includes(url.pathname)) return route.fallback();
    else return reject();
    if (response.network || response.status >= 400) injected.push({ url: request.url(), kind: response.network ? 'network' : String(response.status) });
    if (response.network) await route.abort('failed'); else await route.fulfill({ status: response.status ?? 200, json: response.body });
  });
  const harness = {
    calls, unmatched, state, injected,
    release: (name) => gates[name]?.release(),
    // Resets fixtures and the recorded requests, so an action scenario asserts only its own writes.
    async open(patch = {}, route = '/console/postgres/data') {
      for (const name of Object.keys(gates)) { gates[name].release(); delete gates[name]; }
      Object.assign(state, defaults(), patch); attempts = {}; calls.length = 0;
      await parity.page.context().addCookies([{ name: 'pgdata-role', value: encodeURIComponent(state.role), url: `${server.origin}/` }]);
      await parity.open(route);
    },
    writes: () => calls.filter(({ method }) => method !== 'GET'),
    reads: (matcher) => calls.filter(({ method, path }) => method === 'GET' && matcher(path)),
  };
  return harness;
}
