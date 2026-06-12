// Black-box test suite for change add-flows-triggers (#365) — route-catalog + audit + teardown.
//
// Asserts the webhook trigger ingestion route is registered in the authoritative gateway allow-list,
// that a trigger-initiated start carries triggerType in the flow audit envelope, and that the
// tenant-teardown cascade purges the new trigger-artifact tables.
//
// Tests: bbx-flows-trig-cat-01 .. bbx-flows-trig-cat-05
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { buildFlowAuditEvent, FLOW_AUDIT_EVENT_TYPES } from '../../services/audit/src/flow-lifecycle-events.mjs';
import { teardown as workflowsTeardown } from '../../services/provisioning-orchestrator/src/appliers/workflows-applier.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const catalog = JSON.parse(readFileSync(resolve(REPO, 'services/gateway-config/public-route-catalog.json'), 'utf8'));

const WEBHOOK_ROUTE = '/v1/flows/workspaces/{workspaceId}/triggers/webhooks/{triggerId}';

// bbx-flows-trig-cat-01: the webhook trigger ingestion route is present in the gateway allow-list.
test('bbx-flows-trig-cat-01: webhook trigger route is registered as data_access', () => {
  const e = catalog.find((r) => r.method === 'POST' && r.path === WEBHOOK_ROUTE);
  assert.ok(e, 'POST .../triggers/webhooks/{triggerId} present in the gateway allow-list');
  assert.equal(e.privilege_domain, 'data_access');
});

// bbx-flows-trig-cat-02: the webhook route is NOT mis-domained as structural_admin (drift guard).
test('bbx-flows-trig-cat-02: webhook route is not mis-domained as structural_admin', () => {
  const e = catalog.find((r) => r.method === 'POST' && r.path === WEBHOOK_ROUTE);
  assert.notEqual(e.privilege_domain, 'structural_admin');
});

// bbx-flows-trig-cat-03: a trigger-initiated execution_started audit event carries triggerType.
test('bbx-flows-trig-cat-03: execution_started audit envelope carries triggerType', () => {
  for (const triggerType of ['cron', 'webhook', 'platform_event', 'manual']) {
    const ev = buildFlowAuditEvent({
      eventType: FLOW_AUDIT_EVENT_TYPES.EXECUTION_STARTED,
      tenantId: 'ten_A', workspaceId: 'ws_A', actorId: 'svc', flowId: 'f1', flowVersion: 1,
      executionId: 'ten_A:ws_A:f1:run', triggerType,
    });
    assert.equal(ev.triggerType, triggerType, `triggerType=${triggerType} present on the envelope`);
  }
});

// bbx-flows-trig-cat-04: a non-execution audit event has triggerType null (backward-compatible).
test('bbx-flows-trig-cat-04: non-execution audit events default triggerType to null', () => {
  const ev = buildFlowAuditEvent({
    eventType: FLOW_AUDIT_EVENT_TYPES.DEFINITION_CREATED,
    tenantId: 'ten_A', workspaceId: 'ws_A', actorId: 'svc', flowId: 'f1',
  });
  assert.equal(ev.triggerType, null);
});

// bbx-flows-trig-cat-05: tenant teardown cascade purges the trigger-artifact tables.
test('bbx-flows-trig-cat-05: tenant teardown deletes flow_trigger_secrets + flow_trigger_registrations', async () => {
  const deleted = [];
  const db = {
    async query(sql, params) {
      const m = /DELETE FROM (\w+) WHERE tenant_id = \$1/.exec(sql);
      if (!m) return { rowCount: 0 };
      deleted.push({ table: m[1], tenantId: params[0] });
      return { rowCount: 1 };
    },
  };
  let artifactsRemovedFor = null;
  const result = await workflowsTeardown('tenant_A', {}, {
    credentials: { db, removeTriggerArtifacts: async (tid) => { artifactsRemovedFor = tid; return { removed: 3 }; } },
    log: { error() {} },
  });
  assert.equal(result.counts.errors, 0);
  const tables = deleted.map((d) => d.table);
  assert.ok(tables.includes('flow_trigger_secrets'), 'flow_trigger_secrets purged');
  assert.ok(tables.includes('flow_trigger_registrations'), 'flow_trigger_registrations purged');
  assert.equal(artifactsRemovedFor, 'tenant_A', 'removeTriggerArtifacts seam invoked for the tenant');
  const artifact = result.resource_results.find((r) => r.resource_type === 'flow_trigger_artifacts');
  assert.equal(artifact.action, 'removed');
});
