// Black-box test suite for change add-flows-control-plane-api (#361) — public route catalog gate.
//
// The flat allow-list at deploy/gateway-config/public-route-catalog.json is the AUTHORITATIVE
// gateway allow-list: a path not present there is rejected (404-before-route) at the gateway.
// These tests assert the flows routes are present with the correct privilege_domain — the
// spec's gatewayRouteClass split (control vs data-control) maps 1:1 onto
// privilege_domain (structural_admin vs data_access). (See design.md D7-note: the GENERATED
// internal-contracts catalog is gateway-owned and not editable in this change's scope.)
//
// Tests: bbx-flows-api-route-01 .. bbx-flows-api-route-06
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const catalog = JSON.parse(readFileSync(resolve(REPO, 'deploy/gateway-config/public-route-catalog.json'), 'utf8'));

function entry(method, path) {
  return catalog.find((r) => r.method === method && r.path === path);
}
function has(method, path, domain) {
  const e = entry(method, path);
  return e !== undefined && e.privilege_domain === domain;
}

const WS = '/v1/flows/workspaces/{workspaceId}/flows';
const WS_BASE = '/v1/flows/workspaces/{workspaceId}';

const DEFINITION_ROUTES = [
  ['GET', `${WS}`],
  ['POST', `${WS}`],
  ['GET', `${WS}/{flowId}`],
  ['PATCH', `${WS}/{flowId}`],
  ['DELETE', `${WS}/{flowId}`],
  ['POST', `${WS}/{flowId}/validate`],
  ['POST', `${WS}/{flowId}/versions`],
  ['GET', `${WS}/{flowId}/versions`],
  ['GET', `${WS}/{flowId}/versions/{version}`],
];

const EXECUTION_ROUTES = [
  ['POST', `${WS}/{flowId}/executions`],
  ['GET', `${WS}/{flowId}/executions`],
  ['GET', `${WS}/{flowId}/executions/{executionId}`],
  ['POST', `${WS}/{flowId}/executions/{executionId}/cancellations`],
  ['POST', `${WS}/{flowId}/executions/{executionId}/retries`],
  ['POST', `${WS}/{flowId}/executions/{executionId}/signals/{signalName}`],
];

// Schedule-management routes (#680): same control-plane privilege class as definition management —
// listing/pausing/resuming/triggering a schedule is a structural_admin operation, NOT data_access.
const SCHEDULE_ROUTES = [
  ['GET', `${WS_BASE}/schedules`],
  ['GET', `${WS}/{flowId}/schedule`],
  ['POST', `${WS}/{flowId}/schedule/pause`],
  ['POST', `${WS}/{flowId}/schedule/resume`],
  ['POST', `${WS}/{flowId}/schedule/trigger`],
];

// bbx-flows-api-route-01: every definition-management route is present as structural_admin (≙ control).
test('bbx-flows-api-route-01: definition-management routes are structural_admin (control class)', () => {
  for (const [method, path] of DEFINITION_ROUTES) {
    assert.ok(has(method, path, 'structural_admin'), `${method} ${path} must be structural_admin`);
  }
});

// bbx-flows-api-route-02: every execution route is present as data_access (≙ data-control).
test('bbx-flows-api-route-02: execution routes are data_access (data-control class)', () => {
  for (const [method, path] of EXECUTION_ROUTES) {
    assert.ok(has(method, path, 'data_access'), `${method} ${path} must be data_access`);
  }
});

// bbx-flows-api-route-03: all 20 flows routes are present in the catalog.
test('bbx-flows-api-route-03: all 20 flows routes are registered in the allow-list', () => {
  const all = [...DEFINITION_ROUTES, ...EXECUTION_ROUTES, ...SCHEDULE_ROUTES];
  assert.equal(all.length, 20, 'exactly 20 flows routes');
  for (const [method, path] of all) {
    assert.ok(entry(method, path), `${method} ${path} present in the gateway allow-list`);
  }
});

// bbx-flows-api-route-04: execution routes are NEVER mis-domained as structural_admin (privilege drift guard).
test('bbx-flows-api-route-04: execution routes are not mis-domained as structural_admin', () => {
  for (const [method, path] of EXECUTION_ROUTES) {
    assert.ok(!has(method, path, 'structural_admin'), `${method} ${path} must stay data_access`);
  }
});

// bbx-flows-api-route-05: every schedule-management route is present as structural_admin (≙ control).
test('bbx-flows-api-route-05: schedule-management routes are structural_admin (control class)', () => {
  for (const [method, path] of SCHEDULE_ROUTES) {
    assert.ok(has(method, path, 'structural_admin'), `${method} ${path} must be structural_admin`);
  }
});

// bbx-flows-api-route-06: schedule routes are NEVER mis-domained as data_access (privilege drift guard).
test('bbx-flows-api-route-06: schedule routes are not mis-domained as data_access', () => {
  for (const [method, path] of SCHEDULE_ROUTES) {
    assert.ok(!has(method, path, 'data_access'), `${method} ${path} must stay structural_admin`);
  }
});
