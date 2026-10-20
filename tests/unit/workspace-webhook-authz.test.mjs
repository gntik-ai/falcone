import test from 'node:test';
import assert from 'node:assert/strict';
import { TEST_WEBHOOK_KEY_CONTEXT } from '../helpers/webhook-key.mjs';

process.env.REPO_ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
const { webhookManage } = await import('../../apps/control-plane/webhook-handlers.mjs');

test('workspace webhook catalogue is hidden from unbound tenant members before the action', async () => {
  let actions = 0;
  const ctx = { identity: { actorType: 'tenant_member', roles: ['tenant_viewer'], tenantId: 'T', workspaceIds: ['ws1'] },
    params: { workspaceId: 'ws2' }, req: { method: 'GET', url: '/v1/workspaces/ws2/webhooks/event-types', headers: { 'x-workspace-id': 'ws2' } },
    body: { workspaceId: 'ws2', roles: ['tenant_owner'] }, pool: {},
    webhookRuntimePool: { query: async () => { throw new Error('webhook query after denial'); } },
    webhookWritePool: { query: async () => { throw new Error('webhook write after denial'); } } };
  const result = await webhookManage(ctx, { keyContext: TEST_WEBHOOK_KEY_CONTEXT,
    getWorkspace: async () => ({ id: 'ws2', tenant_id: 'T' }), buildDb: () => { actions++; return {}; } });
  assert.deepEqual(result, { statusCode: 404, body: { code: 'NOT_FOUND', message: 'workspace not found' } });
  assert.equal(actions, 0);
});
