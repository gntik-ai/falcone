# Quickstart: Review and Extend the Internal Service Map

Use this package when you need to understand or extend the baseline control-plane architecture established by `US-ARC-01-T01`.

## Key files

1. `specs/us-arc-01-t01/spec.md` — feature intent and acceptance criteria
2. `specs/us-arc-01-t01/plan.md` — executable implementation plan and validation strategy
3. `specs/us-arc-01-t01/service-map.md` — human-readable boundary and dependency notes
4. `docs/adr/0003-control-plane-service-map.md` — architecture decision record
5. `services/internal-contracts/src/internal-service-map.json` — machine-readable source of truth for service boundaries and contract envelopes
6. `services/internal-contracts/src/index.mjs` — helper accessors for the source-of-truth package
7. `apps/control-plane/src/internal-service-map.mjs` — control-plane-specific view of the shared service map
8. `services/provisioning-orchestrator/src/contract-boundary.mjs` — orchestrator-specific contract view
9. `services/audit/src/contract-boundary.mjs` — audit-specific contract view
10. `services/adapters/src/provider-catalog.mjs` — adapter catalog view for provider ports

## Validate the package

Run from the repository root:

```bash
corepack pnpm validate:service-map
node --test tests/unit/service-map.test.mjs
node --test tests/adapters/provider-catalog.test.mjs
node --test tests/contracts/internal-service-map.contract.test.mjs
```

## Extend safely

1. Update `services/internal-contracts/src/internal-service-map.json` first.
2. Keep provider additions behind adapter ports instead of adding direct control-plane dependencies.
3. Add new boundary helper exports in the consuming workspace rather than importing unrelated internal modules.
4. Preserve `idempotency_key` on non-read control/provisioning flows.
5. Preserve append-only `audit_record` semantics even if future tasks add storage/query details.

## Explicitly deferred

This task does not implement runtime handlers, queues, databases, or provider SDK clients. Later tasks should extend the current package and helper modules instead of replacing them.
