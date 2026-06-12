# workflows Specification

## Purpose
TBD - created by archiving change add-flows-adr-temporal-spikes. Update Purpose after archive.
## Requirements
### Requirement: ADR for Temporal adoption is recorded
The system SHALL have a recorded architecture decision (ADR) for the Temporal-based workflow engine appended to `docs-site/architecture/adrs.md`, capturing: adoption rationale, TypeScript SDK selection with code evidence, chosen tenancy model, definition-passing strategy, chosen expression engine, PostgreSQL SQL visibility decision, and internal/operator-only UI stance.

#### Scenario: ADR exists with required decision fields
- **WHEN** a reviewer inspects `docs-site/architecture/adrs.md`
- **THEN** an ADR entry SHALL be present that includes all seven required decision fields: rationale, SDK choice with Node 22 ESM evidence, tenancy model, definition-passing strategy, expression engine, visibility store decision, and UI access stance

#### Scenario: SDK choice is grounded in code evidence
- **WHEN** the ADR states the TypeScript SDK is chosen
- **THEN** the ADR SHALL cite at minimum two code-level evidence points (Dockerfile FROM node:22 and `"type":"module"` in `apps/control-plane/package.json`) confirming no non-Node backend language is present in `apps/` or `services/`

### Requirement: Spike A demonstrates durable interpreter resume after worker kill
The system SHALL have a Spike A prototype proving that a Temporal TypeScript SDK worker executing a 3-node YAML-defined flow (containing one branch and one task with a retry policy) resumes and completes correctly after the worker process is killed mid-execution.

#### Scenario: Worker killed mid-run resumes to completion
- **WHEN** a Spike A prototype worker is killed mid-execution of a 3-node branch+retry flow
- **THEN** restarting the worker SHALL cause Temporal to replay history and the execution SHALL complete with the expected final state and no lost activity results

#### Scenario: Branch evaluation is deterministic on replay
- **WHEN** the Spike A interpreter replays a workflow that has already evaluated a branch condition
- **THEN** the branch outcome SHALL be identical to the original evaluation and no side-effects SHALL be re-executed

#### Scenario: Retry policy is honoured across worker restarts
- **WHEN** a task within the Spike A flow is configured with a retry policy and the worker is restarted after a task failure
- **THEN** Temporal SHALL retry the task according to the configured policy and the retry count SHALL be preserved from workflow history

#### Scenario: Definition-passing strategy is validated
- **WHEN** Spike A prototypes passing the flow definition as workflow input
- **THEN** the prototype SHALL demonstrate that the definition is recorded in workflow history and the replay is deterministic regardless of which worker picks it up

### Requirement: Spike A records an expression engine decision
The system SHALL produce a documented comparison between CEL and JSONata as expression engines for branch evaluation within the Temporal workflow sandbox, and SHALL record a single chosen engine as the outcome of Spike A.

#### Scenario: Expression engine comparison is documented
- **WHEN** Spike A is complete
- **THEN** the spike output SHALL include a comparison of CEL and JSONata covering: determinism guarantees in a Temporal workflow, bundle size impact on the worker, and ease of embedding in a Node 22 ESM module

#### Scenario: A single expression engine is selected
- **WHEN** the Spike A expression engine comparison is reviewed
- **THEN** exactly one engine SHALL be designated as the chosen engine in the ADR decision field

### Requirement: Spike B produces an evidence-based tenancy model comparison
The system SHALL have a Spike B prototype that implements both namespace-per-tenant and shared-namespace-plus-search-attributes tenancy models against a local Temporal dev server, and SHALL produce a comparison table covering isolation strength, poller and connection count per N tenants, and operational complexity.

#### Scenario: Namespace-per-tenant model is prototyped and measured
- **WHEN** Spike B implements the namespace-per-tenant approach
- **THEN** the prototype SHALL measure poller count and gRPC connection count as a function of tenant count and SHALL document worker-fleet scaling implications

#### Scenario: Shared-namespace model is prototyped and measured
- **WHEN** Spike B implements the shared-namespace model with `tenantId` custom search attributes
- **THEN** the prototype SHALL verify that visibility queries filtered by `tenantId` return only the correct tenant's workflow runs and SHALL measure connection overhead relative to the namespace-per-tenant approach

#### Scenario: Comparison table is produced
- **WHEN** both Spike B tenancy models have been prototyped
- **THEN** a comparison table SHALL exist with rows for: isolation boundary, poller count per N tenants, gRPC connection count per N tenants, and operational complexity rating

#### Scenario: A single tenancy model is selected and recorded in the ADR
- **WHEN** the Spike B comparison is complete
- **THEN** exactly one tenancy model SHALL be designated as chosen in the ADR, with the spike measurement data cited as evidence

### Requirement: Spike B validates PostgreSQL SQL visibility with custom search attributes
The system SHALL verify during Spike B that Temporal's SQL-based visibility store on PostgreSQL with custom search attributes is sufficient for run-history filtering needs, establishing that an Elasticsearch dependency is not required.

#### Scenario: Custom search attribute filters return correct results on PostgreSQL
- **WHEN** a Spike B workflow is tagged with a `tenantId` custom search attribute and a visibility query filters on that attribute against the PostgreSQL visibility store
- **THEN** the query SHALL return only workflows belonging to the specified tenant and no cross-tenant workflow runs SHALL appear in the result set

#### Scenario: PostgreSQL visibility sufficiency is recorded
- **WHEN** Spike B completes the visibility store validation
- **THEN** the ADR SHALL state whether PostgreSQL SQL visibility is sufficient or whether Elasticsearch is required, citing the spike evidence

### Requirement: Temporal integrated behind condition flag
The system SHALL render the entire Temporal server deployment behind a single `temporal.enabled` flag in `charts/in-falcone/values.yaml` (default `false`), so that Temporal can be toggled independently of all other components. Temporal is rendered by first-class umbrella templates under `charts/in-falcone/templates/temporal/**` rather than a `component-wrapper` alias, because the shared `component-wrapper` sub-chart renders only one Deployment + one Service per alias and cannot express Temporal's four role Deployments, Web UI, two lifecycle Jobs, five Services, and NetworkPolicy; image references still flow through the shared `component-wrapper.normalizeRepository` helper so `global.imageRegistry` (Harbor) rewriting continues to apply.

#### Scenario: Temporal disabled by default
- **WHEN** `charts/in-falcone` is installed or upgraded with `temporal.enabled` absent or set to `false`
- **THEN** no Temporal-related Kubernetes resources (Deployments, Services, Jobs, NetworkPolicies) are created

#### Scenario: Temporal enabled explicitly
- **WHEN** `charts/in-falcone` is installed with `temporal.enabled=true`
- **THEN** Temporal frontend, history, matching, and worker role Services and Deployments are created within the release namespace

### Requirement: PostgreSQL persistence and SQL visibility
The system SHALL configure Temporal to use PostgreSQL for both its primary persistence store and its SQL-based visibility store, with no Elasticsearch dependency.

#### Scenario: Default persistence store
- **WHEN** `temporal.enabled=true` and no external persistence override is supplied
- **THEN** Temporal uses the platform PostgreSQL service (or a dedicated DB per `postgresql.dedicatedTenantImage` pattern) as its persistence backend with connection parameters drawn from chart values

#### Scenario: SQL visibility without Elasticsearch
- **WHEN** Temporal is deployed with `temporal.enabled=true`
- **THEN** Temporal visibility queries are served by the PostgreSQL visibility store and no Elasticsearch pod or Service is created

### Requirement: Schema setup and upgrade jobs
The system SHALL provide a Helm Job that runs `temporal-sql-tool` to create or upgrade the Temporal persistence schema and visibility schema before the Temporal server pods become ready.

#### Scenario: Schema job runs on fresh install
- **WHEN** `helm install` is executed with `temporal.enabled=true` against a fresh namespace
- **THEN** a Kubernetes Job using the `temporal-sql-tool` image runs to completion, creating the required Temporal DB schemas, before the Temporal frontend Deployment is Available

#### Scenario: Schema upgrade job runs on helm upgrade
- **WHEN** `helm upgrade` is executed against a release where Temporal is already enabled
- **THEN** a Kubernetes Job runs the schema upgrade command and completes before any Temporal pod restart

### Requirement: Bootstrap job registers namespaces and custom search attributes
The system SHALL provide a Helm Job that, after the Temporal server is ready, registers the default Temporal namespace and the custom search attributes `tenantId`, `workspaceId`, `flowId`, `flowVersion`, and `triggerType` (all of type `Keyword`) via the Temporal CLI or SDK.

#### Scenario: Namespace registration on install
- **WHEN** `helm install` completes with `temporal.enabled=true`
- **THEN** a bootstrap Job runs to completion and the default Temporal namespace exists and is queryable

#### Scenario: Custom search attributes registered
- **WHEN** the bootstrap Job completes successfully
- **THEN** the attributes `tenantId`, `workspaceId`, `flowId`, `flowVersion`, and `triggerType` are registered in Temporal and a query against workflow history using any of those attributes does not return an error

### Requirement: ClusterIP-only internal networking
The system SHALL create all Temporal component Services as type `ClusterIP` only; no Service of type `LoadBalancer` or `NodePort` SHALL be created, and no Ingress, APISIX route, or OpenShift Route SHALL expose any Temporal endpoint.

#### Scenario: No external exposure on install
- **WHEN** `helm template` or `helm install` is run with `temporal.enabled=true` and default values
- **THEN** `kubectl get svc -l app.kubernetes.io/component=temporal` returns only Services of type `ClusterIP` and `kubectl get ingress,routes.route.openshift.io` returns no Temporal entries

### Requirement: NetworkPolicy restricting Temporal inbound access
The system SHALL create a Kubernetes `NetworkPolicy` for Temporal pods that allows inbound connections only from pods labelled as the flow API service or the flow DSL interpreter worker; all other inbound traffic to Temporal frontend port 7233 SHALL be denied.

#### Scenario: Unauthorized pod cannot reach Temporal gRPC port
- **WHEN** a pod without the flow API or worker label attempts a TCP connection to the Temporal frontend Service on port 7233
- **THEN** the connection is blocked by the NetworkPolicy

#### Scenario: Flow worker pod reaches Temporal gRPC port
- **WHEN** a pod bearing the flow DSL interpreter worker label connects to the Temporal frontend Service on port 7233
- **THEN** the connection is permitted

### Requirement: Operator-only Web UI access via port-forward
The system SHALL deploy the Temporal Web UI but SHALL NOT expose it via any Service of type LoadBalancer/NodePort, Ingress, APISIX route, or OpenShift Route; operator access SHALL be achieved exclusively through `kubectl port-forward`.

#### Scenario: Web UI not reachable from public ingress
- **WHEN** an HTTP request is sent to the platform's public API gateway hostname for any Temporal Web UI path
- **THEN** the gateway returns a 404 or no route is matched (no Temporal UI backend is registered)

#### Scenario: Web UI reachable via port-forward
- **WHEN** an operator runs `kubectl port-forward svc/<release>-temporal-web 8080:8080`
- **THEN** the Temporal Web UI is accessible at `http://localhost:8080`

### Requirement: Non-root and OpenShift SCC-compatible security configuration
The system SHALL render all Temporal pod specs with `securityContext.runAsNonRoot: true` and `seccompProfile.type: RuntimeDefault`; `fsGroup` SHALL NOT be pinned to a fixed UID so that OpenShift's restricted-v2 SCC can inject the namespace-assigned GID, consistent with the pattern in `deploy/openshift/values-openshift.yaml` for `apisix`, `keycloak`, `postgresql`, `kafka`, `storage`, and `observability`.

#### Scenario: OpenShift overlay renders without fixed fsGroup
- **WHEN** `helm template` is run with `-f deploy/openshift/values-openshift.yaml` and `temporal.enabled=true`
- **THEN** no Temporal pod spec contains a `securityContext.fsGroup` with a non-null numeric value

#### Scenario: Non-root assertion present on all Temporal pods
- **WHEN** `helm template` renders Temporal pod specs
- **THEN** every Temporal pod spec contains `securityContext.runAsNonRoot: true` and `securityContext.seccompProfile.type: RuntimeDefault`

### Requirement: values.schema.json extended for temporal block
The system SHALL add a `temporal` property to the root object in `charts/in-falcone/values.schema.json` so that `helm lint` and `helm template` pass without errors when `temporal.*` values are supplied; the `temporal` property SHALL NOT be added to the root `required` array (Temporal is an optional component).

#### Scenario: Helm lint passes with temporal block present
- **WHEN** `helm lint charts/in-falcone` is run after the schema extension
- **THEN** the command exits 0 with no validation errors related to the `temporal` key

#### Scenario: Helm install succeeds without temporal block
- **WHEN** `helm template` is rendered without any `temporal.*` override
- **THEN** the render succeeds and no schema validation error is emitted for a missing `temporal` key

### Requirement: Resource sizing defaults for Temporal components
The system SHALL define default CPU and memory `requests`/`limits` for each Temporal role (frontend, history, matching, worker) in `charts/in-falcone/values.yaml`, sized appropriately for a development/sandbox environment.

#### Scenario: Default resource values are present and non-empty
- **WHEN** `helm template` renders Temporal Deployment manifests with default values
- **THEN** each Deployment's container spec contains non-empty `resources.requests.cpu`, `resources.requests.memory`, `resources.limits.cpu`, and `resources.limits.memory` fields

