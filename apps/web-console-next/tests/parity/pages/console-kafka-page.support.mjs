import { buildConsoleRefreshSessionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures';
import { fixtures, paths, legacyJourneyFixtures } from './console-kafka-page.manifest.ts';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';

const initial = () => ({ errors: {}, recover: [], refresh: null, replay401: [], inventory: 'kafka:inventory-3-with-bridges', metadata: 'kafka:topic-metadata', stream: 'kafka:stream-5-events', tenantNone: false, workspaceNone: false, legacy: false, legacyEmpty: false });
const fixtureFor = { inventory: 'kafka:inventory-3-with-bridges', bridge: 'kafka:bridge-1', detail: 'kafka:topic-detail', access: 'kafka:topic-access', metadata: 'kafka:topic-metadata', publish: 'kafka:publish-accepted' };
export function scenario(name) {
  if (name.startsWith('kafka:legacy-service-')) return { legacy: true, legacyEmpty: name.endsWith('empty'), errors: name.endsWith('error') ? { inventory: 503 } : {} };
  if (name === 'shell:tenant-none') return { tenantNone: true };
  if (name === 'shell:workspace-none') return { workspaceNone: true };
  if (name === 'kafka:inventory-401-refresh-rejected') return { errors: { inventory: 401 }, refresh: 'rejected' };
  if (name.includes('replay-401')) { const key = name === 'kafka:inventory-replay-401' ? 'inventory' : name.split('-')[1]; return { errors: { [key]: 401 }, replay401: [key], refresh: 'ok' }; }
  if (name === 'kafka:topic-404') return { errors: { detail: 404 } };
  if (name.startsWith('kafka:stream-')) {
    if (['kafka:stream-401', 'kafka:stream-503'].includes(name)) return { errors: { stream: Number(name.split('-').at(-1)) } };
    return { stream: name };
  }
  if (name.startsWith('kafka:inventory-') && name in fixtures) return { inventory: name };
  if (['kafka:topic-metadata-legacy-fields', 'kafka:topic-metadata-empty-partitions'].includes(name)) return { metadata: name };
  const match = /^kafka:(?:topic-)?(inventory|bridge|detail|access|metadata|publish)-(500|403|429|401|network)$/.exec(name);
  if (match) return { errors: { [match[1]]: match[2] === 'network' ? 'network' : Number(match[2]) }, refresh: match[2] === '401' ? 'ok' : null };
  return {};
}

export async function installKafkaHarness(parity) {
  // Fetch still sends the actual SSE GET and bearer to the mocked backend. This adapter holds the
  // fixture response body open, because Playwright route.fulfill otherwise closes finite SSE bodies.
  // Abort, drop and cancellation use ReadableStream, exercising the page's actual reader lifecycle.
  await parity.page.addInitScript(() => {
    // The mirrored legacy journey uses its original workspace identifier. Keep the
    // synthetic session's membership aligned with both workspace fixtures.
    document.addEventListener('readystatechange', () => {
      if (document.readyState !== 'interactive') return;
      const key = 'in-falcone.console-shell-session', session = JSON.parse(sessionStorage.getItem(key));
      session.principal.workspaceIds = ['synthetic-workspace', 'ws_alpha_prod'];
      sessionStorage.setItem(key, JSON.stringify(session));
    }, { once: true });
    const original = window.fetch.bind(window);
    window.__kafkaOpenStreams = 0;
    window.fetch = async (input, options) => {
      const response = await original(input, options);
      if (!String(input).match(/\/v1\/events\/topics\/[^/]+\/stream$/) || !response.ok) return response;
      const text = await response.text(); let source, closed = false;
      const finish = () => { if (!closed) { closed = true; window.__kafkaOpenStreams--; options?.signal?.removeEventListener('abort', abort); } };
      const abort = () => { if (!closed) { source.close(); finish(); } };
      const body = new ReadableStream({ start(controller) { source = controller; window.__kafkaOpenStreams++; if (text) controller.enqueue(new TextEncoder().encode(text)); }, cancel() { finish(); } });
      options?.signal?.addEventListener('abort', abort, { once: true });
      if (options?.signal?.aborted) abort();
      window.__kafkaDrop = () => { if (!closed) { source.error(new TypeError('Synthetic dropped stream')); finish(); } };
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
  });
  const state = initial(), calls = [], unmatched = [], injected = [], attempts = {}, gates = {};
  parity.page.on('console', (message) => {
    if (!consumeResourceDiagnostic(message.text(), message.location().url, injected)) return;
    const index = parity.faults.indexOf(`console.error: ${message.text()}`); if (index >= 0) parity.faults.splice(index, 1);
  });
  await parity.page.route('**/v1/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const path = url.pathname + url.search;
    let body; try { body = request.postDataJSON() ?? undefined; } catch { body = request.postData(); }
    const reject = async () => { unmatched.push(`${method} ${path}`); await route.abort(); };
    const inventory = state.legacy ? legacyJourneyFixtures[state.legacyEmpty ? 'empty' : 'inventory'] : fixtures[state.inventory];
    const topic = inventory.items.find(({ resourceId }) => ['detail', 'access', 'metadata', 'publish', 'stream'].some((key) => url.pathname === new URL(paths[key], 'http://local').pathname.replace('/res_topic_1', `/${resourceId}`)));
    const key = Object.keys(paths).find((key) => {
      if (key === 'refresh') return false;
      const expected = new URL(paths[key], 'http://local').pathname;
      return url.pathname === (['inventory', 'bridge'].includes(key)
        ? expected.replace('/synthetic-workspace/', `/${state.legacy ? 'ws_alpha_prod' : 'synthetic-workspace'}/`)
        : topic ? expected.replace('/res_topic_1', `/${topic.resourceId}`) : null);
    });
    let response;
    if (key) {
      if (method !== (key === 'publish' ? 'POST' : 'GET')) return reject();
      if (key === 'inventory' ? url.searchParams.get('page[size]') !== '100' || [...url.searchParams].length !== 1 : Boolean(url.search)) return reject();
      calls.push({ method, path, body, authorization: request.headers().authorization }); attempts[key] = (attempts[key] ?? 0) + 1; if (gates[key]) await gates[key];
      const error = state.errors[key], failing = error && !(state.recover.includes(key) && attempts[key] > 1) && !(error === 401 && attempts[key] > 1 && !state.replay401.includes(key));
      if (failing) response = error === 'network' ? { network: true } : { status: error, body: { message: 'Synthetic backend failure', requestId: 'kafka-browser-request' } };
      else if (key === 'stream') {
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: state.stream === 'kafka:stream-dropped' ? '' : fixtures[state.stream] ?? '' }); return;
      } else if (state.legacy) response = { body: legacyJourneyFixtures[key === 'inventory' && state.legacyEmpty ? 'empty' : key] };
      else {
        const fixture = fixtures[key === 'inventory' ? state.inventory : key === 'metadata' ? state.metadata : fixtureFor[key]];
        response = { body: topic ? { ...fixture, resourceId: topic.resourceId, topicName: topic.topicName } : fixture };
      }
    } else if (method === 'POST' && path === paths.refresh && state.refresh) {
      calls.push({ method, path, body, authorization: request.headers().authorization });
      response = state.refresh === 'rejected' ? { status: 400, body: {} } : { body: buildConsoleRefreshSessionFixture() };
    } else if (method === 'GET' && url.pathname === '/v1/tenants' && state.tenantNone) response = { body: { items: [], page: {} } };
    else if (method === 'GET' && url.pathname === '/v1/workspaces' && state.workspaceNone) response = { body: { items: [], page: {} } };
    else if (method === 'GET' && url.pathname === '/v1/workspaces' && state.legacy) { const body = buildWorkspaceCollectionFixture(); body.items[0].workspaceId = 'ws_alpha_prod'; response = { body }; }
    else if (method === 'GET' && ['/v1/tenants', '/v1/tenants/synthetic-tenant', '/v1/workspaces', '/v1/auth/signups/policy'].includes(url.pathname)) return route.fallback();
    else return reject();
    if (response.network || response.status >= 400) injected.push({ url: request.url(), kind: response.network ? 'network' : String(response.status) });
    if (response.network) await route.abort('failed'); else await route.fulfill({ status: response.status ?? 200, json: response.body });
  });
  return { calls, state, unmatched, paths,
    async open(name = 'kafka:inventory-3-with-bridges', patch = {}) {
      Object.assign(state, initial(), scenario(name), patch); calls.length = 0;
      for (const key of Object.keys(attempts)) delete attempts[key];
      await parity.open('/console/kafka');
    },
    count(key) { return calls.filter(({ path }) => new URL(path, 'http://local').pathname === new URL(paths[key], 'http://local').pathname).length; },
    hold(key) { let release; gates[key] = new Promise((resolve) => { release = resolve; }); return () => { delete gates[key]; release(); }; },
    reset() { calls.length = 0; },
  };
}
