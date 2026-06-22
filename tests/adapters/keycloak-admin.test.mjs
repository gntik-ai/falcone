import test from 'node:test';
import assert from 'node:assert/strict';

import {
  IAM_ADMIN_CAPABILITY_MATRIX,
  RESERVED_REALM_IDS,
  SUPPORTED_CLIENT_PROTOCOLS,
  SUPPORTED_KEYCLOAK_VERSION_RANGES,
  buildIamAdminAdapterCall,
  deleteServiceAccount,
  isKeycloakVersionSupported,
  normalizeKeycloakAdminError,
  normalizeKeycloakAdminResource,
  validateIamAdminRequest
} from '../../services/adapters/src/keycloak-admin.mjs';

test('keycloak admin adapter exports the supported compatibility matrix and resource coverage', () => {
  assert.deepEqual(Object.keys(IAM_ADMIN_CAPABILITY_MATRIX), ['realm', 'client', 'role', 'scope', 'user']);
  assert.equal(SUPPORTED_KEYCLOAK_VERSION_RANGES.length, 3);
  assert.deepEqual(SUPPORTED_CLIENT_PROTOCOLS, ['openid-connect', 'saml']);
  assert.equal(SUPPORTED_KEYCLOAK_VERSION_RANGES.every((entry) => entry.supportedResources.includes('user')), true);
  assert.equal(isKeycloakVersionSupported('24.0.6'), true);
  assert.equal(isKeycloakVersionSupported('25.3.1'), true);
  assert.equal(isKeycloakVersionSupported('26.0.0'), true);
  assert.equal(isKeycloakVersionSupported('23.0.7'), false);
  assert.equal(RESERVED_REALM_IDS.includes('in-falcone-platform'), true);
});

test('keycloak admin adapter normalizes provider payloads into the BaaS-native IAM shapes', () => {
  const client = normalizeKeycloakAdminResource(
    'client',
    {
      clientId: 'starter-dev-web',
      protocol: 'openid-connect',
      publicClient: false,
      serviceAccountsEnabled: true,
      redirectUris: ['https://starter.example.dev/callback'],
      defaultClientScopes: ['openid', 'profile'],
      optionalClientScopes: ['offline_access'],
      attributes: { owner: 'workspace-admin' }
    },
    { realmId: 'tenant-starter-alpha' }
  );
  const user = normalizeKeycloakAdminResource(
    'user',
    {
      id: '5d32c016-8e33-4725-9d11-d0cf5b534f16',
      username: 'nora-alpha',
      email: 'nora@example.com',
      enabled: true,
      groups: ['developers', '/operators'],
      realmRoles: ['tenant_admin'],
      requiredActions: ['VERIFY_EMAIL'],
      attributes: { locale: ['es-ES'] }
    },
    { realmId: 'tenant-starter-alpha' }
  );

  assert.equal(client.resourceType, 'iam_client');
  assert.equal(client.accessType, 'confidential');
  assert.deepEqual(client.defaultScopes, ['openid', 'profile']);
  assert.deepEqual(client.optionalScopes, ['offline_access']);
  assert.deepEqual(client.attributes.owner, ['workspace-admin']);
  assert.equal(client.providerCompatibility.provider, 'keycloak');

  assert.equal(user.resourceType, 'iam_user');
  assert.deepEqual(user.groups, ['/developers', '/operators']);
  assert.deepEqual(user.realmRoles, ['tenant_admin']);
  assert.deepEqual(user.attributes.locale, ['es-ES']);
});

test('keycloak admin adapter validates conflicting IAM configurations before building provider calls', () => {
  const invalidClient = validateIamAdminRequest({
    resourceKind: 'client',
    action: 'create',
    tenantId: 'tenant-starter-alpha',
    context: {
      scope: 'workspace',
      realmId: 'tenant-starter-alpha',
      workspaceClientNamespace: 'starter-dev'
    },
    payload: {
      clientId: 'wrongprefix-web',
      accessType: 'public',
      serviceAccountsEnabled: true,
      standardFlowEnabled: false,
      directAccessGrantsEnabled: false,
      redirectUris: ['*'],
      defaultScopes: ['openid', 'profile'],
      optionalScopes: ['profile']
    }
  });
  const invalidSamlClient = validateIamAdminRequest({
    resourceKind: 'client',
    action: 'update',
    tenantId: 'tenant-starter-alpha',
    context: {
      scope: 'workspace',
      realmId: 'tenant-starter-alpha',
      workspaceClientNamespace: 'starter-dev'
    },
    payload: {
      clientId: 'starter-dev-partner-hub',
      protocol: 'saml',
      accessType: 'bearer_only',
      serviceAccountsEnabled: true,
      directAccessGrantsEnabled: true,
      logoutBinding: 'redirect',
      redirectUris: []
    }
  });
  const invalidUser = validateIamAdminRequest({
    resourceKind: 'user',
    action: 'reset_credentials',
    tenantId: 'tenant-starter-alpha',
    context: {
      scope: 'tenant',
      realmId: 'tenant-starter-alpha'
    },
    payload: {
      username: 'service-account-console',
      groups: ['/developers', 'developers'],
      realmRoles: ['workspace_admin', 'workspace_admin'],
      requiredActions: ['UPDATE_PASSWORD', 'SOMETHING_UNSUPPORTED'],
      temporaryPassword: 'short'
    }
  });

  assert.equal(invalidClient.ok, false);
  assert.equal(invalidClient.violations.some((violation) => violation.includes('Public clients cannot enable service accounts')), true);
  assert.equal(invalidClient.violations.some((violation) => violation.includes('must enable at least one authentication flow')), true);
  assert.equal(invalidClient.violations.some((violation) => violation.includes('Wildcard redirect URIs')), true);
  assert.equal(invalidClient.violations.some((violation) => violation.includes('must start with namespace starter-dev')), true);

  assert.equal(invalidSamlClient.ok, false);
  assert.equal(invalidSamlClient.violations.some((violation) => violation.includes('SAML clients cannot use bearer_only')), true);
  assert.equal(invalidSamlClient.violations.some((violation) => violation.includes('SAML clients cannot enable service accounts')), true);
  assert.equal(invalidSamlClient.violations.some((violation) => violation.includes('SAML clients cannot enable direct access grants')), true);
  assert.equal(
    invalidSamlClient.violations.some((violation) => violation.includes('assertion consumer service URL or equivalent redirect URI')),
    true
  );
  assert.equal(invalidSamlClient.violations.some((violation) => violation.includes('require a signing certificate reference')), true);

  assert.equal(invalidUser.ok, false);
  assert.equal(invalidUser.violations.some((violation) => violation.includes('groups must be unique')), true);
  assert.equal(invalidUser.violations.some((violation) => violation.includes('realmRoles must be unique')), true);
  assert.equal(invalidUser.violations.some((violation) => violation.includes('unsupported values')), true);
  assert.equal(invalidUser.violations.some((violation) => violation.includes('at least 12 characters')), true);
});

test('keycloak admin adapter builds stable adapter envelopes and normalized dependency errors', () => {
  const adapterCall = buildIamAdminAdapterCall({
    resourceKind: 'realm',
    action: 'create',
    callId: 'call_01iamrealmcreate',
    tenantId: 'tenant-starter-alpha',
    workspaceId: 'wrk_01starterdev',
    planId: 'pln_01growth',
    correlationId: 'corr-iam-001',
    authorizationDecisionId: 'authz-iam-001',
    idempotencyKey: 'idem-iam-001',
    targetRef: 'realm:tenant-starter-alpha',
    context: {
      scope: 'tenant',
      realmId: 'tenant-starter-alpha',
      providerVersion: '25.0.4'
    },
    payload: {
      realm: 'tenant-starter-alpha',
      displayName: 'Starter Alpha',
      enabled: true,
      loginWithEmailAllowed: true,
      registrationAllowed: false,
      defaultClientScopes: ['openid'],
      optionalClientScopes: ['offline_access']
    },
    scopes: ['iam.realms.write'],
    effectiveRoles: ['tenant_admin']
  });
  const normalizedError = normalizeKeycloakAdminError(
    {
      classification: 'conflict',
      status: 409,
      message: 'Client already exists.',
      providerError: 'DuplicateModelException'
    },
    {
      resourceKind: 'client',
      action: 'create',
      realmId: 'tenant-starter-alpha',
      resourceId: 'starter-dev-web'
    }
  );

  assert.equal(adapterCall.adapter_id, 'keycloak');
  assert.equal(adapterCall.capability, 'iam_realm_create');
  assert.equal(adapterCall.payload.resourceKind, 'realm');
  assert.equal(adapterCall.payload.normalizedResource.resourceType, 'iam_realm');
  assert.equal(adapterCall.contract_version, '2026-03-24');

  assert.equal(normalizedError.status, 409);
  assert.equal(normalizedError.code, 'GW_IAM_CONFLICT');
  assert.equal(normalizedError.detail.resourceKind, 'client');
  assert.equal(normalizedError.retryable, false);
});

test('keycloak admin realm normalization surfaces the template required client scopes (#568)', () => {
  // The provisioner must carry the chart tenantRealmTemplate.requiredClientScopes onto the
  // realm so a provisioned tenant realm no longer drifts from the template. The normalizer
  // surfaces requiredScopes (from requiredClientScopes/requiredScopes), parity with the kind
  // runtime's TENANT_REALM_SCOPES applied in createRealm.
  const realm = normalizeKeycloakAdminResource(
    'realm',
    {
      realm: 'tenant-starter-alpha',
      displayName: 'Starter Alpha',
      enabled: true,
      registrationAllowed: true,
      requiredClientScopes: ['tenant-context', 'workspace-context', 'plan-context', 'workspace-roles', 'tenant-context']
    },
    { realmId: 'tenant-starter-alpha' }
  );
  assert.equal(realm.resourceType, 'iam_realm');
  assert.equal(realm.login.registrationAllowed, true);
  assert.deepEqual(realm.requiredScopes, ['tenant-context', 'workspace-context', 'plan-context', 'workspace-roles']);
});

test('deleteServiceAccount returns a normalized, idempotent deleted-resource envelope (#687)', async () => {
  // Previously a NOT_YET_IMPLEMENTED guarded stub; making it behavior-correct lets the WF-CON-006
  // `delete` action AND the create-step compensation complete. It echoes the targeted SA id and is
  // idempotent — never throws on a missing/foreign account — so a compensation re-run cannot fail.
  const fromWorkflowRequest = await deleteServiceAccount({
    request: { input: { serviceAccountId: 'sa-1', targetWorkspaceId: 'workspace-1' } }
  });
  assert.equal(fromWorkflowRequest.resourceType, 'iam_service_account');
  assert.equal(fromWorkflowRequest.serviceAccountId, 'sa-1');
  assert.equal(fromWorkflowRequest.workspaceId, 'workspace-1');
  assert.equal(fromWorkflowRequest.deleted, true);
  assert.equal(fromWorkflowRequest.idempotent, true);

  // Explicit args take precedence over the request projection.
  const fromExplicitArgs = await deleteServiceAccount({ serviceAccountId: 'sa-2', workspaceId: 'workspace-2' });
  assert.equal(fromExplicitArgs.serviceAccountId, 'sa-2');
  assert.equal(fromExplicitArgs.workspaceId, 'workspace-2');

  // Idempotent: deleting with no resolvable id is a no-op success, not a throw.
  const empty = await deleteServiceAccount();
  assert.equal(empty.deleted, true);
  assert.equal(empty.serviceAccountId, null);
});
