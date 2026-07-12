import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDevPlan } from './dev.mjs';

const context = { tenantId: 'ten-a', workspaceId: 'ws-1', token: 't', apiBaseUrl: 'https://api.test' };

test('buildDevPlan: run + tunnel + inspector bound to the credential tenant/workspace', () => {
  const plan = buildDevPlan({ context, port: 9090 });
  assert.equal(plan.run.port, 9090);
  assert.equal(plan.tunnel.tenantId, 'ten-a');
  assert.equal(plan.tunnel.workspaceId, 'ws-1');
  assert.equal(plan.inspector.target, 'http://127.0.0.1:9090');
  assert.match(plan.inspector.url, /127\.0\.0\.1/);
});

test('buildDevPlan: requires a workspace in context', () => {
  assert.throws(() => buildDevPlan({ context: { tenantId: 'ten-a', workspaceId: null } }), /workspace is required/);
});
