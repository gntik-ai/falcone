/**
 * Black-box regression suite for spec change add-apisix-flows-mcp-routes
 * (live E2E campaign 2026-06-18, finding #560, epic #542).
 *
 * Parses the standalone APISIX route table (deploy/kind/apisix/apisix.yaml) as plain text and
 * asserts the gateway forwards /v1/flows/* and /v1/mcp/* to the EXECUTOR upstream — the same
 * upstream and the same gateway-trust idiom (header-strip + x-gateway-auth injection) used by the
 * existing executor-bound control routes (e.g. 2003-keys). The JWT/api-key auth is verified by the
 * executor itself; the gateway's job is only to route the path and inject the trust signal.
 *
 * Defect: the standalone APISIX config had NO /v1/flows or /v1/mcp route, so both fell through to
 * the /v1/* catch-all (id 5000 -> falcone-control-plane), which does not serve them — 404
 * NO_ROUTE at the gateway, 200 only against the executor directly.
 *
 * Tests render-free: a regex parse of the YAML route blocks (mirrors the gateway-config route
 * catalog tests, which also parse static config without a live gateway).
 *
 * Scenario coverage (capability: gateway / spec.md):
 *   bbx-560-01  apisix.yaml declares a /v1/flows/* route to the executor upstream
 *   bbx-560-02  apisix.yaml declares a /v1/mcp/* route to the executor upstream
 *   bbx-560-03  both routes outrank the /v1/* control-plane catch-all (id 5000, priority 50)
 *   bbx-560-04  both routes inject the gateway-trust signal (x-gateway-auth) like other executor routes
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const APISIX = resolve(REPO_ROOT, 'deploy', 'kind', 'apisix', 'apisix.yaml');
const EXECUTOR_UPSTREAM = 'falcone-cp-executor.falcone.svc.cluster.local:8080';

const yaml = readFileSync(APISIX, 'utf8');

/** Split the YAML into per-route blocks keyed on the `- id:` list items under `routes:`. */
function routeBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let cur = null;
  for (const l of lines) {
    if (/^\s*-\s+id:\s*/.test(l)) {
      if (cur) blocks.push(cur.join('\n'));
      cur = [l];
    } else if (cur) {
      cur.push(l);
    }
  }
  if (cur) blocks.push(cur.join('\n'));
  return blocks;
}

const BLOCKS = routeBlocks(yaml);

/** Find the route block whose `uri:` matches the given prefix and that targets the executor. */
function executorRouteFor(uriPrefix) {
  return BLOCKS.find(
    (b) =>
      new RegExp(`uri:\\s*"?${uriPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(b) &&
      b.includes(EXECUTOR_UPSTREAM),
  );
}

function priorityOf(block) {
  const m = block.match(/priority:\s*(\d+)/);
  return m ? Number(m[1]) : NaN;
}

// -------------------------------------------------------------------------
// bbx-560-01: /v1/flows/* -> executor
// -------------------------------------------------------------------------
test('bbx-560-01: apisix.yaml routes /v1/flows/* to the executor upstream', () => {
  const block = executorRouteFor('/v1/flows/');
  assert.ok(block, '/v1/flows/* must route to the falcone-cp-executor upstream');
});

// -------------------------------------------------------------------------
// bbx-560-02: /v1/mcp/* -> executor
// -------------------------------------------------------------------------
test('bbx-560-02: apisix.yaml routes /v1/mcp/* to the executor upstream', () => {
  const block = executorRouteFor('/v1/mcp/');
  assert.ok(block, '/v1/mcp/* must route to the falcone-cp-executor upstream');
});

// -------------------------------------------------------------------------
// bbx-560-03: both routes outrank the /v1/* control-plane catch-all (priority 50)
// -------------------------------------------------------------------------
test('bbx-560-03: flows/mcp executor routes outrank the /v1/* catch-all (id 5000)', () => {
  const catchAll = BLOCKS.find((b) => /id:\s*"?5000"?/.test(b));
  assert.ok(catchAll, 'the /v1/* catch-all route (id 5000) must exist');
  const catchAllPrio = priorityOf(catchAll);
  for (const prefix of ['/v1/flows/', '/v1/mcp/']) {
    const block = executorRouteFor(prefix);
    assert.ok(block, `${prefix}* executor route must exist`);
    assert.ok(
      priorityOf(block) > catchAllPrio,
      `${prefix}* (priority ${priorityOf(block)}) must outrank the catch-all (priority ${catchAllPrio})`,
    );
  }
});

// -------------------------------------------------------------------------
// bbx-560-04: both routes inject the gateway-trust signal like other executor routes
// -------------------------------------------------------------------------
test('bbx-560-04: flows/mcp executor routes inject x-gateway-auth (gateway-trust)', () => {
  for (const prefix of ['/v1/flows/', '/v1/mcp/']) {
    const block = executorRouteFor(prefix);
    assert.ok(block, `${prefix}* executor route must exist`);
    assert.match(
      block,
      /x-gateway-auth:\s*"\$\{\{GATEWAY_SHARED_SECRET\}\}"/,
      `${prefix}* must inject x-gateway-auth so the executor trusts the gateway`,
    );
  }
});
