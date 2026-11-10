import { canary, createScenario, redacted, scenarios, secretsPath } from './console-workspace-secrets-page.manifest.ts';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';

// Secret values are asserted in memory inside the route handler and replaced by a fixed mask before any request
// log, report line or persisted artifact. Nothing here ever prints the value.
export const sanitize = (text) => String(text ?? '').split(canary).join(redacted);
export async function typeSecret(locator, value) {
  try {
    // A native value setter plus an input event reaches React without the value appearing in a call log.
    await locator.evaluate((element, secret) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, secret);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  } catch (error) { throw new Error(`typeSecret: ${sanitize(error.message)}`); }
}
// Clearing is asserted as a boolean so a failure message can never carry the value.
export const blank = (locator) => locator.evaluate((element) => element.value === '');
export async function expectBlank(expect, locator, what) { expect(await blank(locator), `${what} must be cleared`).toBe(true); }

const workspace = (id, name, environment) => ({ workspaceId: id, tenantId: 'synthetic-tenant', displayName: name, slug: id, environment, state: 'active' });
export function workspacesFor(shell) {
  const environment = shell.environment ?? 'dev';
  if (shell.workspaces === 'two' || shell.workspaces === 'none') return [workspace('synthetic-workspace', 'Synthetic Workspace', environment), workspace('synthetic-other', 'Other Workspace', 'dev')];
  return [workspace('synthetic-workspace', 'Synthetic Workspace', environment)];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Installs the page's own handlers in front of the harness registry: secrets requests are served from the
// manifest scenario, the workspace list from the shell fixture, and everything else falls through.
export function createSecretsHarness(parity) {
  const injected = [];
  const state = { id: null, scenario: createScenario('workspace-secrets.list.success'), matched: [], workspaceReads: 0, shell: {}, refresh: null };
  const redact = (body) => {
    if (!body || typeof body !== 'object' || !('secretValue' in body)) return body;
    // The comparison happens here, in memory; only the boolean and the mask leave this function.
    state.matched.push(body.secretValue === canary);
    return { ...body, secretValue: redacted };
  };
  const record = (request, url, body) => parity.network.requests.push({ method: request.method(), path: url.pathname + url.search, body: redact(body) });
  parity.page.route((url) => url.pathname.startsWith(secretsPath) || url.pathname === '/v1/workspaces' || /\/v1\/auth\/login-sessions\/[^/]+\/refresh$/.test(url.pathname), async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/v1/workspaces') {
      if (request.method() !== 'GET' || !state.id || !Object.keys(state.shell).some((key) => ['environment', 'workspaces'].includes(key))) { await route.fallback(); return; }
      const read = state.workspaceReads++;
      if (state.shell.workspaces === 'loading') await sleep(1500);
      if (state.shell.workspaces === 'error' && read === 0) {
        injected.push({ url: request.url(), kind: '500' });
        await route.fulfill({ status: 500, json: { status: 500, code: 'HTTP_500', message: 'synthetic-backend-reason' } }); return;
      }
      await route.fulfill({ status: 200, json: { items: workspacesFor(state.shell), page: { after: null } } }); return;
    }
    if (url.pathname !== secretsPath && !url.pathname.startsWith(`${secretsPath}/`)) {
      // Refresh: only the rejected fixture overrides it, with the 400 whose resource diagnostic is consumed below.
      if (state.refresh !== 'rejected') { await route.fallback(); return; }
      parity.network.requests.push({ method: request.method(), path: url.pathname, body: undefined });
      injected.push({ url: request.url(), kind: '400' });
      await route.fulfill({ status: 400, json: { status: 400, code: 'REFRESH_REJECTED', message: 'synthetic-backend-reason' } }); return;
    }
    let body;
    try { body = request.postDataJSON() ?? undefined; } catch { body = undefined; }
    record(request, url, body);
    const response = state.scenario.handle(request.method(), url.pathname + url.search, body);
    if (!response) { parity.faults.push(`Unmatched secrets request ${request.method()} ${url.pathname}${url.search}`); await route.abort(); return; }
    if (response.delayMs) await sleep(response.delayMs);
    if (response.network || response.status >= 400) injected.push({ url: request.url(), kind: response.network ? 'network' : String(response.status) });
    if (response.network) await route.abort('failed');
    else if (response.status === 204) await route.fulfill({ status: 204 });
    else await route.fulfill({ status: response.status, json: response.body });
  });
  parity.page.on('console', (message) => {
    if (message.type() !== 'error' || !consumeResourceDiagnostic(message.text(), message.location().url, injected)) return;
    const index = parity.faults.indexOf(`console.error: ${message.text()}`);
    if (index >= 0) parity.faults.splice(index, 1);
  });
  return {
    state,
    use(id) {
      if (!Object.hasOwn(scenarios, id)) throw new Error(`Unknown fixture ${id}`);
      Object.assign(state, { id, scenario: createScenario(id), matched: [], workspaceReads: 0, shell: scenarios[id].shell ?? {}, refresh: id.endsWith('401-refresh-rejected') ? 'rejected' : null });
    },
    calls: () => parity.network.requests.filter(({ path }) => path.startsWith(secretsPath)),
    writes: () => parity.network.requests.filter(({ path, method }) => path.startsWith(secretsPath) && method !== 'GET'),
  };
}
