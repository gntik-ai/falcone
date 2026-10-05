## ADDED Requirements

### Requirement: Existing executor JWT env upgrades have verified path evidence

The deployment ChangeSet SHALL test upgrades from pre-#980 chart revision
`433be51` to the exact target chart revision against a live Kubernetes API
server. It SHALL record independent outcomes for Helm 3 client-side upgrade,
Argo-style client-side apply of a Helm-created Deployment without a
last-applied record, and Helm 4 server-side apply as used by the harness.
The chosen migration mechanism SHALL cite those results as its justification.
Before release, the unpublished release notes and prod handoff SHALL record
the actual untreated, migration and retry outcomes for all three paths and
reference the redacted evidence artifact ID and SHA256. Field-ownership
conflicts SHALL be distinguished from env validation failures; a conflict
alone SHALL NOT count as reproduction of the reported env defect.

#### Scenario: Completed matrix persists usable evidence

- **GIVEN** all six starting-state/path cases have completed
- **WHEN** the harness records client versions and serializes the outcomes
- **THEN** Helm 3 is resolved from `HELM3_BIN` in the evidence-writing scope
  and the evidence JSON is written with every outcome and its SHA256 reported
- **AND** an offline regression exercises evidence generation without a live
  cluster so a scope error cannot break the required upload after the matrix

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

#### Scenario: Helm 4 retry respects externally managed replicas

- **GIVEN** a migrated executor whose live replica count is owned by another
  field manager, as with an HPA
- **WHEN** the harness retries Helm 4 server-side delivery
- **THEN** the env upgrade matrix avoids an incidental replica conflict by
  excluding externally managed replicas from the applied probe manifest or
  using another tested ownership-preserving procedure
- **AND** a separate contention case records any expected ownership conflict
  and proves the documented recovery permits delivery without taking over
  externally managed replicas or forcing conflicts across the whole release
- **AND** a handled conflict is not reported as a successful retry until the
  delivery succeeds and the executor remains Available

### Requirement: Executor JWT env entries are unambiguous in every tested profile

The target executor Deployment SHALL contain exactly one entry for each of
`KEYCLOAK_JWKS_URL`, `KEYCLOAK_ISSUER`, `KEYCLOAK_AUDIENCE`,
`KEYCLOAK_TENANT_AUDIENCE`, and `KEYCLOAK_ENFORCE_TENANT_AUDIENCE`.
Each SHALL use only `valueFrom.configMapKeyRef`, with no `value` field.
Validation SHALL reject any executor env entry with both `value` and
`valueFrom` and any duplicate JWT env name. Tests SHALL include default,
staging, prod and ordered layers containing the production TLS overlay
`deploy/kind/values-production.yaml` on both prod and kind profiles.

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

### Requirement: TLS duplicate repair preserves effective executor JWT configuration

The duplicate repair SHALL preserve the executor's effective JWT configuration
from deployment base `93ee9371fdbd029ff49909ff1fb5c03eeff0ddae` for both
prod-TLS and kind-TLS. Tests SHALL resolve the target executor's ConfigMap
reference internally and compare the JWKS URL's scheme, host, port and path
with the previously effective last env entry. The TLS endpoint SHALL remain
HTTPS on port 8443. Moving that effective value into the executor ConfigMap
source is permitted; changing the gateway verifier to accomplish it is not.
Evidence SHALL report assertions without printing ConfigMap payloads.

#### Scenario: TLS profiles retain the effective JWKS endpoint

- **GIVEN** prod and kind profiles each layered with
  `deploy/kind/values-production.yaml`, whose previous effective executor JWKS
  env entry was the appended TLS literal
- **WHEN** the duplicate repair renders each profile with one reference-only
  `KEYCLOAK_JWKS_URL` entry
- **THEN** resolving that reference yields the same effective scheme, host,
  port and path as before the repair
- **AND** the existing gateway verifier configuration remains unchanged
- **AND** a regression to HTTP on port 8080 fails the check even when env
  uniqueness and `NODE_EXTRA_CA_CERTS` checks pass

#### Scenario: An existing #980 TLS release contains duplicate JWKS names

- **GIVEN** a live executor created from `93ee9371` with the prod-TLS or
  kind-TLS values layers and two `KEYCLOAK_JWKS_URL` env entries
- **WHEN** it upgrades to the target render using the documented atomic step
- **THEN** exactly one reference-only entry for each of the five JWT names
  remains and the effective HTTPS JWKS endpoint is preserved
- **AND** target delivery and atomic repair retain the executor rollout pause,
  the target ConfigMap is verified before repair, and all five references are
  verified after delivery before the executor resumes
- **AND** rollout reaches Available and repeating the step is a no-op
- **AND** guidance covers this starting state separately from pre-#980
  literal-env releases, without assuming same-name merge entries are safe

### Requirement: Reused historical values retain executor JWT configuration

The chart SHALL preserve previously configured executor JWT env when rendering
with Helm `--reuse-values` from `433be51`. Regression tests SHALL coalesce that
revision's `values.yaml` with its prod or kind values and
`deploy/kind/values-production.yaml`, then render the target chart with those
inherited values. A shared TLS JWT entry SHALL be suppressed only when the
component env already supplies a `valueFrom` entry of the same name, or an
equivalent repair preserves the inherited configuration. The chart SHALL NOT
silently unset JWKS URL, issuer or audience previously configured by the release.
Inherited literal-env renders SHALL be tested separately from the fully reviewed
target render, which SHALL retain the five unique ConfigMap references required
above. Advising operators to avoid `--reuse-values` SHALL NOT replace this test.

#### Scenario: Historical prod-TLS or kind-TLS values lack new references

- **GIVEN** coalesced `433be51` values with the TLS overlay and a component env
  array lacking the new JWT ConfigMap references
- **WHEN** the target chart renders with those reused values
- **THEN** the inherited TLS JWKS entry remains present with its effective value
- **AND** any previously configured issuer and audience remain present
- **AND** no executor env entry has both `value` and `valueFrom`, and no JWT
  name is duplicated
- **AND** the test fails if JWT configuration disappears, even if the render
  succeeds and the JWT ConfigMap contains the corresponding keys

#### Scenario: Component env already references the target JWT ConfigMap

- **GIVEN** the fully reviewed target values and a shared TLS JWT literal
- **WHEN** the duplicate repair filters that literal
- **THEN** the component's same-name ConfigMap reference remains present
- **AND** the target retains all five unique reference-only JWT env entries
- **AND** rerendering the already-migrated configuration preserves those entries

### Requirement: Executor migration is atomic, bounded and repeatable

The chosen mechanism SHALL target only
`{release}-control-plane-executor` in the release namespace using the exact
target chart revision and ordered values layers. It SHALL ensure
`{release}-executor-jwt-config` exists with every required nonempty key and
data matching the ConfigMap from that same exact target render before any
dry-run or apply of the env step. The helper SHALL compare the data in-process
without printing payloads and SHALL fail before patch or rollout on missing,
empty or mismatched data, including when the env patch would be a no-op.
For both pre-#980 literal-env and existing #980 duplicate-env releases, the
operator SHALL pause only the executor Deployment before normal gated target
delivery. Delivery SHALL retain the pause. Target ConfigMap reconciliation
through the gated Helm adapter SHALL precede the atomic env step. While paused,
the step SHALL migrate or repair the env, including an accepted target template
with a missing JWT name. Rejected target delivery SHALL be retried while paused,
followed by another env verification/repair before resume. The procedure SHALL
provide executable, tested Helm and Argo paths using the real target chart and
exact ordered values, including handling of delivery rejection and the
ConfigMap prerequisite without bypassing existing gates. Synthetic probe-only
ConfigMap preparation SHALL NOT establish operator procedure coverage.
The executor SHALL resume only after target delivery succeeds, the ConfigMap
matches the target, and all five reference-only env entries are verified.
Removing an old literal value and adding its reference SHALL occur
in the same atomic operation. It SHALL preserve the executor Service and
ConfigMap and SHALL never use Helm `--force` for the whole release.

#### Scenario: Migration preserves JWT configuration and live object state

- **GIVEN** a serving old Deployment and an available target JWT ConfigMap
- **WHEN** the migration updates only the executor Deployment
- **THEN** no intermediate executor pod runs without JWKS URL, issuer or audience
- **AND** the effective TLS JWKS endpoint is preserved throughout preparation,
  migration and target delivery, not only in the final render
- **AND** live replicas and annotations managed by other actors are checked
  and preserved or explicitly reconciled by the tested step
- **AND** the Service and ConfigMap are not deleted

#### Scenario: Existing TLS ConfigMap has nonempty but stale data

- **GIVEN** an existing #980 TLS executor whose ConfigMap has all five nonempty
  keys but whose stored JWKS URL differs from the exact target render
- **WHEN** the helper is invoked with dry-run or apply, even on an already
  reference-only Deployment
- **THEN** it fails before patching the Deployment or waiting for rollout
- **AND** a fake-client negative test verifies that no mutation is attempted
- **AND** comparison results expose only status or hashes, never the data

#### Scenario: Gated target delivery is attempted while the executor is paused

- **GIVEN** a serving historical executor paused before target delivery
- **WHEN** gated Helm or Argo delivery accepts an incomplete executor template
  or rejects its env patch
- **THEN** the Deployment remains paused and no new executor ReplicaSet or pod
  is created from the incomplete template
- **AND** the documented real-chart procedure establishes matching target
  ConfigMap data, runs the helper dry-run and atomic apply, and retries rejected
  delivery while paused without bypassing migration, rollback or evidence gates
- **AND** after delivery the helper rechecks/repairs all five references before
  an explicit executor-only resume and successful rollout
- **AND** a missing or stale ConfigMap or lost pause prevents further repair or
  resume; a successful delivery status alone does not authorize resume

#### Scenario: Every new ReplicaSet retains valid JWT configuration

- **GIVEN** a serving historical Deployment and its existing ReplicaSets,
  captured before the documented positive migration sequence starts
- **WHEN** pause, gated target delivery, atomic repair, any delivery retry and
  verified resume run against a disposable live API server
- **THEN** the test examines every executor ReplicaSet template created during
  that sequence, including superseded ReplicaSets rather than just the latest
- **AND** it fails if any new template lacks JWKS URL, issuer or audience,
  duplicates a JWT env name, or has any env entry with both value and valueFrom
- **AND** templates created after the atomic step retain all five unique
  reference-only JWT entries and rollout reaches Available
- **AND** untreated negative-path experiments run separately and cannot waive
  a safety failure in the positive sequence as an accepted invalid outcome

#### Scenario: Migration is repeated on an already migrated release

- **GIVEN** a Deployment already using the target ConfigMap references and
  live ConfigMap data matching the exact target render
- **WHEN** the same migration is rerun
- **THEN** it is a no-op and retains valid env entries and availability

#### Scenario: HPA scales the executor during migration rollout

- **GIVEN** executor replicas owned by an HPA and a patch that does not touch
  spec.replicas
- **WHEN** the HPA changes the replica count while the helper waits for rollout
- **THEN** the helper tolerates that independently managed change or guidance
  documents the possible post-patch verification failure and bounded recovery
- **AND** it does not reset HPA-owned replicas or imply the env patch was reverted

### Requirement: Release guidance orders migration with existing audience gates

The deployment ChangeSet SHALL document the selected step, affected upgrade
paths, target render inputs, preconditions, verification and rollback in
the next unpublished chart version's release notes and in
`charts/in-falcone/docs/mongo-bearer-route-980-handoff.md`'s prod checklist.
It SHALL preserve published release notes/packages and existing migration,
backup, parity, immutable-image and External Secrets/OpenBao gates.
Guidance SHALL list Python 3 with PyYAML, Helm and kubectl as prerequisites
when using the Python helper. Release review SHALL confirm which unpublished
chart version ships #980 and align the release notes with that version.

#### Scenario: Operator prepares a production rollout

- **GIVEN** prod inherits tenant audience enforcement
- **WHEN** the operator follows the release notes and prod checklist
- **THEN** tenant-app and service-account audience reconciliation completes
  before enforcement, and real prod issuer/JWKS hosts are confirmed in the
  exact values layers before migrating the executor
- **AND** the checklist orders executor-only pause, gated target delivery,
  target ConfigMap verification, helper dry-run and atomic apply, any rejected
  delivery retry, and final reference verification/repair before explicit resume
- **AND** the Helm and Argo procedures are executable with the real target chart,
  retain the pause throughout delivery and repair, and never allow an invalid
  template to create executor pods even if delivery returns success
- **AND** verification checks availability, unique reference-only env entries,
  replicas and annotations without emitting ConfigMap or Secret payloads
- **AND** rollback covers reapplying the `433be51` executor Deployment render
  or retrying forward without deleting its Service or ConfigMap

#### Scenario: Release guidance explains TLS duplicate repair

- **GIVEN** the executor TLS literal is moved into its ConfigMap source
- **WHEN** the operator reads the unpublished release notes, TLS overlay
  guidance and prod checklist
- **THEN** they describe how the effective HTTPS endpoint is preserved and
  require its verification for the exact ordered values layers
- **AND** they do not claim ConfigMap values are unchanged when the repair
  changes the stored representation to preserve the effective env value
- **AND** release review explicitly acknowledges that stored representation
  change and the evidence preserving the effective executor configuration

#### Scenario: An inherited literal-env release is prepared for migration

- **GIVEN** a pre-#980 release that may not yet have the executor JWT ConfigMap
- **WHEN** the operator follows the release notes for a reused-values upgrade
- **THEN** guidance explains the tested inherited-values behavior and the exact
  reviewed target layers required to reach all five ConfigMap references
- **AND** the executor is paused before gated target delivery establishes the
  target ConfigMap with every required key and matching data
- **AND** guidance covers a rejected first delivery while retaining the pause
  and never claims the helper can repair env before its ConfigMap prerequisite
  is satisfied or that a probe-only preparation is an executable operator step

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
