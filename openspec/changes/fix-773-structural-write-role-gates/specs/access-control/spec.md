# access-control - spec delta for fix-773-structural-write-role-gates

## MODIFIED Requirements

### Requirement: Structural writes require an admin tenant role on every path

The system SHALL authorize structural/administrative writes by the caller's tenant role on every
write path: executor JWT paths for flow definitions, MCP server hosting/curation/publish/approval,
workspace LLM provider config, workspace embedding provider config, and embedding mapping; and
control-plane handlers for storage bucket provisioning/deletion, storage credential
rotation/revocation, object write/delete I/O, presign, multipart, import/export, Kafka topic
creation, and Kafka publish. The system SHALL require a positive write-capable admin role on executor
structural writes; API-key/dbRole identities and JWT/header identities with missing or empty roles
SHALL NOT be treated as structural admins. The system SHALL deny `tenant_developer`,
`tenant_viewer`, API keys, and missing/empty-role identities with `403 FORBIDDEN`, persisting,
creating, issuing, publishing, or deleting nothing. Workspace-scoped writes SHALL additionally
enforce the caller's verified `workspaceIds` when present and SHALL reject writes to unknown
workspaces before creating phantom resources.

Cross-tenant/no-leak ordering SHALL be preserved: a caller addressing a resource owned by another
tenant receives the existing cross-tenant or not-found outcome before any within-tenant role detail is
revealed. Read operations and streams SHALL remain governed by their existing tenant membership and
ownership checks unless they perform structural side effects.

#### Scenario: read-only viewer cannot host an MCP server

- **WHEN** a `tenant_viewer` calls `POST /v1/mcp/workspaces/{ws}/servers`
- **THEN** the system responds `403 FORBIDDEN` and creates no server

#### Scenario: API key cannot perform executor structural writes

- **WHEN** an API-key credential with `data:write` calls `PUT /v1/workspaces/{ws}/llm-provider` or
  `POST /v1/mcp/workspaces/{ws}/servers`
- **THEN** the system responds `403 FORBIDDEN` and invokes no provider or MCP side effect

#### Scenario: developer cannot mint storage credentials

- **WHEN** a `tenant_developer` calls `POST /v1/storage/buckets/{bucket}/credentials`
- **THEN** the system responds `403 FORBIDDEN` and issues no S3 key

#### Scenario: developer cannot create a Kafka topic from the console

- **WHEN** a `tenant_developer` uses the Events console create-topic action
- **THEN** the action is not offered or the server denies it with `403 FORBIDDEN`, and no topic is
  created

#### Scenario: writes are confined to the caller's workspaces

- **WHEN** a tenant member writes to a workspace outside its verified `workspaceIds` or to a
  non-existent workspace UUID
- **THEN** the system denies the write and creates nothing
