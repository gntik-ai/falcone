/**
 * Black-box tests for cross-tenant Knative ksvc namespacing
 * (fix-functions-ksvc-tenant-namespacing, P0 ISO-FUNCTIONS).
 *
 * The bug: the deployed Knative Service name derived from the workspace SLUG +
 * action only. Two tenants commonly have a same-named workspace (e.g. both
 * "app-staging"); deploying the same action name collided on ONE shared ksvc, so
 * one tenant's deploy overwrote (and its invoke could run) the other tenant's
 * code. The fix derives the name from the workspace's globally-unique identity
 * (tenant id + workspace id) so same-named workspaces across tenants never share
 * a ksvc.
 *
 * Drives `ksvcNameForWorkspace(workspace, actionName)` — the canonical naming the
 * deploy handler uses — through the public function-executor interface.
 *
 * bbx-fn-ns-01: same slug+action, different workspaces → distinct ksvc names
 * bbx-fn-ns-02: same slug+action+workspace-id, different tenants → distinct names
 * bbx-fn-ns-03: stable for the same workspace+action (so invoke resolves the same ksvc)
 * bbx-fn-ns-04: DNS-1035 valid (<=63, lowercase alnum/-, starts with a letter)
 * bbx-fn-ns-05: distinct even when the workspace slug is absent
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ksvcNameForWorkspace } from '../../apps/control-plane/function-executor.mjs';

const DNS1035 = /^[a-z]([-a-z0-9]*[a-z0-9])?$/;

// Two tenants, each with a workspace whose slug is "app-staging".
const WS_A = { id: '11111111-1111-4111-8111-111111111111', tenant_id: 'tenant-a', slug: 'app-staging' };
const WS_B = { id: '22222222-2222-4222-8222-222222222222', tenant_id: 'tenant-b', slug: 'app-staging' };

test('bbx-fn-ns-01: same slug+action, different workspaces → distinct ksvc names', () => {
  const a = ksvcNameForWorkspace(WS_A, 'x');
  const b = ksvcNameForWorkspace(WS_B, 'x');
  assert.notEqual(a, b, `cross-workspace collision: both resolved to ${a}`);
});

test('bbx-fn-ns-02: same workspace-id + slug, different tenants → distinct names', () => {
  const a = ksvcNameForWorkspace({ id: WS_A.id, tenant_id: 'tenant-a', slug: 'app-staging' }, 'process');
  const b = ksvcNameForWorkspace({ id: WS_A.id, tenant_id: 'tenant-b', slug: 'app-staging' }, 'process');
  assert.notEqual(a, b, `cross-tenant collision: ${a}`);
});

test('bbx-fn-ns-03: stable for the same workspace+action', () => {
  assert.equal(ksvcNameForWorkspace(WS_A, 'x'), ksvcNameForWorkspace(WS_A, 'x'),
    'ksvc name must be deterministic so invoke resolves the caller-scoped ksvc');
});

test('bbx-fn-ns-04: DNS-1035 valid and within 63 chars', () => {
  for (const ws of [WS_A, WS_B]) {
    const longAction = 'a-really-long-action-name-that-pushes-against-the-limit-aaaaaaaaaaaaaa';
    const name = ksvcNameForWorkspace(ws, longAction);
    assert.ok(name.length <= 63, `too long (${name.length}): ${name}`);
    assert.ok(DNS1035.test(name), `not DNS-1035 valid: ${name}`);
  }
});

test('bbx-fn-ns-05: distinct even when the workspace slug is absent', () => {
  const a = ksvcNameForWorkspace({ id: WS_A.id, tenant_id: 'tenant-a' }, 'x');
  const b = ksvcNameForWorkspace({ id: WS_B.id, tenant_id: 'tenant-b' }, 'x');
  assert.notEqual(a, b, `id-only collision: ${a}`);
  assert.ok(DNS1035.test(a) && DNS1035.test(b), `invalid: ${a} / ${b}`);
});
