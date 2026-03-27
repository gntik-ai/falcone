import test from 'node:test';
import assert from 'node:assert/strict';

import SwaggerParser from '@apidevtools/swagger-parser';
import { OPENAPI_PATH } from '../../scripts/lib/quality-gates.mjs';
import { getPublicRoute } from '../../services/internal-contracts/src/index.mjs';

test('functions quota contract exposes tenant and workspace quota routes and expanded scope-aware schemas', async () => {
  const document = await SwaggerParser.validate(OPENAPI_PATH);
  const tenantQuota = document.paths['/v1/functions/tenants/{tenantId}/quota']?.get;
  const workspaceQuota = document.paths['/v1/functions/workspaces/{workspaceId}/quota']?.get;
  const quotaSchema = document.components.schemas.FunctionQuotaStatus;

  assert.ok(tenantQuota);
  assert.ok(workspaceQuota);
  assert.equal(tenantQuota.operationId, 'getFunctionTenantQuota');
  assert.equal(workspaceQuota.operationId, 'getFunctionWorkspaceQuota');
  assert.equal(tenantQuota['x-resource-type'], 'function_quota');
  assert.equal(workspaceQuota['x-resource-type'], 'function_quota');

  assert.ok(document.components.schemas.FunctionQuotaScopeStatus);
  assert.ok(document.components.schemas.FunctionQuotaDimensionStatus);
  assert.ok(document.components.schemas.FunctionQuotaViolation);
  assert.ok(document.components.schemas.FunctionQuotaEvaluation);
  assert.equal(quotaSchema.required.includes('tenantScope'), true);
  assert.equal(quotaSchema.required.includes('workspaceScope'), true);
  assert.equal(quotaSchema.required.includes('scopes'), true);
  assert.equal(document.components.schemas.FunctionQuotaScopeStatus.required.includes('functionCount'), true);
  assert.equal(document.components.schemas.FunctionQuotaScopeStatus.required.includes('invocationCount'), true);
  assert.equal(document.components.schemas.FunctionQuotaScopeStatus.required.includes('computeTimeMs'), true);
  assert.equal(document.components.schemas.FunctionQuotaScopeStatus.required.includes('memoryMb'), true);
  assert.ok(document.components.schemas.FunctionInventory.properties.quotaStatus);

  assert.equal(getPublicRoute('getFunctionTenantQuota')?.resourceType, 'function_quota');
  assert.equal(getPublicRoute('getFunctionWorkspaceQuota')?.path, '/v1/functions/workspaces/{workspaceId}/quota');
});
