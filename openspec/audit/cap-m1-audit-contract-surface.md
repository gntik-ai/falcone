# Capability M1 — Audit Contract Surface

**Source locus:**
- `services/audit/` — **4 files, ~52 LOC of `.mjs`**:
  - `package.json` (10 LOC) — placeholder lint/test/typecheck scripts.
  - `src/README.md` (18 LOC).
  - `src/contract-boundary.mjs` (43 LOC) — re-exports + one inlined event shape.
  - `src/authorization-context.mjs` (9 LOC) — pure re-exports.
- `services/internal-contracts/src/` JSON schemas referenced by the capability:
  - `observability-audit-event-schema.json` (186 LOC) — canonical envelope contract.
  - `observability-audit-pipeline.json` (303 LOC) — pipeline topology + delivery guarantees + masking.
  - `observability-audit-query-surface.json` — query routes + pagination + sort.
  - `observability-audit-export-surface.json` — export contract (not read).
  - `observability-audit-correlation-surface.json` — correlation contract (not read).
  - `authorization-model.json` — authorization contract upstream.
  - 8 lifecycle-event schemas: `operation-{cancel,retry,timeout,recovery}-event.json`, `failure-classified-event.json`, `manual-intervention-required-event.json`, `intervention-notification-event.json`, `retry-override-event.json`.

**Method.** Read every file in `services/audit/` end-to-end. Read the canonical event-schema (`observability-audit-event-schema.json`) and pipeline (`observability-audit-pipeline.json`) JSON files in full. Spot-checked `observability-audit-query-surface.json`, `operation-cancel-event.json`, `failure-classified-event.json`. Verified consumers by grep: `services/audit/src/contract-boundary.mjs` is imported only by `tests/contracts/internal-service-map.contract.test.mjs` and `scripts/validate-structure.mjs` — both are **repo-structure validators**, not runtime consumers.

**Headline finding up front:** **M1 is contract scaffolding with no runtime.** `services/audit/` exposes 9 re-exported contract handles + 1 inlined event shape and has no functions for emit, persist, query, or export. The README admits this directly: "Future tasks should extend this package for query/export behavior". The canonical event-schema (`observability-audit-event-schema.json`) declares a 10-field envelope (`event_id, event_timestamp, actor, scope, resource, action, result, correlation_id, origin, detail`) — but the one event shape actually defined inline in `contract-boundary.mjs` (the `capabilityEnforcementDeniedEvent`) does not follow this envelope. The pipeline contract (`observability-audit-pipeline.json`) declares Kafka topics, delivery guarantees, freshness thresholds, masking rules, and health signals — none of which is implemented in this package or wired up to producers elsewhere. Other audits in this session (D1, F3, J1, K1, L1) all found local audit emitters that build event objects and call Kafka producers ad-hoc; **none of those producers reference `services/audit/` or conform to the canonical schema declared here.**

---

## SPEC (what exists)

### S1. Package scaffolding

- **WHEN** `pnpm lint`/`pnpm test`/`pnpm typecheck` runs in `services/audit/`, **THE SYSTEM SHALL** print a placeholder string and exit 0 (`package.json:7-9` — three `node -e "console.log('… placeholder')"` scripts).

### S2. Contract-boundary re-exports (`src/contract-boundary.mjs`)

- **WHEN** the module is imported, **THE SYSTEM SHALL** expose:
  - `auditModuleBoundary = getService('audit_module')` (`:8`).
  - `auditRecordContract = getContract('audit_record')` (`:9`).
  - `iamLifecycleEventContract = getContract('iam_lifecycle_event')` (`:10`).
  - `mongoAdminEventContract = getContract('mongo_admin_event')` (`:11`).
  - `kafkaAdminEventContract = getContract('kafka_admin_event')` (`:12`).
  - `auditPersistenceAdapters = listAdapterPortsForConsumer('audit_module')` (`:13`).

- **WHEN** the module is imported, **THE SYSTEM SHALL** expose `capabilityEnforcementDeniedEvent`, a plain JS object — *not* a JSON Schema — declaring `{eventType: 'capability_enforcement_denied', category: 'security', fields: {…}}` with 14 fields (`eventType, tenantId, workspaceId, actorId, actorType (enum: user|service_account), capability, reason (enum: plan_restriction|override_restriction|plan_unresolvable), channel (enum: gateway|console|internal_api), resourcePath, httpMethod, requestId, correlationId, sourceIp, occurredAt`) (`:24-43`).

### S3. Authorization-context re-exports (`src/authorization-context.mjs`)

- **WHEN** the module is imported, **THE SYSTEM SHALL** expose:
  - `auditAuthorizationDecisionContract = getAuthorizationContract('authorization_decision')` (`:7`).
  - `auditContextProjection = getContextPropagationTarget('audit_record')` (`:8`).
  - `auditRelevantNegativeAuthorizationScenarios = listNegativeAuthorizationScenarios()` (returns all, no filter) (`:9`).

### S4. Canonical event envelope (`observability-audit-event-schema.json`)

- **WHEN** an audit consumer reads the event-schema contract, **THE SYSTEM SHALL** require the following top-level fields: `event_id, event_timestamp, actor, scope, resource, action, result, correlation_id, origin, detail` (`:7-18`).
- **WHEN** events are produced, **THE SYSTEM SHALL** carry a `schema_version` matching `contract.version` (currently `'2026-03-28'`) (`:2, :30-33`).
- **WHEN** the actor field is populated, **THE SYSTEM SHALL** include `actor_id` and `actor_type` ∈ `{platform_user, tenant_user, workspace_user, service_account, system, provider_adapter}` (`:35-54`).
- **WHEN** the scope envelope is populated, **THE SYSTEM SHALL** match one of three modes: `tenant` (requires `tenant_id`), `tenant_workspace` (requires `tenant_id` + `workspace_id`), `platform` (no required fields); platform events MUST NOT fabricate tenant/workspace ids (`:55-80`).
- **WHEN** the resource field is populated, **THE SYSTEM SHALL** include `subsystem_id` (one of 8 declared subsystems) + `resource_type`, conditionally including `resource_id` (`:81-104`).
- **WHEN** the action field is populated, **THE SYSTEM SHALL** include `action_id` + `category` ∈ `{resource_creation, resource_deletion, configuration_change, access_control_modification, privilege_escalation, quota_adjustment}` (`:105-123`).
- **WHEN** the result field is populated, **THE SYSTEM SHALL** include `outcome` ∈ `{succeeded, failed, denied, partial, accepted}` (`:124-141`).
- **WHEN** the origin field is populated, **THE SYSTEM SHALL** include `origin_surface` ∈ `{control_api, console_backend, internal_reconciler, provider_adapter, bootstrap_job, scheduled_operation}` + `emitting_service` (`:142-160`).
- **WHEN** producers add subsystem-specific data, **THE SYSTEM SHALL** place it in `detail`; canonical envelope fields MUST NOT be redefined inside `detail` (`:161-172`).
- **WHEN** the contract evolves, **THE SYSTEM SHALL** keep changes additive; required field names stable; category vocabulary kept aligned with the pipeline roster (`:173-185`).

### S5. Canonical pipeline (`observability-audit-pipeline.json`)

- **WHEN** any of 8 subsystems emits events (`iam, postgresql, mongodb, kafka, openwhisk, storage, quota_metering, tenant_control_plane`), **THE SYSTEM SHALL** target Kafka as the transport backbone with topology `subsystem_emitter → kafka_audit_transport → durable_audit_store` (`:13-145, :146-152`).
- **WHEN** events are routed, **THE SYSTEM SHALL** use topic `audit.<tenant_id>` for tenant-scoped events and `audit.platform` for platform-scoped or unattributed events (`:154-158`).
- **WHEN** partitioning is applied, **THE SYSTEM SHALL** partition by `tenant_id` (tenant) or `'platform'` (platform); workspace attribution is metadata only (`:159-163`).
- **WHEN** events flow within a tenant partition, **THE SYSTEM SHALL** preserve emission-order; cross-partition ordering is not guaranteed (`:164-167`).
- **WHEN** transport is degraded, **THE SYSTEM SHALL** apply back-pressure and retry, surface the `transport_degraded` signal, never silently drop (`:169-179`).
- **WHEN** delivery semantics are evaluated, **THE SYSTEM SHALL** be at-least-once with idempotent-consumer responsibility (`:170-173`).
- **WHEN** tenant isolation is enforced, **THE SYSTEM SHALL** require `tenant_id`; missing-tenant routes to `audit.platform` as unattributed; cross-tenant leakage is a security incident (`:182-193`).
- **WHEN** subsystem freshness is measured, **THE SYSTEM SHALL** apply per-subsystem thresholds — 120s for `tenant_control_plane`, 180s for `{kafka, openwhisk, quota_metering}`, 300s for `{iam, postgresql, mongodb, storage}` (`:29, :45, :61, :77, :93, :109, :125, :142`).
- **WHEN** health is reported, **THE SYSTEM SHALL** emit three metrics: `in_falcone_audit_emission_freshness_seconds`, `in_falcone_audit_transport_health`, `in_falcone_audit_storage_health` with labels `{environment, subsystem, metric_scope, collection_mode}` and status vocabulary `{healthy, degraded, unavailable, unknown, stale}` (`:194-248, :286-301`).
- **WHEN** events are persisted/exposed, **THE SYSTEM SHALL** redact `{password, secret, token, authorization_header, connection_string, raw_hostname, raw_endpoint, object_key, raw_topic_name}` (`:272-282`).
- **WHEN** routing/partitioning is computed, **THE SYSTEM SHALL** never depend on sensitive payload fields (`:283-284`).
- **WHEN** pipeline configuration changes, **THE SYSTEM SHALL** emit audit events through the same pipeline (self-audit; restricted to `superadmin`) (`:258-269`).

### S6. Query surface (`observability-audit-query-surface.json`)

- **WHEN** the public API exposes audit-record queries, **THE SYSTEM SHALL** offer two scopes: `tenant` (op id `listTenantAuditRecords`, permission `tenant.audit.read`) and `workspace` (op id `listWorkspaceAuditRecords`, permission `workspace.audit.read`) with cursor pagination (`page[size]`, `page[after]`, default 25, max 200) and sort by `eventTimestamp` (asc/desc) (`:9-58`).

### S7. Other declared surfaces (not read in detail)

- `observability-audit-export-surface.json` declares an export contract.
- `observability-audit-correlation-surface.json` declares a cross-system correlation contract.
- 8 lifecycle-event schemas (`operation-{cancel,retry,timeout,recovery}`, `failure-classified`, `manual-intervention-required`, `intervention-notification`, `retry-override`) are real JSON Schemas with `$id`, `additionalProperties: false`, and required-field arrays — consumed by the provisioning-orchestrator C1 capability and re-exported from `services/internal-contracts/src/index.mjs`. **None of them is imported by `services/audit/`.**

---

## GAPS

### G-cross. Cross-cutting

1. **`services/audit/` has no runtime.** No emit function, no persist function, no query handler, no Kafka producer wiring. Only re-exports and one inlined event shape. The README admits it: "Future tasks should extend this package for query/export behavior".
2. **No consumer in the repo.** `grep -rln "services/audit/src/contract-boundary"` finds only `tests/contracts/internal-service-map.contract.test.mjs` and `scripts/validate-structure.mjs` (both repo-structure validators). No production code imports `auditRecordContract` / `iamLifecycleEventContract` / `mongoAdminEventContract` / `kafkaAdminEventContract` to validate or shape events.
3. **`package.json` placeholders.** Same anti-pattern as D1/E1/F1/H1. Lint/test/typecheck all `node -e "console.log(... placeholder)"`.
4. **The 8 lifecycle event schemas are real JSON Schemas; the `capabilityEnforcementDeniedEvent` is a plain JS object.** Inconsistent representation; the inline event is not validatable.
5. **No version stamping in `services/audit/`.** The canonical schema carries `version: '2026-03-28'`; the contract-boundary module re-exports getter results that may resolve to whatever version the registry returns. No assertion of which version this package expects.
6. **No code anywhere in this repo emits events conforming to the canonical envelope** (`event_id, event_timestamp, actor, scope, resource, action, result, correlation_id, origin, detail`). Per other audits this session:
   - D1's PostgreSQL governance/admin events use `audit_record` with `evidence_pointer, operation, actor` shape.
   - F3 webhook audit events use `{tenantId, workspaceId, actorId, action, resourceId, timestamp}`.
   - H1 OpenWhisk emits `mongo.admin.{kind}.accepted` with `outcome` + `streamDelivery`.
   - I1 scheduling emits `{tenantId, workspaceId, actorId, action, resourceId, timestamp, metadata}`.
   - K1 workspace-docs emits `{eventType, workspaceId, tenantId, actorId, accessDate, correlationId}`.
   - L1 backup-status emits `'backup.*' / 'restore.*'` typed records.
   None of these match the canonical envelope: snake_case vs camelCase mismatch, no `scope` block, no `resource` block, no `action.category`, no `origin.origin_surface`, no `origin.emitting_service`. The canonical contract is aspirational.
7. **Topic naming convention `audit.<tenant_id>` is not used by any emitter found in audits.** D1 uses `console.audit.gateway`, F3 uses `console.webhook.subscription.*`, K1 uses `console.audit`, L1 uses `platform.audit.events` and `platform.backup.collector.events`. **Five different topic-naming conventions across audits; none matches the pipeline contract.**
8. **Masking policy unenforced.** `observability-audit-pipeline.json:272-282` declares forbidden fields but no validator anywhere applies it. The L1 audit found a regex-based sanitiser in storage-error-taxonomy; that sanitiser doesn't reference this list.

### G-S2. Contract-boundary

- **G-S2.1** `capabilityEnforcementDeniedEvent.actorType` enum = `['user', 'service_account']` (`contract-boundary.mjs:32`), but the canonical schema's `actor.actor_types` declares 6 values (`observability-audit-event-schema.json:45-52`). Drift.
- **G-S2.2** `capabilityEnforcementDeniedEvent` is a flat dict — no `scope`/`resource`/`action`/`result`/`origin` blocks. Fails the canonical envelope. If anyone ever consumes it, they need adapter glue.
- **G-S2.3** The four `getContract(...)` calls (`audit_record`, `iam_lifecycle_event`, `mongo_admin_event`, `kafka_admin_event`) may return `undefined` if the contract registry doesn't declare them. **Verified by grep**: `grep -n "audit_record\|iam_lifecycle_event\|mongo_admin_event\|kafka_admin_event" services/internal-contracts/src/index.mjs` returned no matches in the lines I inspected. Whether these contracts exist in the registry needs verification (see B5).
- **G-S2.4** `auditPersistenceAdapters = listAdapterPortsForConsumer(AUDIT_MODULE_SERVICE_ID)` — returns whatever ports the registry attributes to `'audit_module'`. No call site consumes this list; whether the registry attributes any ports is unknown.

### G-S3. Authorization-context

- **G-S3.1** `listNegativeAuthorizationScenarios()` is re-exported as `auditRelevantNegativeAuthorizationScenarios` with no filter (`:9`). The variable name implies a filtered view ("audit-relevant"), but the function call returns *all* scenarios. Compare with `apps/control-plane/src/authorization-model.mjs:12-14` which filters scenarios `surface === 'control_api'`. Smell.

### G-S4. Canonical event envelope

- **G-S4.1** `schema_version` field is `required: true` (`observability-audit-event-schema.json:30-33`) but no JSON Schema enforces it — the document is a meta-contract, not a Schema validator.
- **G-S4.2** `detail_extension.forward_compatibility` (`:171`) promises future tasks "may classify, mask, export, or correlate detail fields". Those tasks are not implemented anywhere.
- **G-S4.3** `governance.future_work_boundaries` (`:174-178`) names four follow-up tasks (`us_obs_02_t03/t04/t05/t06`) for query, export, correlation, and end-to-end traceability tests. Three of these have declarative JSON files (query/export/correlation surfaces). None has runtime code.

### G-S5. Canonical pipeline

- **G-S5.1** No implementation. Every clause (Kafka transport, freshness metrics, masking, self-audit, back-pressure) is a contract assertion with no enforcing code.
- **G-S5.2** `self_audit.restricted_actors: ['superadmin']` (`:262`) — per the B1 capability audit, the `superadmin` realm role exists in the chart-driven Keycloak bootstrap but is checked as a *scope literal* in backup-status code (L1 B1) and event-gateway / control-plane audits.
- **G-S5.3** `health_signals` (`:194-248`) declares three required metrics. The L1 audit confirms backup-status emits to `'platform.backup.collector.events'` topic but does not surface freshness as a Prometheus metric.

### G-S6/S7. Query/Export/Correlation surfaces

- **G-S6.1** The two declared route operation ids (`listTenantAuditRecords`, `listWorkspaceAuditRecords`) are not declared in any OpenAPI family file I have audited (compare with the audit-map-driven C1 audit which enumerated public-route-catalog.json — no audit routes were listed there).
- **G-S6.2** L1 backup-status implements `query-audit.action.ts` but that's backup-scoped only and uses different field names (snake_case `event_type`, `result`, etc.) — not the canonical `eventTimestamp` from the query surface.
- **G-S7.1** Export and correlation surfaces (declared in `observability-audit-export-surface.json` and `observability-audit-correlation-surface.json`) have no implementation anywhere.

---

## BUGS

### Confirmed (verified-by-author from cited lines)

- **B1. `services/audit/` package has no runtime.** Verified by full read of the four files. No emit, persist, query, or export function. The package surface is 9 contract re-exports + 1 inlined event shape. The capability map describes M1 as the "Audit Contract Surface" — accurate, but the map's claim that the module "exposes" audit/iam/mongo/kafka events should be read as "declares the contract identifiers", not "implements a runtime".

- **B2. No production consumer.** `grep -rln "services/audit/src/contract-boundary"` returns only `tests/contracts/internal-service-map.contract.test.mjs` and `scripts/validate-structure.mjs`. The four contract handles re-exported are never consulted by any production audit emitter in the repo. Cross-referenced with D1, F3, H1, I1, K1, L1 audits: each builds its own audit event shape ad-hoc.

- **B3. `capabilityEnforcementDeniedEvent` shape diverges from the canonical envelope.**
  `services/audit/src/contract-boundary.mjs:24-43` (verified-by-author). The inline event has 14 flat fields. The canonical schema (`observability-audit-event-schema.json:7-18`) requires 10 envelope fields including `actor` (object), `scope` (object with mode discrimination), `resource` (object), `action` (object), `result` (object), `origin` (object). The inline event has no envelope nesting. A consumer of this event cannot route it through any infrastructure that depends on the canonical envelope.

- **B4. `capabilityEnforcementDeniedEvent.actorType` enum is incomplete.**
  Same file `:32` (verified-by-author): `enum: ['user', 'service_account']`. The canonical schema (`observability-audit-event-schema.json:45-52`) declares `{platform_user, tenant_user, workspace_user, service_account, system, provider_adapter}` — six values, none of which is `'user'`. **The inline event's enum is not a subset of the canonical enum.** A consumer mapping inline events to canonical shape has no rule for translating `'user'`.

- **B5. The four `getContract(...)` lookups are unverified.**
  `contract-boundary.mjs:9-12` (verified-by-author): calls `getContract('audit_record' | 'iam_lifecycle_event' | 'mongo_admin_event' | 'kafka_admin_event')`. My grep of `services/internal-contracts/src/index.mjs` for those four contract ids returned no matches in the inspected lines. If the contracts are not declared in the registry, `getContract(...)` returns `undefined` and all four `*Contract` exports are `undefined` — but consumers (only the two structure validators) never inspect their content, so the defect is invisible.

- **B6. `auditRelevantNegativeAuthorizationScenarios` does not filter to audit-relevant scenarios.**
  `services/audit/src/authorization-context.mjs:9` (verified-by-author): `listNegativeAuthorizationScenarios()` with no filter. The variable name promises a filter that the implementation doesn't provide. Compare with `apps/control-plane/src/authorization-model.mjs:12-14` which does filter (`scenario.surface === 'control_api'`).

- **B7. Topic-naming convention is not honoured by any audit emitter in the repo.**
  `observability-audit-pipeline.json:154-158` declares `audit.<tenant_id>` and `audit.platform`. Cross-referenced with audited emitters:
  - L1 backup-status: `'platform.audit.events'`, `'platform.backup.collector.events'`.
  - F3 webhook-engine: `'console.webhook.subscription.*'`.
  - K1 workspace-docs: `'console.audit'`.
  - D1 gateway: `'console.audit.gateway'`.
  - H1 OpenWhisk: `'mongo.admin'`.
  Five different conventions; none matches the contract. (Verified by reading the cited line ranges of each capability's audit.)

- **B8. Masking-policy forbidden-field list is unenforced.**
  `observability-audit-pipeline.json:272-282` enumerates 9 forbidden fields. No code anywhere references this list. The L1 audit found a per-service regex sanitiser in `storage-error-taxonomy.mjs` (which uses a different list). The forbidden-field list is therefore advisory only.

- **B9. Self-audit assertion `restricted_actors: ['superadmin']` cannot be enforced.**
  `observability-audit-pipeline.json:258-269` (verified-by-author). Per the B1 capability audit, the Keycloak bootstrap path does create a `superadmin` realm role, but L1 audit B1 found backup-status checks `superadmin` as a scope literal rather than a realm role — the check is dead. Without a working `superadmin` check at the action layer, the self-audit restriction in the contract cannot be enforced.

### Likely (smells, drift, declared-but-unimplemented surfaces)

- **B10. `observability-audit-pipeline.json` and `observability-audit-event-schema.json` share `version: '2026-03-28'`, but the inline event in `contract-boundary.mjs` carries no version.** A future contract bump can break consumers silently.

- **B11. `observability-audit-query-surface.json` declares two route operation ids (`listTenantAuditRecords`, `listWorkspaceAuditRecords`) that are not present in any OpenAPI family file audited so far.** Whether they exist in the unified spec at all needs verification — but if they exist without runtime, they're documentation-only.

- **B12. `observability-audit-export-surface.json` and `observability-audit-correlation-surface.json` are referenced by name in the audit-map but were not read in this audit.** Likely declarative-only, given the package surface.

- **B13. `schema_version` in canonical envelope (`:30-33`) is `required: true` but no validator (AJV or otherwise) enforces it in the repo.** Producers can omit it without observable error.

- **B14. `governance.future_work_boundaries` declares four follow-up tasks** (`us_obs_02_t03/t04/t05/t06`) for query, export, correlation, and traceability tests. Two are partially scaffolded (query/export-surface JSONs). Correlation and traceability tests have no traces in source.

- **B15. Subsystem-roster freshness thresholds (`:29, :45, :61, :77, :93, :109, :125, :142`) are documented but no emitter or collector enforces them.** A subsystem that goes silent for 600 s (twice the strictest threshold of 300 s) produces no `stale`/`degraded` signal because no one is watching.

- **B16. Per-subsystem `optional_event_categories` include categories like `authentication_flow_change`, `client_credential_rotation`, `topic_policy_change`, `trigger_binding_change`, `bucket_policy_change`** — most of which have no producer in the repo. The contract assertions are aspirational.

### Needs verification

- **B17. Whether `audit_record`, `iam_lifecycle_event`, `mongo_admin_event`, `kafka_admin_event` are declared contracts in `services/internal-contracts/src/index.mjs`.** Grep of the inspected lines returned no matches. If absent, `getContract(...)` resolves to `undefined`, and the four re-exports in `contract-boundary.mjs` are dead.

- **B18. Whether `listTenantAuditRecords`/`listWorkspaceAuditRecords` operation ids appear in `apps/control-plane/openapi/control-plane.openapi.json`.** If declared, they're routes-with-no-handler (same pattern as F1's `/v1/events/subscribe`). If absent, the query-surface contract is doc-only.

- **B19. Whether the `audit.<tenant_id>` topic-naming convention is implemented anywhere outside source** (e.g., in chart-templated Kafka topic creation). If not, B7 is fully confirmed.

- **B20. Whether the L1 backup-audit query surface (`query-audit.action.ts`) implements a subset of the canonical query-surface contract.** The audit-map's L1 entry and the L2 UI audit found a backup-specific query route; whether it's the start of a broader pattern or a one-off needs reading.

- **B21. Whether any service in the repo emits `'capability_enforcement_denied'` events** (the only inline event in `contract-boundary.mjs`). `grep -r "capability_enforcement_denied"` was not run; if no emitter exists, the event is a doc-only shape.

---

## Scope note for downstream spec authoring

M1 is a contract layer with five disconnected pieces:

1. **`services/audit/`** — re-export façade (no runtime, no consumer).
2. **`observability-audit-{event-schema, pipeline, query-surface, export-surface, correlation-surface}.json`** — canonical contracts, none enforced anywhere.
3. **Inline `capabilityEnforcementDeniedEvent`** — divergent from canonical envelope.
4. **8 lifecycle event JSON Schemas** — real schemas, but consumed by C1 provisioning-orchestrator's saga code (per C1 audit), not by `services/audit/`.
5. **Producers in 6+ other capabilities (D1, F3, H1, I1, K1, L1)** that emit ad-hoc audit shapes with their own topic conventions, none matching the canonical contract.

Before any OpenSpec proposal:

1. **Decide whether the canonical envelope is the source of truth.** If yes, every producer audited so far (D1, F3, H1, I1, K1, L1) needs a rewrite to emit the 10-field envelope with `actor/scope/resource/action/result/origin/detail` nesting. If no, the canonical contract should be deleted or marked superseded.

2. **If the canonical envelope is canonical, build a shared `emitAuditEvent` library that:**
   - Validates against the schema.
   - Routes to `audit.<tenant_id>` / `audit.platform`.
   - Enforces the masking policy.
   - Surfaces freshness/transport/storage health metrics.
   - Is the *only* path producers use.

3. **Reconcile or remove `capabilityEnforcementDeniedEvent`.** Either translate it into the canonical envelope or move it to a per-capability event catalogue.

4. **Resolve B5/B17 first.** If the four contracts referenced by `getContract(...)` don't exist in the registry, the entire `contract-boundary.mjs` façade is dead — and the README's "future tasks" are a long road.

5. **Wire the query/export/correlation surfaces** or mark them not-yet-implemented in OpenSpec.

Until at least one consumer of `services/audit/` exists in production code, M1 cannot be specified as a working capability — only as a contract intent.
