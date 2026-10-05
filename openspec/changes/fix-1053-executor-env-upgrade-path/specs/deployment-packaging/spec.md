## ADDED Requirements

### Requirement: Existing executor JWT env upgrades have verified path evidence

The deployment ChangeSet SHALL test upgrades from pre-#980 chart revision
`433be51` to the exact target chart revision against a live Kubernetes API
server. It SHALL record independent outcomes for Helm 3 client-side upgrade,
Argo-style client-side apply of a Helm-created Deployment without a
last-applied record, and Helm 4 server-side apply as used by the harness.
The chosen migration mechanism SHALL cite those results as its justification.

#### Scenario: Untreated upgrade reproduces the defect

- **GIVEN** an executor Deployment created from the `433be51` render
- **WHEN** each untreated upgrade path is exercised against the live API server
- **THEN** at least one path rejects retained nonempty `value` beside `valueFrom`
  with the reported `may not be specified when value is not empty` validation
- **AND** evidence records each path's success or failure without assuming
  the Helm 3 result from the Argo or Helm 4 result

#### Scenario: Chosen migration upgrades an existing release

- **GIVEN** the old executor Deployment and the exact target chart/values render
- **WHEN** the chosen mechanism is used for a path requiring recovery
- **THEN** the live API server accepts the target Deployment
- **AND** its rollout reaches Available and its pod env resolves all five
  JWT configuration variables from the executor JWT ConfigMap

### Requirement: Executor JWT env entries are unambiguous in every tested profile

The target executor Deployment SHALL contain exactly one entry for each of
`KEYCLOAK_JWKS_URL`, `KEYCLOAK_ISSUER`, `KEYCLOAK_AUDIENCE`,
`KEYCLOAK_TENANT_AUDIENCE`, and `KEYCLOAK_ENFORCE_TENANT_AUDIENCE`.
Each SHALL use only `valueFrom.configMapKeyRef`, with no `value` field.
Validation SHALL reject any executor env entry with both `value` and
`valueFrom` and any duplicate JWT env name. Tests SHALL include default,
staging, prod and ordered layers containing the production TLS overlay
`deploy/kind/values-production.yaml`.

#### Scenario: Historical and target render contracts differ as intended

- **GIVEN** old and target renders for the supported profiles
- **WHEN** the env regression test examines the executor
- **THEN** the old render uses literal values for JWKS URL, issuer and audience
- **AND** the target has all five unique, reference-only JWT entries

#### Scenario: Invalid env shapes fail the regression check

- **GIVEN** a render containing a duplicate JWT name or any env entry with
  both `value` and `valueFrom`, including one introduced by the prod-TLS overlay
- **WHEN** the env regression check runs
- **THEN** it fails rather than allowing last-entry-wins behavior

### Requirement: Executor migration is atomic, bounded and repeatable

The chosen mechanism SHALL target only
`{release}-control-plane-executor` in the release namespace using the exact
target chart revision and ordered values layers. It SHALL ensure
`{release}-executor-jwt-config` exists with the required keys before new pods
start. Removing an old literal value and adding its reference SHALL occur
in the same atomic operation. It SHALL preserve the executor Service and
ConfigMap and SHALL never use Helm `--force` for the whole release.

#### Scenario: Migration preserves JWT configuration and live object state

- **GIVEN** a serving old Deployment and an available target JWT ConfigMap
- **WHEN** the migration updates only the executor Deployment
- **THEN** no intermediate executor pod runs without JWKS URL, issuer or audience
- **AND** live replicas and annotations managed by other actors are checked
  and preserved or explicitly reconciled by the tested step
- **AND** the Service and ConfigMap are not deleted

#### Scenario: Migration is repeated on an already migrated release

- **GIVEN** a Deployment already using the target ConfigMap references
- **WHEN** the same migration is rerun
- **THEN** it is a no-op and retains valid env entries and availability

### Requirement: Release guidance orders migration with existing audience gates

The deployment ChangeSet SHALL document the selected step, affected upgrade
paths, target render inputs, preconditions, verification and rollback in
the next unpublished chart version's release notes and in
`charts/in-falcone/docs/mongo-bearer-route-980-handoff.md`'s prod checklist.
It SHALL preserve published release notes/packages and existing migration,
backup, parity, immutable-image and External Secrets/OpenBao gates.

#### Scenario: Operator prepares a production rollout

- **GIVEN** prod inherits tenant audience enforcement
- **WHEN** the operator follows the release notes and prod checklist
- **THEN** tenant-app and service-account audience reconciliation completes
  before enforcement, and real prod issuer/JWKS hosts are confirmed in the
  exact values layers before migrating the executor
- **AND** verification checks availability, unique reference-only env entries,
  replicas and annotations without emitting ConfigMap or Secret payloads
- **AND** rollback covers reapplying the `433be51` executor Deployment render
  or retrying forward without deleting its Service or ConfigMap

#### Scenario: An Argo sync-option is selected

- **GIVEN** evidence justifies a chart-level Argo mechanism
- **WHEN** that option is added to the chart
- **THEN** it applies only to the executor Deployment
- **AND** the `deploy/argocd/README.md` equivalence check is updated and prints OK
- **AND** an equivalent Helm path is documented and tested

### Requirement: Source and deployment verification remain paired

Both source workflow `FALCONE_CHARTS_REF` pins SHALL equal the final deployment
HEAD after Hermes synchronizes them, and the existing Mongo route parity
test SHALL pass against that checkout. Upgrade tests SHALL use disposable
kind clusters or live server-side dry-runs; live cases may self-skip locally
but SHALL run in deployment CI. Render fixture changes SHALL be justified
in the handoff only when required by the chosen mechanism.

#### Scenario: Paired ChangeSet is ready for delivery

- **GIVEN** the deployment maker has produced its final local commit
- **WHEN** Hermes updates the managed pins and CI verifies the paired changes
- **THEN** both pins match that deployment HEAD and
  `tests/blackbox/mongo-gateway-route.test.mjs` passes
- **AND** OpenSpec strict validation, live upgrade regression, required Helm
  lint profiles and the deployment Mongo bearer chart test pass
- **AND** evidence is redacted and no shared-cluster or credential action is used
