## MODIFIED Requirements

### Requirement: Tenant purge removes secret material

The system SHALL destroy all versions of workspace secrets under a resolved tenant's prefix during tenant purge, and under a resolved workspace's prefix during workspace deletion. Secret teardown SHALL run after runtime teardown permits completion and before registry rows are deleted. Prefixes SHALL be derived only from resolved registry identifiers, never request-body coordinates. Missing, empty, or unsafe identifiers SHALL never cause a list or delete at the shared secret root.

#### Scenario: Secrets are destroyed, not soft-deleted

- **WHEN** a tenant with secrets across multiple workspaces is purged
- **THEN** KV-v2 metadata DELETE destroys every version under that tenant's prefix
- **AND** both data and metadata reads return not-found
- **AND** `removed.secrets` lists destroyed entries as `workspaceId/name` paths
- **AND** secrets belonging to another tenant remain readable

#### Scenario: Workspace deletion is isolated

- **WHEN** an authorized caller deletes a workspace with secrets
- **THEN** only the resolved workspace's secret prefix is destroyed
- **AND** `removed.secrets` lists the destroyed secret names
- **AND** sibling workspaces and other tenants retain their secrets

#### Scenario: Failure to remove is disclosed and recoverable

- **WHEN** a metadata delete, listing, or verification fails, including a denial, backend error, or timeout
- **THEN** the handler returns 502 `SECRET_TEARDOWN_INCOMPLETE`
- **AND** `residual.secrets` enumerates failed names or unverified prefixes without values
- **AND** tenant and workspace registry rows remain available
- **AND** repeating the same authorized purge or delete request after recovery completes the removal

#### Scenario: Empty prefixes are idempotent

- **WHEN** a prefix is already empty or returns not-found
- **THEN** teardown succeeds with an empty `removed.secrets` list

#### Scenario: Backend configuration is disclosed

- **WHEN** no secret backend is configured
- **THEN** purge or deletion proceeds with `residual.secretsBackend` equal to `disabled`
- **AND** `removed.secrets` and `residual.secrets` are empty arrays

#### Scenario: Runtime cleanup is pending

- **WHEN** the runtime teardown coordinator reports pending cleanup
- **THEN** the existing 202 `cleanup_pending` response is preserved
- **AND** secrets and registry rows are retained

#### Scenario: Metadata-only disclosure

- **WHEN** teardown returns a response or writes logs
- **THEN** only secret names or paths may be disclosed, never values or upstream error bodies

#### Scenario: One process authentication provider

- **WHEN** function and lifecycle handlers access the configured secret backend
- **THEN** they share one store and Kubernetes-auth provider per process
- **AND** tests can inject the store through `ctx.vaultStore`
