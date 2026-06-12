## ADDED Requirements

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
