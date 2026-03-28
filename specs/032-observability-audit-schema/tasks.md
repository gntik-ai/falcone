# Tasks: US-OBS-02-T02 — Canonical Audit Event Schema

**Input**: `specs/032-observability-audit-schema/spec.md`
**Feature Branch**: `032-observability-audit-schema`
**Task**: `US-OBS-02-T02`

---

## Phase 1 — Spec artifacts

- [x] T001 Materialize `specs/032-observability-audit-schema/spec.md` with the bounded audit-event-schema specification covering the canonical envelope, scope rules, vocabularies, edge cases, and explicit T02 boundaries versus T03–T06.
- [x] T002 Materialize `specs/032-observability-audit-schema/plan.md` with the contract structure, artifact mapping, validation strategy, implementation sequence, and done criteria.
- [x] T003 Materialize `specs/032-observability-audit-schema/tasks.md` and keep it aligned with the bounded audit-event-schema delta.

## Phase 2 — Contract and validation helper implementation

- [x] T004 Add `services/internal-contracts/src/observability-audit-event-schema.json` with `version: "2026-03-28"`, `scope: "US-OBS-02-T02"`, source references to the audit-pipeline and authorization-model contracts, the canonical required top-level field inventory, and structured sections for `event_identity`, `actor`, `scope_envelope`, `resource`, `action`, `result`, `origin`, `detail_extension`, and `governance`.
- [x] T005 Update `services/internal-contracts/src/index.mjs` to export `OBSERVABILITY_AUDIT_EVENT_SCHEMA_URL`, `OBSERVABILITY_AUDIT_EVENT_SCHEMA_VERSION`, `readObservabilityAuditEventSchema()`, `getAuditEventRequiredFields()`, `getAuditActorSchema()`, `getAuditScopeEnvelope()`, `getAuditResourceSchema()`, `getAuditActionSchema()`, `getAuditResultSchema()`, and `getAuditOriginSchema()` following the existing reader/accessor pattern.
- [x] T006 Add `scripts/lib/observability-audit-event-schema.mjs` exporting `readObservabilityAuditEventSchema()` and `collectAuditEventSchemaViolations(contract, auditPipeline, authorizationModel)` which returns `[]` for a valid contract and specific, actionable violation strings for structural failures such as missing required fields, source-version mismatches, missing actor requirements, missing `correlation_id`, or action-category drift from `US-OBS-02-T01`.
- [x] T007 Add `scripts/validate-observability-audit-event-schema.mjs` as the CLI entry point that loads the new schema contract and upstream contracts, runs `collectAuditEventSchemaViolations`, prints each violation, and exits non-zero on failure.
- [x] T008 Update `package.json` scripts to expose `validate:observability-audit-event-schema` and wire it into `validate:repo`.

## Phase 3 — Documentation and discoverability

- [x] T009 Add `docs/reference/architecture/observability-audit-event-schema.md` narrating the canonical event envelope, required versus conditional fields, normalized vocabularies, scope rules, and the explicit T02 boundary relative to T03–T06.
- [x] T010 Update `docs/reference/architecture/README.md` with entries for the new machine-readable audit-event-schema contract and human-readable architecture guide so the baseline is discoverable.
- [x] T011 Add or update `docs/tasks/us-obs-02.md` with a `## Scope delivered in 'US-OBS-02-T02'` section summarizing the canonical audit-event-schema baseline and downstream dependency note for T03–T06.

## Phase 4 — Tests and verification

- [x] T012 Add `tests/unit/observability-audit-event-schema.test.mjs` with unit assertions covering `collectAuditEventSchemaViolations` determinism: valid contract returns `[]`; removing a required top-level field returns a violation naming it; removing `actor_id` returns a violation; removing `correlation_id` returns a violation; `source_audit_pipeline_contract` mismatch returns a violation; omitting a required T01 action category returns a violation.
- [x] T013 Add `tests/contracts/observability-audit-event-schema.contract.test.mjs` with contract-reader assertions: `readObservabilityAuditEventSchema()` resolves; `OBSERVABILITY_AUDIT_EVENT_SCHEMA_VERSION` equals the contract `version` field; `getAuditEventRequiredFields()`, `getAuditActorSchema()`, `getAuditScopeEnvelope()`, `getAuditResourceSchema()`, `getAuditActionSchema()`, `getAuditResultSchema()`, and `getAuditOriginSchema()` return the expected sections; docs and package wiring expose the new baseline.
- [x] T014 Run `npm run validate:observability-audit-event-schema` and confirm it exits zero.
- [x] T015 Run targeted observability unit and contract tests to confirm no regressions.
- [x] T016 Run `npm run lint:md` on the touched documentation/spec set.

## Phase 5 — Delivery

- [x] T017 Inspect the final diff to confirm the increment stayed within the audit-event-schema contract, reader/accessor wiring, validation helper, documentation, and tests — and did not add query APIs, export formats, masking execution, correlation workflows, runtime emitters, Kafka/storage implementation, or UI behavior.
- [ ] T018 Commit the branch with a focused message for `US-OBS-02-T02`.
- [ ] T019 Push `032-observability-audit-schema` to `origin`.
- [ ] T020 Open a PR from `032-observability-audit-schema` to `main`.
- [ ] T021 Monitor CI, fix deterministic failures, and update the branch until checks are green.
- [ ] T022 Merge the PR to `main` once green.
- [ ] T023 Update the orchestrator state files with the completed unit (`US-OBS-02-T02`) and next pending backlog item (`US-OBS-02-T03`).
