# Research Notes: BaaS Internal Service Map and Contracts

## Decision summary

Use four explicit internal layers for the bootstrap baseline:

1. `control_api` for public REST handling and internal command translation
2. `provisioning_orchestrator` for idempotent workflow coordination
3. `audit_module` for append-only evidence capture
4. `services/adapters` for provider-facing ports and future provider clients

A separate `services/internal-contracts` package will hold the machine-readable service map and shared contract catalog so later tasks can consume one canonical source without importing provider/runtime code.

## Why this split now

- The public API and provider integrations will evolve at different speeds.
- Provisioning is the only place that should sequence multi-provider side effects.
- Audit evidence needs its own boundary so it is not reduced to incidental logging.
- A contract-first package allows later tasks to add queues, persistence, SDKs, or workers without re-defining the boundary map.

## Chosen contract baseline

### Control API command envelope

The control API must emit a versioned internal command envelope that carries:

- `command_id`
- `request_id`
- `tenant_id`
- `actor`
- `command_name`
- `payload`
- `idempotency_key`
- `contract_version`
- `requested_at`

This keeps non-read operations traceable and replay-safe.

### Provisioning request/result envelopes

The orchestrator must treat provisioning as a named run keyed by a stable idempotency key. Result envelopes should distinguish:

- accepted/in progress
- succeeded
- failed
- partially applied / recovery required

That allows later tasks to add retries and recovery logic without changing the baseline semantics.

### Adapter call/result envelopes

All provider ports should share one call/result pattern so that future provider integrations do not invent incompatible retry semantics. The baseline must distinguish at least:

- success
- retryable dependency failure
- terminal dependency failure

### Audit record envelope

Audit is modeled as append-only evidence, not debug logging. The baseline record must include:

- actor
- scope
- action
- outcome
- correlation identifiers
- timestamp
- evidence pointer metadata

## Rejected alternatives

### Rejected: control API talks directly to provider adapters

Rejected because it would mix public contract handling with multi-provider orchestration and create tight coupling between routes and providers.

### Rejected: one monolithic service with comments about future separation

Rejected because comments are not executable boundaries and would not give later tasks stable package seams or validator coverage.

### Rejected: audit handled as unstructured log lines

Rejected because audit evidence needs explicit fields, append-only semantics, and a reusable contract surface for later compliance/reporting tasks.

## Deferred to sibling tasks

This task intentionally does not choose:

- queue/runtime technology for orchestration
- persistence implementation for provisioning runs
- actual provider SDK/client libraries
- database tables or object schemas
- retry/backoff algorithms beyond baseline classifications
- deployment/runtime topology

## Practical extension rules

- Add new internal contracts in `services/internal-contracts/src/internal-service-map.json` first.
- Extend consumers through boundary helper modules rather than importing unrelated service internals.
- Keep provider-specific configuration and SDK choices inside `services/adapters` when implementation begins.
- Preserve append-only audit semantics even if later tasks add query/export capabilities.
