## 1. Spike Environment Setup

- [ ] 1.1 Confirm `temporal server start-dev` is launchable on Node 22 Linux (via `npx @temporalio/testing` or standalone binary) and document the exact start command in `spikes/add-flows-adr-temporal-spikes/README`
- [ ] 1.2 Confirm whether `tests/env` Postgres can host the Temporal SQL schema for Spike B visibility sub-experiment; document result (reuse vs separate service)
- [ ] 1.3 Create `spikes/add-flows-adr-temporal-spikes/` directory with a header comment marking it as ephemeral spike code, not for production paths

## 2. Spike A — DSL Interpreter Prototype

- [ ] 2.1 Scaffold a minimal TypeScript worker (`spikes/add-flows-adr-temporal-spikes/spike-a/`) with `@temporalio/worker`, `@temporalio/workflow`, and `@temporalio/activity` as devDependencies
- [ ] 2.2 Define a 3-node YAML flow schema (start → branch → retry-task → end) and write a sample fixture file
- [ ] 2.3 Implement the interpreter workflow function that parses the YAML definition received as workflow input and executes nodes in order, evaluating branch conditions via the chosen expression engine
- [ ] 2.4 Prototype CEL evaluation (`cel-js`) inside the Temporal workflow V8 sandbox; record whether it passes the sandbox restrictions
- [ ] 2.5 Prototype JSONata evaluation inside the Temporal workflow V8 sandbox; record whether it passes the sandbox restrictions
- [ ] 2.6 Document expression engine comparison (determinism, bundle size, embedding complexity) and select one; update ADR field
- [ ] 2.7 Implement the worker-kill resume test: start the flow, kill the worker process mid-execution, restart the worker, assert the execution completes with expected final state (capture history export or test output as evidence)
- [ ] 2.8 Implement the retry policy test: configure a task with retry policy, trigger a failure, assert Temporal retries according to policy across a worker restart
- [ ] 2.9 Validate the definition-passing strategy: confirm the full YAML definition is present in workflow history and replay is deterministic
- [ ] 2.10 Record Spike A evidence (history export or test run output) in `spikes/add-flows-adr-temporal-spikes/spike-a/evidence/`

## 3. Spike B — Tenancy Model Prototype

- [ ] 3.1 Scaffold the Spike B workspace (`spikes/add-flows-adr-temporal-spikes/spike-b/`) with TypeScript SDK dependencies
- [ ] 3.2 Implement the namespace-per-tenant prototype: provision N namespaces programmatically, start one worker per namespace, and instrument poller count and gRPC connection count
- [ ] 3.3 Implement the shared-namespace prototype: start a single worker pool, tag workflows with a `tenantId` custom search attribute, and verify visibility queries return only the correct tenant's runs
- [ ] 3.4 Run measurements at N = {1, 5, 20} tenants for both models; record poller count and gRPC connection count in `spikes/add-flows-adr-temporal-spikes/spike-b/measurements.md`
- [ ] 3.5 Validate PostgreSQL SQL visibility with custom search attributes: run a `tenantId`-filtered visibility query against the Postgres-backed visibility store and assert no cross-tenant runs appear
- [ ] 3.6 Produce the comparison table (isolation, poller count, connection count, operational complexity) in `spikes/add-flows-adr-temporal-spikes/spike-b/comparison-table.md`
- [ ] 3.7 Select the tenancy model based on spike evidence; update ADR field

## 4. ADR Authoring

- [ ] 4.1 Draft the ADR entry following the existing numbered format in `docs-site/architecture/adrs.md` with all seven required fields: rationale, SDK choice + code evidence, tenancy model (from 3.7), definition-passing strategy (from 2.9), expression engine (from 2.6), visibility store decision (from 3.5), and internal/operator-only UI stance
- [ ] 4.2 Verify the ADR cites at minimum two code-level evidence points for the TypeScript SDK choice (`apps/control-plane/Dockerfile` FROM node:22 and `apps/control-plane/package.json` `"type":"module"`)
- [ ] 4.3 Append the completed ADR to `docs-site/architecture/adrs.md`

## 5. Verification

- [ ] 5.1 Confirm Spike A worker-kill resume test passes and evidence file is present
- [ ] 5.2 Confirm Spike B comparison table and measurements file are present with data at N = {1, 5, 20}
- [ ] 5.3 Confirm ADR contains all seven required fields and is appended to `docs-site/architecture/adrs.md`
- [ ] 5.4 Confirm no spike code has been imported from `apps/`, `services/`, or `charts/`
