import test from 'node:test';
import assert from 'node:assert/strict';

import SwaggerParser from '@apidevtools/swagger-parser';
import { OPENAPI_PATH, collectContractViolations } from '../../scripts/lib/quality-gates.mjs';

test('control-plane OpenAPI document remains structurally valid', async () => {
  const document = await SwaggerParser.validate(OPENAPI_PATH);

  assert.equal(document.openapi, '3.1.0');
  assert.ok(document.paths['/health']);
  assert.ok(document.paths['/v1/platform-users/{userId}']);
  assert.ok(document.paths['/v1/tenants/{tenantId}']);
  assert.ok(document.paths['/v1/tenants/{tenantId}/workspaces/{workspaceId}']);
  assert.ok(document.paths['/v1/workspaces/{workspaceId}/external-applications/{applicationId}']);
  assert.ok(document.paths['/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}']);
  assert.ok(document.paths['/v1/workspaces/{workspaceId}/managed-resources/{resourceId}']);
  assert.ok(document.paths['/v1/tenants/{tenantId}/workspaces/{workspaceId}/access-checks']);
  assert.ok(document.paths['/v1/tenants/{tenantId}/memberships/{tenantMembershipId}']);
  assert.ok(document.paths['/v1/tenants/{tenantId}/invitations/{invitationId}']);
  assert.ok(document.paths['/v1/plans/{planId}']);
  assert.ok(document.paths['/v1/plans/{planId}/quota-policies/{quotaPolicyId}']);
  assert.ok(document.paths['/v1/deployment-profiles/{deploymentProfileId}']);
  assert.ok(document.paths['/v1/provider-capabilities/{providerCapabilityId}']);
  assert.ok(document.paths['/v1/tenants/{tenantId}/effective-capabilities']);
  assert.ok(document.paths['/v1/tenants/{tenantId}/workspaces/{workspaceId}/effective-capabilities']);
  assert.ok(document.components.securitySchemes.bearerAuth);
});

test('control-plane contract enforces versioning, authorization, and error-contract expectations', async () => {
  const document = await SwaggerParser.validate(OPENAPI_PATH);
  const accessCheck = document.paths['/v1/tenants/{tenantId}/workspaces/{workspaceId}/access-checks'].post;
  const createManagedResource = document.paths['/v1/workspaces/{workspaceId}/managed-resources'].post;
  const getWorkspaceCapabilities = document.paths['/v1/tenants/{tenantId}/workspaces/{workspaceId}/effective-capabilities'].get;
  const createInvitation = document.paths['/v1/tenants/{tenantId}/invitations'].post;

  assert.deepEqual(collectContractViolations(document), []);
  assert.equal(accessCheck.security?.[0]?.bearerAuth?.length ?? 0, 0);
  assert.equal(accessCheck.parameters.some((parameter) => parameter.name === 'X-Correlation-Id'), true);
  assert.ok(accessCheck.responses['403']);
  assert.ok(accessCheck.responses['200']);

  assert.equal(createManagedResource.parameters.some((parameter) => parameter.name === 'X-API-Version'), true);
  assert.equal(createManagedResource.parameters.some((parameter) => parameter.name === 'X-Correlation-Id'), true);
  assert.ok(createManagedResource.responses['202']);
  assert.ok(createManagedResource.responses['403']);

  assert.equal(getWorkspaceCapabilities.parameters.some((parameter) => parameter.name === 'tenantId'), true);
  assert.equal(getWorkspaceCapabilities.parameters.some((parameter) => parameter.name === 'workspaceId'), true);
  assert.ok(getWorkspaceCapabilities.responses['200']);
  assert.ok(document.components.schemas.EffectiveCapabilityResolution);

  assert.equal(createInvitation.parameters.some((parameter) => parameter.name === 'X-API-Version'), true);
  assert.equal(createInvitation.parameters.some((parameter) => parameter.name === 'X-Correlation-Id'), true);
  assert.ok(document.components.schemas.Invitation);
  assert.ok(document.components.schemas.CommercialPlan);
  assert.ok(document.components.schemas.ProviderCapabilityRecord);
});
