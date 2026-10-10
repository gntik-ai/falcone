import test from 'node:test';
import assert from 'node:assert/strict';

import SwaggerParser from '@apidevtools/swagger-parser';
import { getContextPropagationTarget, getPublicRoute } from '../../packages/internal-contracts/src/index.mjs';
import { OPENAPI_PATH, readJson } from '../../scripts/lib/quality-gates.mjs';
import { summarizeFunctionsAdminSurface } from '../../apps/control-plane-executor/src/functions-admin.mjs';
import { readDomainModel } from '../../scripts/lib/domain-model.mjs';
import { queryAuditRecords } from '../../apps/control-plane-executor/src/functions-audit.mjs';

test('functions audit OpenAPI withdraws unserved audit query surfaces and exclusive schemas', async () => {
  const document = await SwaggerParser.validate(OPENAPI_PATH);
  for (const path of [
    '/v1/functions/workspaces/{workspaceId}/audit',
    '/v1/functions/workspaces/{workspaceId}/audit/rollback-evidence',
    '/v1/functions/workspaces/{workspaceId}/audit/quota-enforcement',
    '/v1/admin/functions/audit/coverage',
  ]) assert.equal(document.paths[path], undefined);
  const family = readJson('apps/control-plane-executor/openapi/families/functions.openapi.json');
  for (const name of ['DeploymentAuditEntry', 'RollbackEvidenceRecord', 'QuotaEnforcementRecord', 'AuditCoverageReport']) {
    assert.equal(family.components.schemas[name], undefined);
  }
  // Storage audit still uses these shared schemas in the unified contract.
  assert.ok(document.components.schemas.DeploymentAuditEntry);
  assert.ok(document.components.schemas.RollbackEvidenceRecord);
  assert.equal(document.components.schemas.QuotaEnforcementRecord.allOf[1].properties.decision.enum.includes('denied'), true);
});

test('functions audit contracts withdraw public routes while retaining internal authorization, domain entities, and library metadata', () => {
  for (const operationId of ['listFunctionDeploymentAudit', 'listFunctionRollbackEvidence', 'listFunctionQuotaEnforcement', 'getFunctionAuditCoverage']) {
    assert.equal(getPublicRoute(operationId), undefined);
  }
  const auditProjection = getContextPropagationTarget('audit_query_context');
  const surface = summarizeFunctionsAdminSurface();
  const domain = readDomainModel();
  const entityIds = new Set(domain.entities.map((entity) => entity.id));
  const invariantIds = new Set((domain.business_invariants ?? []).map((entry) => entry.id));

  assert.equal(auditProjection.required_fields.includes('query_scope'), true);
  assert.equal(surface.some((entry) => entry.resourceKind === 'function_deployment_audit'), true);
  assert.equal(surface.some((entry) => entry.resourceKind === 'function_rollback_evidence'), true);
  assert.equal(surface.some((entry) => entry.resourceKind === 'function_quota_enforcement_audit'), true);
  for (const entityId of ['function_audit_record', 'function_deployment_audit_entry', 'function_admin_action_audit_entry', 'function_rollback_evidence_record', 'function_quota_enforcement_record']) {
    assert.equal(entityIds.has(entityId), true);
  }
  for (const invariantId of ['BI-FN-AUD-001', 'BI-FN-AUD-002', 'BI-FN-AUD-003']) {
    assert.equal(invariantIds.has(invariantId), true);
  }
});

test('functions audit scope violations return a gateway-compatible coded error', () => {
  try {
    queryAuditRecords({ tenantId: 'ten_01a', workspaceId: 'wrk_01a' }, { tenantId: 'ten_01b' });
    assert.fail('expected scope violation');
  } catch (error) {
    const response = {
      code: `GW_${error.code}`,
      message: error.message
    };
    assert.match(response.code, /^GW_/);
    assert.equal(response.code, 'GW_AUDIT_SCOPE_VIOLATION');
  }
});
