import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../actions/function-privilege-denial-recorder.mjs';

test('event consumed inserts row', async () => {
  const inserted = [];
  const result = await main({ messages: [{ value: JSON.stringify({ tenantId: 't-1', workspaceId: 'w-1', actorId: 'svc-1', actorType: 'service_account', attemptedOperation: 'function_invoke', requiredSubdomain: 'function_invocation', presentedSubdomains: ['function_deployment'], requestPath: '/v1/functions/actions/fn-1/invocations', httpMethod: 'POST', correlationId: 'corr-1' }) }] }, {
    db: {},
    recordDenial: async (_db, record) => { inserted.push(record); return { id: 'd-1', ...record }; }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.inserted, 1);
  assert.equal(inserted[0].requiredSubdomain, 'function_invocation');
});

test('duplicate idempotency is skipped', async () => {
  const result = await main({ messages: [{ value: JSON.stringify({ tenantId: 't-1', actorId: 'svc-1', attemptedOperation: 'function_invoke', requiredSubdomain: 'function_invocation', requestPath: '/v1/functions/actions/fn-1/invocations', httpMethod: 'POST', correlationId: 'corr-1' }) }] }, {
    db: {},
    recordDenial: async () => null
  });
  assert.equal(result.body.inserted, 0);
  assert.equal(result.body.skipped, 1);
});

test('unknown actor type handled gracefully', async () => {
  const warnings = [];
  const result = await main({ messages: [{ value: JSON.stringify({ tenantId: 't-1', actorId: 'svc-1', actorType: 'robot', attemptedOperation: 'function_invoke', requiredSubdomain: 'function_invocation', requestPath: '/v1/functions/actions/fn-1/invocations', httpMethod: 'POST', correlationId: 'corr-1' }) }] }, {
    db: {},
    recordDenial: async () => { throw new Error('bad actor'); },
    log: { warn: (payload) => warnings.push(payload) }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.skipped, 1);
  assert.equal(warnings.length, 1);
});
