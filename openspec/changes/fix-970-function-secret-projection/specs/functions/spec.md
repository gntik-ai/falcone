## MODIFIED Requirements

### Requirement: Workspace secret consumption

The system SHALL keep resolved workspace-secret values out of workload specifications and bind
derived material to source-secret and Function lifecycle. OpenBao SHALL remain the system of record.

#### Scenario: Deploy consumes declared workspace secrets

- **WHEN** an authorized Function deploy declares workspace-secret names and env mappings
- **THEN** only those tenant/workspace values enter its owned Kubernetes Secret
- **AND** env uses `valueFrom.secretKeyRef` with `optional: false`, without inline resolved values
- **AND** the Secret carries tenant/Function ownership labels and the Service UID owner reference
- **AND** action/version records contain only names and mappings, never values

#### Scenario: Projection or deployment fails

- **WHEN** a Secret write fails
- **THEN** deploy returns a redacted error before any Service write, with no inline fallback
- **WHEN** new Function creation fails after creating runtime material
- **THEN** cleanup removes it, or retains registry ownership and a retryable deletion obligation
- **WHEN** redeploying an existing Function fails, including a failed Secret restore
- **THEN** its registry row, published versions and lifecycle remain unchanged
- **AND** a redacted error permits retrying deployment without requiring Function deletion

#### Scenario: Redeploy drops declarations

- **WHEN** redeployment retains fewer declarations or none
- **THEN** the projection removes dropped keys, or is deleted for an empty declaration

#### Scenario: Replace or delete a consumed secret

- **WHEN** an authorized secret replace/delete is requested
- **THEN** every consumer projection is updated/revoked and affected Function IDs are reported
- **AND** legacy inline material is removed from Services, Configurations, Revisions, Deployments
  and ReplicaSets before success
- **AND** pending reconciliation returns a redacted 502 with retryable `pendingResources`
- **AND** successful replace returns 200; successful delete returns 204 without a body, with
  `x-falcone-affected-functions` and `x-falcone-resolved-ref-count` headers
- **AND** revoked declarations remain counted, with missing projections failing closed on new pods;
  ordinary deploy/rollback rejects missing source secrets before runtime writes

#### Scenario: Function deletion or aggregate teardown

- **WHEN** a Function, workspace or tenant is deleted
- **THEN** owned projections and workload descendants are removed before registry ownership is lost
- **AND** incomplete cleanup returns 202 with obligations retryable through Function DELETE or purge
- **AND** callers retry after foreground GC; no automatic reconciler is promised

#### Scenario: Discover and remediate existing inline workloads

- **WHEN** an operator requests namespace discovery
- **THEN** a read-only paginated scan finds labelled Functions with inline non-reserved env in
  their owned Service/Configuration/Revision/Deployment/ReplicaSet ancestry
- **AND** reports contain identifiers and env names without values, source, database or OpenBao reads
- **WHEN** the operator explicitly applies remediation with verified registry scope and declarations
- **THEN** OpenBao values replace workload literals by reference and legacy Revisions are pruned
- **AND** pending GC is reported for retry; unlabelled or rootless workloads need separate investigation

#### Scenario: Existing rejection boundaries

- **WHEN** declarations use a reserved env name, foreign tenant/workspace, or disabled secrets backend
- **THEN** deploy returns 400, 403, or 501 respectively before any Secret or Service write
- **AND** foreign ownership labels are never adopted or modified
- **AND** hosted MCP receives no workspace-secret values
