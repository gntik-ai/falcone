// Seed route table for the control-plane server (Phase 1 — proven routes).
//
// These are the action mappings already validated end-to-end in tests/env
// (9 families). They exist to prove the server engine — JWT validation,
// callerContext from verified claims, DI, dispatch — against the real kind
// stack BEFORE the full console-driven route map (route-map.json, produced by
// the discovery agent) is merged in Phase 2.
//
// `module` paths resolve under /repo (the repo subset COPYd into the image).
const PO = '/repo/services/provisioning-orchestrator/src/actions';

export const routes = [
  // plan catalog (superadmin)
  { method: 'GET',  path: '/v1/plans', module: `${PO}/plan-list.mjs`, export: 'main',
    invoke: 'callercontext-overrides', deps: ['db'], auth: 'superadmin', mergeQueryIntoParams: true },
  { method: 'POST', path: '/v1/plans', module: `${PO}/plan-create.mjs`, export: 'main',
    invoke: 'callercontext-overrides', deps: ['db'], auth: 'superadmin', mergeBodyIntoParams: true },
  { method: 'GET',  path: '/v1/plans/change-history', module: `${PO}/plan-change-history-query.mjs`, export: 'main',
    invoke: 'callercontext-overrides', deps: ['db'], auth: 'superadmin', mergeQueryIntoParams: true },

  // quota dimension catalog (superadmin)
  { method: 'GET',  path: '/v1/quota-dimensions', module: `${PO}/quota-dimension-catalog-list.mjs`, export: 'main',
    invoke: 'callercontext-overrides', deps: ['db'], auth: 'superadmin' },

  // tenant effective entitlements (tenant-scoped; superadmin may cross-scope)
  { method: 'GET',  path: '/v1/tenant/entitlements', module: `${PO}/tenant-effective-entitlements-get.mjs`, export: 'main',
    invoke: 'callercontext-overrides', deps: ['db'], auth: 'tenant_owner', mergeQueryIntoParams: true },

  // own-tenant plan API (tenant-scoped; operators read their OWN plan — no superadmin collection needed)
  // /v1/tenant/plan/effective-entitlements — full entitlement + consumption profile for the operator's tenant
  { method: 'GET',  path: '/v1/tenant/plan/effective-entitlements', module: `${PO}/tenant-effective-entitlements-get.mjs`, export: 'main',
    invoke: 'callercontext-overrides', deps: ['db'], auth: 'tenant_owner', mergeQueryIntoParams: true },
  // /v1/tenant/effective-capabilities — plan-derived capability flags for the operator's tenant
  { method: 'GET',  path: '/v1/tenant/effective-capabilities', module: `${PO}/tenant-effective-capabilities-get.mjs`, export: 'main',
    invoke: 'callercontext-overrides', deps: ['db'], auth: 'tenant_owner', mergeQueryIntoParams: true },

  // workspace sub-quotas (tenant-scoped write + list)
  { method: 'POST', path: '/v1/workspace-sub-quotas', module: `${PO}/workspace-sub-quota-set.mjs`, export: 'main',
    invoke: 'callercontext-overrides', deps: ['db'], auth: 'tenant_owner', mergeBodyIntoParams: true },
  { method: 'GET',  path: '/v1/workspace-sub-quotas', module: `${PO}/workspace-sub-quota-list.mjs`, export: 'main',
    invoke: 'callercontext-overrides', deps: ['db'], auth: 'tenant_owner', mergeQueryIntoParams: true },

  // ---- domain B: tenant lifecycle + user management (LOCAL handlers) --------
  // Real implementations (kc-admin + tenant-store) of what the repo stubs.
  { method: 'POST', path: '/v1/tenants', localHandler: 'createTenant', auth: 'superadmin' },
  { method: 'GET',  path: '/v1/tenants', localHandler: 'listTenants', auth: 'superadmin' },
  { method: 'GET',  path: '/v1/tenants/{tenantId}', localHandler: 'getTenant', auth: 'authenticated' },
  { method: 'DELETE', path: '/v1/tenants/{tenantId}', localHandler: 'deleteTenant', auth: 'superadmin' },
  { method: 'POST', path: '/v1/tenants/{tenantId}/purge', localHandler: 'purgeTenant', auth: 'superadmin' },
  { method: 'GET',  path: '/v1/tenants/{tenantId}/environments', localHandler: 'listEnvironments', auth: 'authenticated' },
  { method: 'POST', path: '/v1/tenants/{tenantId}/users', localHandler: 'createTenantUser', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/tenants/{tenantId}/users', localHandler: 'listTenantUsers', auth: 'authenticated' },

  // project auth-config (#568): owner enables auth methods + social IdPs for THEIR OWN project's
  // realm (handler authorizes own-tenant; cross-tenant → 403). Were NO_ROUTE (KC-admin only).
  { method: 'GET',    path: '/v1/tenants/{tenantId}/auth-config', localHandler: 'getAuthConfig', auth: 'authenticated' },
  { method: 'PUT',    path: '/v1/tenants/{tenantId}/auth-config', localHandler: 'setAuthConfig', auth: 'authenticated' },
  { method: 'PUT',    path: '/v1/tenants/{tenantId}/auth-config/identity-providers/{alias}', localHandler: 'setSocialProvider', auth: 'authenticated' },
  { method: 'DELETE', path: '/v1/tenants/{tenantId}/auth-config/identity-providers/{alias}', localHandler: 'deleteSocialProvider', auth: 'authenticated' },

  // ---- domain B: workspaces (LOCAL) ----------------------------------------
  { method: 'POST', path: '/v1/tenants/{tenantId}/workspaces', localHandler: 'createWorkspace', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/tenants/{tenantId}/workspaces', localHandler: 'listTenantWorkspaces', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/workspaces', localHandler: 'listWorkspaces', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/workspaces/{workspaceId}', localHandler: 'getWorkspace', auth: 'authenticated' },

  // ---- domain B: service accounts + credentials (LOCAL) --------------------
  { method: 'POST', path: '/v1/workspaces/{workspaceId}/service-accounts', localHandler: 'createServiceAccount', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/workspaces/{workspaceId}/service-accounts', localHandler: 'listServiceAccounts', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}', localHandler: 'getServiceAccount', auth: 'authenticated' },
  { method: 'POST', path: '/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-issuance', localHandler: 'issueCredential', auth: 'authenticated' },
  { method: 'POST', path: '/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-rotations', localHandler: 'rotateCredential', auth: 'authenticated' },
  { method: 'POST', path: '/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-revocations', localHandler: 'revokeCredential', auth: 'authenticated' },

  // ---- domain B: workspace data plane (DB provisioning + function registry) --
  { method: 'POST', path: '/v1/workspaces/{workspaceId}/database', localHandler: 'provisionDatabase', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/workspaces/{workspaceId}/database', localHandler: 'getDatabase', auth: 'authenticated' },
  { method: 'POST', path: '/v1/workspaces/{workspaceId}/database/credential-rotations', localHandler: 'rotateDatabaseCredential', auth: 'authenticated' },
  { method: 'POST', path: '/v1/workspaces/{workspaceId}/functions', localHandler: 'registerFunction', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/workspaces/{workspaceId}/functions', localHandler: 'listFunctions', auth: 'authenticated' },

  // ---- domain B: fine-grained IAM (platform admin; realmId in path) ---------
  { method: 'GET',  path: '/v1/iam/realms/{realmId}/users', localHandler: 'iamListUsers', auth: 'superadmin' },
  { method: 'POST', path: '/v1/iam/realms/{realmId}/users', localHandler: 'iamCreateUser', auth: 'superadmin' },
  // app end-user lifecycle (#567): owner-of-realm OR superadmin (handler authorizes); were NO_ROUTE.
  { method: 'DELETE', path: '/v1/iam/realms/{realmId}/users/{userId}', localHandler: 'iamDeleteUser', auth: 'authenticated' },
  { method: 'PATCH',  path: '/v1/iam/realms/{realmId}/users/{userId}/status', localHandler: 'iamSetUserStatus', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/iam/realms/{realmId}/roles', localHandler: 'iamListRoles', auth: 'superadmin' },
  { method: 'POST', path: '/v1/iam/realms/{realmId}/roles', localHandler: 'iamCreateRole', auth: 'superadmin' },
  { method: 'GET',  path: '/v1/iam/realms/{realmId}/groups', localHandler: 'iamListGroups', auth: 'superadmin' },
  { method: 'POST', path: '/v1/iam/realms/{realmId}/groups', localHandler: 'iamCreateGroup', auth: 'superadmin' },
  { method: 'GET',  path: '/v1/iam/realms/{realmId}/clients', localHandler: 'iamListClients', auth: 'superadmin' },
  // fine-grained: role assignment to users + group membership
  { method: 'GET',    path: '/v1/iam/realms/{realmId}/users/{userId}/roles', localHandler: 'iamListUserRoles', auth: 'superadmin' },
  { method: 'POST',   path: '/v1/iam/realms/{realmId}/users/{userId}/role-assignments', localHandler: 'iamAssignUserRoles', auth: 'superadmin' },
  { method: 'DELETE', path: '/v1/iam/realms/{realmId}/users/{userId}/role-assignments', localHandler: 'iamRemoveUserRoles', auth: 'superadmin' },
  { method: 'GET',    path: '/v1/iam/realms/{realmId}/users/{userId}/groups', localHandler: 'iamListUserGroups', auth: 'superadmin' },
  { method: 'PUT',    path: '/v1/iam/realms/{realmId}/users/{userId}/groups/{groupId}', localHandler: 'iamAddUserToGroup', auth: 'superadmin' },
  { method: 'DELETE', path: '/v1/iam/realms/{realmId}/users/{userId}/groups/{groupId}', localHandler: 'iamRemoveUserFromGroup', auth: 'superadmin' },
  { method: 'GET',    path: '/v1/iam/realms/{realmId}/groups/{groupId}/members', localHandler: 'iamListGroupMembers', auth: 'superadmin' },

  // ---- domain B: console metrics (Quotas + Observability) -------------------
  // Synthesized from real entitlements/consumption (limits+usage); series/audit
  // are empty (no metrics data plane / audit store deployed).
  { method: 'GET',  path: '/v1/metrics/tenants/{tenantId}/quotas', localHandler: 'metricsTenantQuotas', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/metrics/tenants/{tenantId}/overview', localHandler: 'metricsTenantOverview', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/metrics/tenants/{tenantId}/usage', localHandler: 'metricsTenantUsage', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/metrics/tenants/{tenantId}/series', localHandler: 'metricsTenantSeries', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/metrics/tenants/{tenantId}/audit-records', localHandler: 'metricsTenantAudit', auth: 'authenticated' },
  { method: 'POST', path: '/v1/metrics/tenants/{tenantId}/audit-exports', localHandler: 'metricsTenantAuditExport', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/metrics/workspaces/{workspaceId}/quotas', localHandler: 'metricsWorkspaceQuotas', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/metrics/workspaces/{workspaceId}/overview', localHandler: 'metricsWorkspaceOverview', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/metrics/workspaces/{workspaceId}/usage', localHandler: 'metricsWorkspaceUsage', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/metrics/workspaces/{workspaceId}/series', localHandler: 'metricsWorkspaceSeries', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/metrics/workspaces/{workspaceId}/audit-records', localHandler: 'metricsWorkspaceAudit', auth: 'authenticated' },
  { method: 'POST', path: '/v1/metrics/workspaces/{workspaceId}/audit-exports', localHandler: 'metricsWorkspaceAuditExport', auth: 'authenticated' },

  // ---- domain B: PostgreSQL data browser (REAL pg catalogs, read-only) ------
  { method: 'GET', path: '/v1/postgres/databases', localHandler: 'pgListDatabases', auth: 'authenticated' },
  { method: 'GET', path: '/v1/postgres/databases/{db}/schemas', localHandler: 'pgListSchemas', auth: 'authenticated' },
  { method: 'GET', path: '/v1/postgres/databases/{db}/schemas/{schema}/tables', localHandler: 'pgListTables', auth: 'authenticated' },
  { method: 'GET', path: '/v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/columns', localHandler: 'pgColumns', auth: 'authenticated' },
  { method: 'GET', path: '/v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/indexes', localHandler: 'pgIndexes', auth: 'authenticated' },
  { method: 'GET', path: '/v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/policies', localHandler: 'pgPolicies', auth: 'authenticated' },
  { method: 'GET', path: '/v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/security', localHandler: 'pgSecurity', auth: 'authenticated' },
  { method: 'GET', path: '/v1/postgres/databases/{db}/schemas/{schema}/views', localHandler: 'pgViews', auth: 'authenticated' },
  { method: 'GET', path: '/v1/postgres/databases/{db}/schemas/{schema}/materialized-views', localHandler: 'pgMatViews', auth: 'authenticated' },

  // ---- domain B: MongoDB document store (REAL mongodb driver) ---------------
  { method: 'GET',  path: '/v1/mongo/databases', localHandler: 'mongoListDatabases', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/mongo/databases/{db}/collections', localHandler: 'mongoListCollections', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/mongo/databases/{db}/collections/{col}', localHandler: 'mongoCollectionDetail', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/mongo/databases/{db}/collections/{col}/indexes', localHandler: 'mongoIndexes', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/mongo/databases/{db}/views', localHandler: 'mongoViews', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/mongo/workspaces/{workspaceId}/data/{db}/collections/{col}/documents', localHandler: 'mongoDocuments', auth: 'authenticated' },
  // engine-dispatched DB provisioning (postgresql | mongodb) — the SPA wizard target
  { method: 'POST', path: '/v1/workspaces/{workspaceId}/databases', localHandler: 'provisionDatabaseGeneric', auth: 'authenticated' },

  // ---- domain B: object storage (REAL MinIO/S3 via SigV4) -------------------
  { method: 'GET',  path: '/v1/storage/buckets', localHandler: 'storageListBuckets', auth: 'authenticated' },
  { method: 'POST', path: '/v1/storage/workspaces/{workspaceId}/buckets', localHandler: 'storageProvisionBucket', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/storage/workspaces/{workspaceId}/usage', localHandler: 'storageWorkspaceUsage', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/storage/buckets/{bucketId}/objects', localHandler: 'storageListObjects', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata', localHandler: 'storageObjectMetadata', auth: 'authenticated' },
  // Object I/O — upload/download/delete a single object (#500: previously NO_ROUTE).
  { method: 'PUT',    path: '/v1/storage/buckets/{bucketId}/objects/{objectKey}', localHandler: 'storagePutObject', auth: 'authenticated' },
  { method: 'GET',    path: '/v1/storage/buckets/{bucketId}/objects/{objectKey}', localHandler: 'storageGetObject', auth: 'authenticated' },
  { method: 'DELETE', path: '/v1/storage/buckets/{bucketId}/objects/{objectKey}', localHandler: 'storageDeleteObject', auth: 'authenticated' },

  // ---- domain B: Functions (REAL execution via ephemeral k8s Jobs) ----------
  { method: 'GET',  path: '/v1/functions/workspaces/{workspaceId}/inventory', localHandler: 'fnInventory', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/functions/workspaces/{workspaceId}/actions', localHandler: 'fnListActions', auth: 'authenticated' },
  { method: 'POST', path: '/v1/functions/actions', localHandler: 'fnDeploy', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/functions/actions/{actionId}', localHandler: 'fnActionDetail', auth: 'authenticated' },
  { method: 'PUT',  path: '/v1/functions/actions/{actionId}', localHandler: 'fnDeploy', auth: 'authenticated' },
  { method: 'POST', path: '/v1/functions/actions/{actionId}/invocations', localHandler: 'fnInvoke', auth: 'authenticated' },
  { method: 'POST', path: '/v1/functions/actions/{actionId}/rollback', localHandler: 'fnRollback', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/functions/actions/{actionId}/versions', localHandler: 'fnVersions', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/functions/actions/{actionId}/activations', localHandler: 'fnActivations', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/functions/actions/{actionId}/activations/{activationId}', localHandler: 'fnActivation', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/functions/actions/{actionId}/activations/{activationId}/logs', localHandler: 'fnActivationLogs', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/functions/actions/{actionId}/activations/{activationId}/result', localHandler: 'fnActivationResult', auth: 'authenticated' },

  // ---- domain B: Events / Kafka (REAL kafkajs; PLAINTEXT broker) ------------
  { method: 'GET',  path: '/v1/events/workspaces/{workspaceId}/inventory', localHandler: 'eventsInventory', auth: 'authenticated' },
  { method: 'POST', path: '/v1/events/workspaces/{workspaceId}/topics', localHandler: 'eventsProvisionTopic', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/events/topics/{topicId}', localHandler: 'eventsTopicDetail', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/events/topics/{topicId}/access', localHandler: 'eventsTopicAccess', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/events/topics/{topicId}/metadata', localHandler: 'eventsTopicMetadata', auth: 'authenticated' },
  { method: 'POST', path: '/v1/events/topics/{topicId}/publish', localHandler: 'eventsTopicPublish', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/events/topics/{topicId}/stream', localHandler: 'eventsTopicStream', auth: 'authenticated', stream: true },

  // ---- domain B: console auth (PUBLIC — these mint/verify the session) ------
  { method: 'POST',   path: '/v1/auth/login-sessions', localHandler: 'login', auth: 'public' },
  { method: 'POST',   path: '/v1/auth/signups', localHandler: 'signup', auth: 'public' },
  { method: 'POST',   path: '/v1/auth/login-sessions/{sessionId}/refresh', localHandler: 'refresh', auth: 'public' },
  { method: 'DELETE', path: '/v1/auth/login-sessions/{sessionId}', localHandler: 'logout', auth: 'authenticated' },
  { method: 'GET',    path: '/v1/auth/signups/policy', localHandler: 'signupPolicy', auth: 'public' }
];
