import test from 'node:test';
import assert from 'node:assert/strict';

import { collectServiceMapViolations, readServiceMap } from '../../scripts/lib/service-map.mjs';

test('internal service map remains internally consistent', () => {
  const violations = collectServiceMapViolations(readServiceMap());

  assert.deepEqual(violations, []);
});

test('collectServiceMapViolations flags missing services and broken audit semantics', () => {
  const brokenMap = {
    version: '2026-03-23',
    principles: ['keep boundaries explicit'],
    services: [
      {
        id: 'control_api',
        package: 'apps/control-plane',
        responsibilities: ['public API'],
        owned_resources: ['routes'],
        service_dependencies: [],
        adapter_dependencies: ['keycloak'],
        inbound_contracts: ['control_api_command'],
        outbound_contracts: []
      },
      {
        id: 'audit_module',
        package: 'services/audit',
        responsibilities: ['audit'],
        owned_resources: ['audit log'],
        service_dependencies: ['control_api'],
        adapter_dependencies: [],
        inbound_contracts: ['audit_record'],
        outbound_contracts: []
      }
    ],
    adapter_ports: [
      {
        id: 'keycloak',
        package: 'services/adapters',
        consumers: ['control_api'],
        capabilities: ['ensure_realm'],
        request_contract: 'adapter_call',
        result_contract: 'adapter_result',
        idempotency_key: 'tenant_id',
        error_classes: ['retryable_dependency_failure']
      }
    ],
    contracts: {
      control_api_command: {
        owner: 'control_api',
        version: '2026-03-23',
        required_fields: ['command_id'],
        idempotency: 'required',
        versioning: 'pinned',
        error_classes: ['validation_error']
      },
      audit_record: {
        owner: 'audit_module',
        version: '2026-03-23',
        required_fields: ['record_id'],
        idempotency: 'required',
        versioning: 'pinned',
        error_classes: ['storage_unavailable'],
        write_mode: 'mutable'
      }
    },
    interaction_flows: []
  };

  const violations = collectServiceMapViolations(brokenMap);

  assert.ok(violations.some((violation) => violation.includes('must include provisioning_orchestrator')));
  assert.ok(violations.some((violation) => violation.includes('control_api must not depend on provider adapters directly')));
  assert.ok(violations.some((violation) => violation.includes('audit_record must declare write_mode append_only')));
  assert.ok(violations.some((violation) => violation.includes('interaction_flows must be a non-empty array')));
});
