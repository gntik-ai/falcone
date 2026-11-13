import { pg } from './console-postgres-page.manifest.ts';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';

export async function installPostgresHarness(parity) {
  const calls = [], unmatched = [], diagnostics = [], allowedFaults = [];
  parity.page.on('console', (message) => {
    if (message.type() === 'error' && consumeResourceDiagnostic(message.text(), message.location().url, diagnostics)) allowedFaults.push(`console.error: ${message.text()}`);
  });
  const tenant = 'synthetic-tenant', workspace = 'synthetic-workspace';
  const quotaPaths = [`/v1/metrics/tenants/${tenant}/quotas`, `/v1/metrics/tenants/${tenant}/overview`, `/v1/metrics/workspaces/${workspace}/quotas`, `/v1/metrics/workspaces/${workspace}/overview`];
  const createPath = `/v1/workspaces/${workspace}/databases`;
  const defaults = {
    ...pg.reads(),
    ...Object.fromEntries(quotaPaths.map((path) => [`GET ${path}`, path.endsWith('/quotas') ? pg.quotasAvailable : {}])),
    [`POST ${createPath}`]: { databaseId: 'synthetic-created-db' },
    [`PUT ${pg.detail}`]: pg.ddl,
    [`PUT ${pg.objects}/views/active_accounts`]: pg.ddl,
    [`PUT ${pg.objects}/materialized-views/accounts_snapshot`]: pg.ddl,
  };
  let routes = { ...defaults };
  // Only the explicitly enumerated page requests are intercepted; everything else stays in the shell harness.
  await parity.page.route(/\/v1\/(?:postgres\/|metrics\/(?:tenants|workspaces)\/|workspaces\/[^/]+\/databases(?:\?|$))/, async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname + url.search, method = request.method();
    let body; try { body = request.postDataJSON() ?? undefined; } catch { body = request.postData(); }
    calls.push({ method, path, body });
    const key = `${method} ${path}`;
    if (!(key in routes)) { unmatched.push(key); await route.abort(); return; }
    const value = typeof routes[key] === 'function' ? routes[key](calls.filter((call) => `${call.method} ${call.path}` === key).length) : routes[key];
    if (value?.delayMs) await new Promise((resolve) => setTimeout(resolve, value.delayMs));
    if (value?.network || value?.status >= 400) diagnostics.push({ url: request.url(), kind: value.network ? 'network' : String(value.status) });
    if (value?.network) await route.abort('failed');
    else await route.fulfill({ status: value?.status ?? 200, json: value && Object.hasOwn(value, 'body') ? value.body : value });
  });
  return {
    calls, unmatched, quotaPaths, createPath,
    use(overrides = {}) { routes = { ...defaults, ...overrides }; calls.length = 0; },
    cleanFaults() {
      // Only injected, URL-matched resource errors are allowed; application errors remain failures.
      parity.faults.splice(0, parity.faults.length, ...parity.faults.filter((fault) => !allowedFaults.includes(fault)));
    },
  };
}
