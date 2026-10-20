import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { routes } from '../../apps/control-plane/routes.mjs';
import { FN_HANDLERS } from '../../apps/control-plane/fn-handlers.mjs';
import { KAFKA_HANDLERS } from '../../apps/control-plane/kafka-handlers.mjs';
import { PG_HANDLERS } from '../../apps/control-plane/pg-handlers.mjs';
import { MONGO_HANDLERS } from '../../apps/control-plane/mongo-handlers.mjs';
import { STORAGE_HANDLERS } from '../../apps/control-plane/storage-handlers.mjs';
import { REALTIME_HANDLERS } from '../../apps/control-plane/realtime-handlers.mjs';
import exclusions from '../fixtures/workspace-authz-out-of-scope.json' with { type: 'json' };

process.env.REPO_ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
const { WEBHOOK_HANDLERS } = await import('../../apps/control-plane/webhook-handlers.mjs');
const handlers = { ...FN_HANDLERS, ...KAFKA_HANDLERS, ...PG_HANDLERS, ...MONGO_HANDLERS,
  ...STORAGE_HANDLERS, ...REALTIME_HANDLERS, ...WEBHOOK_HANDLERS };
// Frozen exclusions cover existing IAM, lifecycle, registry and metrics APIs
// and tenant-addressed webhooks outside #1141. A new workspace/resource route must be exercised here or have
// its scope explicitly reviewed; matching a path prefix alone never exempts it.
const excluded = new Set(exclusions);
const addressed = routes.filter(r => r.auth === 'authenticated'
  && (/\{(?:workspaceId|actionId|functionId|resourceId|activationId|topicId|bucketId|databaseId|collectionId|channelId|webhookId|db|col|subscriptionId|deliveryId)\}/.test(r.path)
    || (/^\/v1\/(functions|events|postgres|mongo|storage)\//.test(r.path) && r.path.includes('{')))
  && !excluded.has(`${r.method} ${r.path}`));

function context(route, identity) {
  const ws = { id: 'ws2', tenant_id: 'T' };
  const record = { resource_id: 'fn_prod', id: 'topic_prod', tenant_id: 'T', workspace_id: 'ws2',
    database_name: 'production', bucket_name: 'bucket-prod' };
  const activation = { resource_id: 'fn_prod', activation_id: 'act_prod' };
  const values = { workspaceId: 'ws2', actionId: 'fn_prod', resourceId: 'fn_prod', activationId: 'act_prod',
    topicId: 'topic_prod', bucketId: 'bucket-prod', db: 'production', databaseName: 'production',
    col: 'orders', collectionName: 'orders', objectKey: 'orders.json', manifestId: 'smf_0123456789abcdef01' };
  const params = Object.fromEntries([...route.path.matchAll(/\{(\w+)\}/g)].map(([, k]) => [k, values[k] ?? 'valid']));
  const forbidden = () => { throw new Error('downstream operation before workspace authorization'); };
  const st = new Proxy({ getWorkspace: async () => ws, getFnAction: async () => record,
    getFnActivation: async () => activation, getTopicByResourceId: async () => record,
    getBucketRecord: async () => record, databaseWorkspaceMap: async () => ({ production: record }),
    mongoDatabaseWorkspaceMappings: async () => [record] }, { get: (target, name) => target[name] ?? forbidden });
  return { identity, params, query: { workspaceId: 'ws2', tenantId: 'T' }, body: { workspaceId: 'ws2', actionName: 'orders', payload: 'valid' },
    req: { method: route.method, url: route.path.replace(/\{(\w+)\}/g, (_, k) => params[k]), headers: { 'x-workspace-id': 'ws2' } },
    store: st, vaultStore: {},
    pool: { query: async sql => {
      if (sql.includes('FROM workspaces')) return { rows: [ws] };
      if (sql.includes('FROM fn_actions') || sql.includes('FROM workspace_buckets')) return { rows: [record] };
      if (sql.includes('FROM fn_activations')) return { rows: [activation] };
      return forbidden();
    } },
    knativeRuntime: { status: forbidden }, pgClient: { query: forbidden }, mongoClient: { db: forbidden },
  };
}

for (const route of addressed) {
  test(`${route.method} ${route.path} denies without production workspace authority`, async t => {
    let connections = 0, requests = 0;
    t.mock.method(pg.Client.prototype, 'connect', async () => { connections++; throw new Error('PostgreSQL connection after denial'); });
    t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('downstream fetch after denial'); });
    const handler = handlers[route.localHandler];
    assert.equal(typeof handler, 'function', 'new workspace route must be covered at its exported handler');
    for (const [role, bindings] of [['tenant_viewer', []], ['tenant_developer', []], ['workspace_viewer', ['ws1']], ['tenant_developer', ['ws1']]]) {
      // actorType alone must not bypass the verified role/binding gate.
      const ctx = context(route, { actorType: 'tenant_owner', tenantId: 'T', roles: [role], workspaceIds: bindings });
      let result;
      if (route.stream) {
        result = {};
        await handler(ctx, { writeHead: status => { result.statusCode = status; }, end: body => { result.body = JSON.parse(body); } });
      } else result = await handler(ctx);
      // Existing workspace bucket and Function workspace APIs retain their uniform 403 shape.
      const legacy = ['storageListWorkspaceBuckets', 'storageProvisionBucket', 'fnInventory', 'fnListActions', 'fnDeploy'].includes(route.localHandler);
      assert.equal(result.statusCode, legacy ? 403 : 404, `${role}: ${JSON.stringify(result.body)}`);
      assert.ok(legacy ? result.body.code === 'FORBIDDEN' : /NOT_FOUND$/.test(result.body.code));
      assert.equal(connections, 0);
      assert.equal(requests, 0);
    }
  });
}
