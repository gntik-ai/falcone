## ADDED Requirements

### Requirement: Shared workspace authority for non-storage resources

The control plane SHALL use one shared visibility gate for in-scope functions,
PostgreSQL and MongoDB data/metadata, Kafka topics, workspace-addressed webhooks,
realtime configuration and storage usage. Authority SHALL come only from verified
identity and stored scope. Superadmin/internal bypasses and existing Function
platform-trust requirements SHALL remain unchanged. Same-tenant verified
tenant_owner/tenant_admin roles SHALL retain workspace visibility. Other callers
SHALL require model authority for the family action set, or a verified tenant-tier
role and an explicit matching identity.workspaceIds binding. Existing action and
owner/admin structural checks SHALL remain additional requirements.

Denied addressed resources SHALL use their existing resource-specific envelopes
before any downstream side effect or connection. Function inventory, action-list
and create/update workspace resolution SHALL retain the existing uniform 403
FORBIDDEN for absent, foreign and unauthorized workspaces; these routes had no
workspace 404 contract. Function secrets and action/activation routes SHALL retain
their existing not-found envelopes. Collection APIs SHALL omit unauthorized
resources. Missing/null workspace mappings SHALL fail closed for non-platform
callers, except the explicitly preserved #973 storage owner/admin compatibility.
Request body, query, path and x-* headers SHALL NOT grant workspace authority.

#### Scenario: Unbound or development-bound member requests production

- **WHEN** an unbound tenant_viewer/tenant_developer or a ws1-bound caller requests
  an in-scope resource in ws2 of the same tenant
- **THEN** the resource returns its existing denial envelope without Knative, Kafka,
  PostgreSQL/MongoDB data connection, webhook action or S3 work
- **AND** correct workspace identifiers in request fields do not change the decision

#### Scenario: Authorized caller retains its response

- **WHEN** a ws2-bound identity has the required model and structural authority
- **THEN** its existing ws2 success shape is preserved
- **AND** verified tenant administrators retain tenant-wide visibility
- **AND** platform/internal behavior and existing Function trust checks are preserved

#### Scenario: Foreign or unmapped resources stay concealed

- **WHEN** a non-platform identity requests a foreign resource or one lacking
  a tenant/workspace mapping
- **THEN** it receives the same denial shape as an absent resource
- **AND** existing validation that precedes authorization retains precedence

#### Scenario: Shared MongoDB names do not merge workspace authority

- **WHEN** a database name is registered to both ws1 and ws2 and the caller is
  bound only to ws1
- **THEN** metadata counts include only ws1 documents stamped with its tenant/workspace
- **AND** a database registered only to ws2 is denied before a MongoDB connection

#### Scenario: Verified tenant administrators retain metadata visibility

- **WHEN** a verified tenant_owner/tenant_admin requests metadata for a mapped database
- **THEN** counts include all documents stamped with that tenantId, including legacy
  documents without workspaceId, without counting a document once per mapping
- **AND** other tenants' documents remain excluded
- **AND** an unregistered database remains denied before connection

#### Scenario: Existing Function role and binding contracts remain bounded

- **WHEN** a workspace_service_account has a binding and model grant
- **THEN** no new Function read/invoke role grant is introduced by this change
- **AND** a singular identity.workspaceId without matching identity.workspaceIds
  no longer establishes Function read/invoke authority

#### Scenario: Storage compatibility remains pinned

- **WHEN** the shared module replaces the private #973 predicate
- **THEN** existing bucket responses, bytes, legacy admin model grants and tests
  remain unchanged
- **AND** storage usage requires workspace authority before bucket enumeration or S3

#### Scenario: New addressed routes cannot silently bypass the gate

- **WHEN** an authenticated workspace/resource route is added to routes.mjs
- **THEN** behavioral coverage invokes its exported handler with unbound and
  wrong-workspace verified roles and requires denial before downstream work
- **AND** only explicitly frozen, existing out-of-scope routes are excluded
