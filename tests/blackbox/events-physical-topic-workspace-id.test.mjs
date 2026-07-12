/**
 * Black-box tests for fix-events-physical-topic-workspace-id (P1 ISO-EVENTS,
 * residual events isolation defect from the live 2-tenant E2E re-run 2026-06-18).
 *
 * Defect: the control-plane events path named the physical Kafka topic
 * `ws.${ws.slug}.${topic}`. Slugs are NOT globally unique, so two tenants' same-slug
 * workspaces + same topic name resolved to ONE physical topic AND one
 * `workspace_topics` row. `insertTopic` keyed its `ON CONFLICT` on
 * `physical_topic_name` and returned the FIRST tenant's row (identical resourceId
 * `res_topic_80c2db4e`), then the second tenant 404'd on its own topic.
 *
 * Fix: derive the physical name from the GLOBALLY-UNIQUE workspace id
 * (`evt.<workspaceId>.<topic>`, matching events-executor.mjs), and key
 * `workspace_topics` idempotency on `(workspace_id, topic_name)` so a conflict can
 * never cross tenants.
 *
 * Drives the public exports only (no internal knowledge):
 *   physicalTopicName (kafka-handlers.mjs), insertTopic (tenant-store.mjs).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { physicalTopicName } from '../../apps/control-plane/kafka-handlers.mjs';
import { insertTopic } from '../../apps/control-plane/tenant-store.mjs';

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
// Two DIFFERENT workspaces (distinct ids) that share the SAME slug `app-staging`
// across two tenants — the exact collision the campaign reproduced.
const WS_A = 'ws-aaaa-1111-2222-3333-444444444444';
const WS_B = 'ws-bbbb-1111-2222-3333-444444444444';
const TOPIC = 'collide-events';

// ---------------------------------------------------------------------------
// bbx-events-phys-01: physical name embeds the unique workspace id (executor format)
// ---------------------------------------------------------------------------
test('bbx-events-phys-01: physicalTopicName uses evt.<workspaceId>.<topic> (executor-aligned)', () => {
  assert.equal(physicalTopicName(WS_A, TOPIC), `evt.${WS_A}.${TOPIC}`);
});

// ---------------------------------------------------------------------------
// bbx-events-phys-02: same-slug workspaces across tenants get DISTINCT physical topics
// ---------------------------------------------------------------------------
test('bbx-events-phys-02: same slug + same topic, different workspace → distinct physical topics', () => {
  const a = physicalTopicName(WS_A, TOPIC);
  const b = physicalTopicName(WS_B, TOPIC);
  assert.notEqual(a, b, 'two tenants must not share one physical topic');
  // And NOT slug-derived (the old `ws.<slug>.<topic>` collided on app-staging).
  assert.ok(!a.includes('app-staging'), 'physical name must not derive from the non-unique slug');
});

// ---------------------------------------------------------------------------
// In-memory pg pool that faithfully simulates INSERT ... ON CONFLICT
// (workspace_id, topic_name) over workspace_topics.
// ---------------------------------------------------------------------------
function makeTopicPool() {
  const rows = new Map(); // key: `${workspace_id}|${topic_name}`
  return {
    async query(sql, params) {
      const s = sql.replace(/\s+/g, ' ').toLowerCase();
      assert.ok(s.includes('insert into workspace_topics'), `unexpected sql: ${s}`);
      // Guard the FIX: must key on (workspace_id, topic_name) and never reassign tenant_id.
      assert.ok(s.includes('on conflict (workspace_id, topic_name)'),
        `insertTopic must key ON CONFLICT on (workspace_id, topic_name); got: ${s}`);
      assert.ok(!s.includes('on conflict (physical_topic_name)'),
        'must not key the conflict on physical_topic_name (cross-tenant hijack)');
      assert.ok(!s.replace(/\s+/g, '').includes('tenant_id=excluded'), 'ON CONFLICT must never reassign tenant_id');
      const [id, workspaceId, tenantId, topicName, physical, partitions] = params;
      const key = `${workspaceId}|${topicName}`;
      if (rows.has(key)) {
        const existing = rows.get(key); // DO UPDATE ... RETURNING → existing row, original id
        existing.partitions = partitions;
        return { rows: [existing] };
      }
      const row = { id, workspace_id: workspaceId, tenant_id: tenantId, topic_name: topicName, physical_topic_name: physical, partitions, created_at: new Date().toISOString() };
      rows.set(key, row);
      return { rows: [row] };
    },
  };
}

// ---------------------------------------------------------------------------
// bbx-events-phys-03: two tenants provisioning the same topic get DISTINCT rows
// (no resourceId/tenant hijack)
// ---------------------------------------------------------------------------
test('bbx-events-phys-03: insertTopic for two same-slug workspaces → distinct, un-hijacked rows', async () => {
  const pool = makeTopicPool();
  const a = await insertTopic(pool, { id: 'res_topic_aaaa', workspaceId: WS_A, tenantId: TENANT_A, topicName: TOPIC, physicalTopicName: physicalTopicName(WS_A, TOPIC), partitions: 1 });
  const b = await insertTopic(pool, { id: 'res_topic_bbbb', workspaceId: WS_B, tenantId: TENANT_B, topicName: TOPIC, physicalTopicName: physicalTopicName(WS_B, TOPIC), partitions: 1 });
  assert.notEqual(a.id, b.id, 'distinct resourceIds (no res_topic collision)');
  assert.equal(a.tenant_id, TENANT_A, "tenant A's row keeps tenant A");
  assert.equal(b.tenant_id, TENANT_B, "tenant B's row is NOT hijacked to tenant A");
  assert.notEqual(a.physical_topic_name, b.physical_topic_name, 'distinct physical topics');
});

// ---------------------------------------------------------------------------
// bbx-events-phys-04: re-provisioning the same topic in the SAME workspace is idempotent
// ---------------------------------------------------------------------------
test('bbx-events-phys-04: same workspace + same topic re-provision → same resourceId (idempotent)', async () => {
  const pool = makeTopicPool();
  const first = await insertTopic(pool, { id: 'res_topic_first', workspaceId: WS_A, tenantId: TENANT_A, topicName: TOPIC, physicalTopicName: physicalTopicName(WS_A, TOPIC), partitions: 1 });
  const again = await insertTopic(pool, { id: 'res_topic_second', workspaceId: WS_A, tenantId: TENANT_A, topicName: TOPIC, physicalTopicName: physicalTopicName(WS_A, TOPIC), partitions: 3 });
  assert.equal(again.id, first.id, 're-provision must return the original resourceId');
});
