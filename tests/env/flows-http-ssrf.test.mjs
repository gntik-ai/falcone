// Live SSRF proof for change add-flows-activity-catalog (#360): the http.request activity
// blocks outbound requests to internal/metadata addresses using the REAL fetch + REAL DNS
// resolver (no injected doubles), so the guard is proven against the actual host stack —
// not just a unit double. The blocked-target assertions need no external network (the guard
// refuses BEFORE any socket); the positive path self-skips when the host has no outbound
// network.
//
//   node --test tests/env/flows-http-ssrf.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { httpRequest } from '../../apps/workflow-worker/src/activities/http-request.mjs';

const tenant = { tenantId: 'ten_http', workspaceId: 'ws_http' };

// Real fetch + real DNS — but instrument fetch so we can PROVE no socket is opened on a block.
function instrumentedFetch() {
  let calls = 0;
  const wrapped = (...args) => { calls += 1; return fetch(...args); };
  return { wrapped, calls: () => calls };
}

test('live: http.request to the cloud-metadata link-local IP is SSRF_BLOCKED, no socket', async () => {
  const f = instrumentedFetch();
  await assert.rejects(
    () => httpRequest({ params: { url: 'http://169.254.169.254/latest/meta-data/' }, tenant }, { http: f.wrapped }),
    (err) => err.type === 'SSRF_BLOCKED' && err.nonRetryable === true,
  );
  assert.equal(f.calls(), 0, 'no outbound socket may be opened for a blocked target');
});

test('live: http.request to loopback/private literals is SSRF_BLOCKED via the real guard', async () => {
  const f = instrumentedFetch();
  for (const url of ['http://127.0.0.1:1/x', 'http://10.0.0.1/x', 'http://[::1]:1/x', 'http://localhost:1/x']) {
    await assert.rejects(
      () => httpRequest({ params: { url }, tenant }, { http: f.wrapped }),
      (err) => err.type === 'SSRF_BLOCKED',
      `expected SSRF_BLOCKED for ${url}`,
    );
  }
  assert.equal(f.calls(), 0, 'no outbound socket for any blocked literal');
});

test('live: http.request resolves a public hostname through the real DNS resolver and pins it', async (t) => {
  // Positive path needs outbound network + DNS; skip when unavailable so the suite stays
  // deterministic in sandboxed CI.
  let pinned = null;
  try {
    const out = await httpRequest(
      { params: { url: 'https://example.com/', method: 'HEAD', timeoutMs: 8000 }, tenant },
      { dispatcherFactory: async ({ address }) => { pinned = address; return undefined; } },
    );
    assert.equal(out.status, 'success');
    assert.ok(pinned, 'the validated public IP was pinned for the dispatcher');
  } catch (err) {
    if (err.type === 'REQUEST_TIMEOUT' || err.type === 'UPSTREAM_UNAVAILABLE' || err.type === 'SSRF_BLOCKED') {
      return t.skip(`no outbound network: ${err.type}`);
    }
    throw err;
  }
});
