import test from 'node:test';
import assert from 'node:assert/strict';
import { sagaDefinitions } from '../../apps/control-plane/src/saga/saga-definitions.mjs';

const nonProvisional = ['WF-CON-001', 'WF-CON-002', 'WF-CON-003', 'WF-CON-004', 'WF-CON-006'];

test('definitions completeness and shape', async () => {
  for (const workflowId of nonProvisional) {
    const definition = sagaDefinitions.get(workflowId);
    assert.ok(definition.steps.length >= 1);
    assert.deepEqual(definition.steps.map((step) => step.ordinal), Array.from({ length: definition.steps.length }, (_, index) => index + 1));
    for (const step of definition.steps) {
      assert.equal(typeof step.forward, 'function');
      assert.equal(typeof step.compensate, 'function');
      const snapshot = await step.forward({ tenantId: 't1', workspaceId: 'w1' }, { tenantId: 't1', workspaceId: 'w1' }).catch((error) => ({ error }));
      if (workflowId !== 'WF-CON-006') {
        assert.equal(snapshot.tenantId, 't1');
      }
    }
  }

  const provisional = sagaDefinitions.get('WF-CON-005');
  assert.equal(provisional.provisional, true);
  assert.equal(provisional.steps.length, 0);
  assert.equal(sagaDefinitions.get('WF-CON-002').steps.length, 4);
});
