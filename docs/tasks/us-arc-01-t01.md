# US-ARC-01-T01 Task Breakdown

## Specify summary

Define the internal BaaS service map for the control API, provisioning orchestrator, provider adapters, and audit module. Keep the increment focused on architecture boundaries, internal contracts, and what/why rather than runtime implementation.

## Executable plan

1. Capture the feature specification and implementation plan under `specs/us-arc-01-t01/`.
2. Record the control-plane service split and dependency rules in an ADR.
3. Add a machine-readable internal service-map and contract catalog.
4. Add minimal monorepo scaffolding for internal-contracts, provisioning-orchestrator, audit, control-plane boundary access, and adapter catalog access.
5. Add a lightweight root validator plus unit/adapter/contract tests.
6. Run repository validation commands and record results.

## Concrete implementation tasks

- [x] Add `specs/us-arc-01-t01/spec.md`, `plan.md`, `research.md`, `service-map.md`, `quickstart.md`, and `tasks.md`.
- [x] Add `docs/adr/0003-control-plane-service-map.md`.
- [x] Add `services/internal-contracts/` with the machine-readable service map and helper exports.
- [x] Add `services/provisioning-orchestrator/` and `services/audit/` scaffolding plus boundary helpers.
- [x] Add `apps/control-plane/src/internal-service-map.mjs` and `services/adapters/src/provider-catalog.mjs`.
- [x] Add `scripts/lib/service-map.mjs`, `scripts/validate-service-map.mjs`, and new tests.
- [x] Update root scripts, structure validation, workspace docs, and lockfile metadata.
- [x] Run repository validation commands.
