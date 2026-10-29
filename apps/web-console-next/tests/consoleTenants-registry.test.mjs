import assert from 'node:assert/strict';
import test from 'node:test';
import { installSession } from './browser-session.mjs';

async function registry() {
  let handler;
  const unmatched = await installSession({ addInitScript: async () => {}, route: async (_pattern, callback) => { handler = callback; } });
  return { unmatched, async send(method, path) {
    let response, aborted = false;
    const request = { url: () => `http://localhost${path}`, method: () => method, postDataJSON: () => undefined };
    await handler({ request: () => request, fulfill: async (value) => { response = value; }, abort: async () => { aborted = true; } });
    return { response, aborted };
  } };
}
test('the no-tenant CSP registry answers exactly both platform metric reads', async () => {
  const fixture = await registry();
  for (const suffix of ['quotas', 'overview']) {
    const result = await fixture.send('GET', `/v1/metrics/tenants/platform/${suffix}`);
    assert.equal(result.aborted, false); assert.equal(result.response.status, 200);
    assert.equal(result.response.json.tenantId, 'platform');
  }
  assert.deepEqual(fixture.unmatched, []);
});
test('stray tenant plan reads, metric scopes, query strings and writes remain unmatched', async () => {
  const fixture = await registry();
  const requests = [['GET', '/v1/tenants/t1/plan'], ['GET', '/v1/metrics/tenants/t1/quotas'], ['GET', '/v1/metrics/tenants/platform/quotas?extra=true'], ['POST', '/v1/metrics/tenants/platform/overview']];
  for (const [method, path] of requests) assert.equal((await fixture.send(method, path)).aborted, true);
  assert.deepEqual(fixture.unmatched, requests.map(([method, path]) => `${method} ${path}`));
});
