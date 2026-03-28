import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  OBSERVABILITY_AUDIT_EVENT_SCHEMA_VERSION,
  getAuditActionSchema,
  getAuditActorSchema,
  getAuditEventRequiredFields,
  getAuditOriginSchema,
  getAuditResourceSchema,
  getAuditResultSchema,
  getAuditScopeEnvelope,
  readObservabilityAuditEventSchema,
  readObservabilityAuditPipeline
} from '../../services/internal-contracts/src/index.mjs';
import { collectAuditEventSchemaViolations } from '../../scripts/lib/observability-audit-event-schema.mjs';

test('observability audit event schema contract is exposed through shared readers', () => {
  const contract = readObservabilityAuditEventSchema();

  assert.equal(contract.version, '2026-03-28');
  assert.equal(OBSERVABILITY_AUDIT_EVENT_SCHEMA_VERSION, '2026-03-28');
});

test('observability audit event schema contract passes deterministic validation', () => {
  const violations = collectAuditEventSchemaViolations();
  assert.deepEqual(violations, []);
});

test('shared readers return the expected required field, actor, scope, resource, action, result, and origin sections', () => {
  const requiredFields = getAuditEventRequiredFields();
  const actor = getAuditActorSchema();
  const scope = getAuditScopeEnvelope();
  const resource = getAuditResourceSchema();
  const action = getAuditActionSchema();
  const result = getAuditResultSchema();
  const origin = getAuditOriginSchema();

  assert.deepEqual(requiredFields, [
    'event_id',
    'event_timestamp',
    'actor',
    'scope',
    'resource',
    'action',
    'result',
    'correlation_id',
    'origin',
    'detail'
  ]);
  assert.deepEqual(actor.required_fields, ['actor_id', 'actor_type']);
  assert.deepEqual(scope.scope_modes, ['tenant', 'tenant_workspace', 'platform']);
  assert.equal(resource.supported_subsystem_ids.length, 8);
  assert.equal(action.categories.includes('privilege_escalation'), true);
  assert.equal(result.outcomes.includes('partial'), true);
  assert.equal(origin.origin_surfaces.includes('console_backend'), true);
});

test('audit event schema action categories cover every category required by the audit pipeline contract', () => {
  const pipelineCategories = new Set(
    readObservabilityAuditPipeline().subsystem_roster.flatMap((subsystem) => subsystem.required_event_categories ?? [])
  );
  const schemaCategories = new Set(getAuditActionSchema().categories ?? []);

  for (const category of pipelineCategories) {
    assert.equal(schemaCategories.has(category), true, `schema must include pipeline category ${category}`);
  }
});

test('architecture README and task summary document the observability audit event schema baseline', () => {
  const architectureIndex = readFileSync('docs/reference/architecture/README.md', 'utf8');
  const taskSummary = readFileSync('docs/tasks/us-obs-02.md', 'utf8');

  assert.equal(architectureIndex.includes('observability-audit-event-schema.md'), true);
  assert.equal(architectureIndex.includes('US-OBS-02-T02'), true);
  assert.equal(taskSummary.includes('US-OBS-02-T02'), true);
  assert.equal(taskSummary.includes('validate:observability-audit-event-schema'), true);
});

test('package.json wires validate:observability-audit-event-schema into validate:repo', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

  assert.equal(typeof packageJson.scripts['validate:observability-audit-event-schema'], 'string');
  assert.equal(packageJson.scripts['validate:repo'].includes('validate:observability-audit-event-schema'), true);
});
