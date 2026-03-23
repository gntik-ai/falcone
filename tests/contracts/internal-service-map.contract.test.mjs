import test from 'node:test';
import assert from 'node:assert/strict';

import { controlApiBoundary, controlApiCommandContract } from '../../apps/control-plane/src/internal-service-map.mjs';
import {
  INTERNAL_CONTRACT_VERSION,
  getContract,
  listInteractionFlows
} from '../../services/internal-contracts/src/index.mjs';
import {
  provisioningAdapterPorts,
  provisioningOrchestratorBoundary,
  provisioningRequestContract,
  provisioningResultContract
} from '../../services/provisioning-orchestrator/src/contract-boundary.mjs';
import {
  auditModuleBoundary,
  auditPersistenceAdapters,
  auditRecordContract
} from '../../services/audit/src/contract-boundary.mjs';

test('internal contract baseline preserves versioning and dependency expectations', () => {
  assert.equal(INTERNAL_CONTRACT_VERSION, '2026-03-23');
  assert.ok(controlApiBoundary.service_dependencies.includes('provisioning_orchestrator'));
  assert.ok(controlApiBoundary.service_dependencies.includes('audit_module'));
  assert.ok(provisioningOrchestratorBoundary.service_dependencies.includes('audit_module'));
  assert.deepEqual(auditModuleBoundary.service_dependencies, []);

  assert.ok(controlApiCommandContract.required_fields.includes('idempotency_key'));
  assert.ok(controlApiCommandContract.required_fields.includes('contract_version'));
  assert.ok(provisioningRequestContract.required_fields.includes('requested_resources'));
  assert.ok(provisioningResultContract.error_classes.includes('recovery_required'));
  assert.equal(auditRecordContract.write_mode, 'append_only');
  assert.ok(auditRecordContract.required_fields.includes('evidence_pointer'));
});

test('consumer scaffolding exposes the expected provider and flow slices', () => {
  const provisioningProviderIds = new Set(provisioningAdapterPorts.map((adapter) => adapter.id));
  const auditProviderIds = new Set(auditPersistenceAdapters.map((adapter) => adapter.id));
  const interactionFlowIds = new Set(listInteractionFlows().map((flow) => flow.id));

  for (const providerId of ['keycloak', 'postgresql', 'mongodb', 'kafka', 'openwhisk', 'storage']) {
    assert.ok(provisioningProviderIds.has(providerId), `missing provisioning adapter ${providerId}`);
  }

  assert.deepEqual([...auditProviderIds].sort(), ['postgresql', 'storage']);
  assert.ok(interactionFlowIds.has('tenant_provisioning'));
  assert.ok(interactionFlowIds.has('tenant_suspension'));
  assert.equal(getContract('adapter_call').owner, 'services/adapters');
});
