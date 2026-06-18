# Tasks — add-audit-write-and-scope-enforcement-store

## Reproduce (test-first)
- [x] Add a failing black-box / live probe that reproduces: Live: created users/workspaces then queried audit → 0 entries; scope-enforcement audit → 500 (missing table). (`tests/blackbox/audit-write-and-scope-enforcement.test.mjs` — failed against the empty `auditRecords()` and the absent writer modules.)

## Implement (kind runtime AND shippable product)
- [x] Deploy/wire an audit writer + the `scope_enforcement_denials` store so actions and denials are recorded with correlation ids — kind + product.
  - Kind audit store: `deploy/kind/control-plane/audit-store.mjs` (`recordAuditEvent` / `queryAuditEvents` over `plan_audit_events`, tenant+workspace scoped, carrying `correlation_id`).
  - Kind dispatch writer: `deploy/kind/control-plane/audit-writer.mjs` (`auditEventForRoute` / `recordRouteAudit` for mutating local actions; `recordScopeDenial` into `scope_enforcement_denials`), hooked in `deploy/kind/control-plane/server.mjs` after local-handler dispatch with the request `correlationId`.
  - Kind audit read: `deploy/kind/control-plane/metrics-handlers.mjs::auditRecords` now reads the store (was hardcoded empty), own-tenant guarded.
  - Kind denial ingest: `deploy/kind/control-plane/b-handlers.mjs::recordScopeEnforcementDenial` + route `POST /v1/internal/scope-enforcement/denials` (sidecar for the gateway scope-enforcement plugin).
- [x] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.
  - Product writer already present and reused as the SQL contract: `services/provisioning-orchestrator/src/repositories/scope-enforcement-repo.mjs` (`insertDenial` / `queryDenials`) + `scope-enforcement-event-recorder.mjs`. Product `apps/control-plane/src/observability-audit-query.mjs` is a pure shaper (injectable loader); the kind `auditRowToRecord` mirrors its `normalizeAuditRecord` shape for parity.

## Verify
- [x] Black-box suite green; the live 2-tenant probe now passes. (822/822, incl. 6 new `bbx-audit-write-*`.)
- [x] Acceptance: An action appears in audit-records with its correlation id. (`bbx-audit-write-01/03/04`); a scope-enforcement denial is recorded and returned by the audit query with no 500 (`bbx-audit-write-05/06`).

## Archive
- [x] `openspec validate add-audit-write-and-scope-enforcement-store --strict`; `/opsx:archive add-audit-write-and-scope-enforcement-store` after merge. (validate run; archive batched by the orchestrator.)
