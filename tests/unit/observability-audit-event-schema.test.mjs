import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectAuditEventSchemaViolations,
  readAuthorizationModel,
  readObservabilityAuditEventSchema,
  readObservabilityAuditPipeline
} from '../../scripts/lib/observability-audit-event-schema.mjs';

test('observability audit event schema contract remains internally consistent', () => {
  const violations = collectAuditEventSchemaViolations();
  assert.deepEqual(violations, []);
});

test('collectAuditEventSchemaViolations reports a missing required top-level field by name', () => {
  const contract = structuredClone(readObservabilityAuditEventSchema());
  contract.required_top_level_fields = contract.required_top_level_fields.filter((field) => field !== 'origin');

  const violations = collectAuditEventSchemaViolations(
    contract,
    readObservabilityAuditPipeline(),
    readAuthorizationModel()
  );

  assert.equal(
    violations.includes('Observability audit event schema must require top-level field origin.'),
    true
  );
});

test('collectAuditEventSchemaViolations reports a missing actor_id requirement', () => {
  const contract = structuredClone(readObservabilityAuditEventSchema());
  contract.actor.required_fields = contract.actor.required_fields.filter((field) => field !== 'actor_id');

  const violations = collectAuditEventSchemaViolations(
    contract,
    readObservabilityAuditPipeline(),
    readAuthorizationModel()
  );

  assert.equal(
    violations.includes('Observability audit event schema actor section must require field actor_id.'),
    true
  );
});

test('collectAuditEventSchemaViolations reports a missing correlation_id requirement', () => {
  const contract = structuredClone(readObservabilityAuditEventSchema());
  contract.required_top_level_fields = contract.required_top_level_fields.filter((field) => field !== 'correlation_id');

  const violations = collectAuditEventSchemaViolations(
    contract,
    readObservabilityAuditPipeline(),
    readAuthorizationModel()
  );

  assert.equal(
    violations.includes('Observability audit event schema must require top-level field correlation_id.'),
    true
  );
});

test('collectAuditEventSchemaViolations reports source_audit_pipeline_contract mismatches', () => {
  const contract = structuredClone(readObservabilityAuditEventSchema());
  contract.source_audit_pipeline_contract = '1900-01-01';

  const violations = collectAuditEventSchemaViolations(
    contract,
    readObservabilityAuditPipeline(),
    readAuthorizationModel()
  );

  assert.equal(
    violations.includes(
      'Observability audit event schema source_audit_pipeline_contract must align with observability-audit-pipeline.json version.'
    ),
    true
  );
});

test('collectAuditEventSchemaViolations reports missing categories required by the audit pipeline baseline', () => {
  const contract = structuredClone(readObservabilityAuditEventSchema());
  contract.action.categories = contract.action.categories.filter((category) => category !== 'privilege_escalation');

  const violations = collectAuditEventSchemaViolations(
    contract,
    readObservabilityAuditPipeline(),
    readAuthorizationModel()
  );

  assert.equal(
    violations.includes(
      'Observability audit event schema action.categories must include pipeline category privilege_escalation.'
    ),
    true
  );
});
