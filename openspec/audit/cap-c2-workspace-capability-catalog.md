# Capability C2 — Workspace Capability Catalog

**Source locus identified by reading code:**
- Handler: `services/provisioning-orchestrator/src/actions/workspace-capability-catalog.mjs` (98 LOC).
- Snippet/example builder: `services/workspace-docs-service/src/capability-catalog-builder.mjs` (101 LOC) — imported across service boundaries.
- Gateway routes: `services/gateway-config/routes/workspace-capability-catalog.yaml` (36 LOC).
- Persistence: migration `services/provisioning-orchestrator/src/migrations/090-workspace-capability-catalog.sql` (32 LOC) — creates a `capability_catalog_metadata` table with 6 seeded capabilities. The workspace catalog *action* does not actually query it.
- Repository for the separate `boolean_capability_catalog` table: `services/provisioning-orchestrator/src/repositories/boolean-capability-catalog-repository.mjs` (63 LOC). Used by `capability-catalog-list.mjs` (a different superadmin-only action), not by the workspace catalog action.
- Response contract: `services/internal-contracts/src/workspace-capability-catalog-response.json`.
- Audit event contract: `services/internal-contracts/src/workspace-capability-catalog-accessed-event.json`.
- Snippet data: `services/internal-contracts/src/snippet-catalog-data.json` (~28 KB of example code templates).
- Tests: `tests/unit/{workspace-capability-catalog-action,capability-catalog-builder}.test.mjs`, `tests/contracts/workspace-capability-catalog.contract.test.mjs`, `tests/integration/workspace-capability-catalog.integration.test.mjs`, plus `tests/integration/104-plan-boolean-capabilities/capability-catalog.test.mjs`.

**Method:** Read every file listed above end-to-end and traced imports. Did not consult `docs/`, the prior capability map, or `openspec/`.

Up-front observations:
- The capability map's "built from `services/openapi-sdk-service/src/capability-modules/*.paths.json` and `provisioning-orchestrator/src/collectors/`" is **wrong**. Inspection: the action does not import either. The capability list is supplied by an injected callback `fetchCapabilities`; the example snippets come from `services/internal-contracts/src/snippet-catalog-data.json` via the workspace-docs-service builder. The 8 files under `services/openapi-sdk-service/src/capability-modules/` are unrelated paths fragments for SDK generation.
- The default export `main = createWorkspaceCapabilityCatalogAction()` has no `fetchCapabilities` wired. Calling `main(...)` returns `undefined` from `fetchCapabilities?.(...)`, which is then `Array.isArray` checked and rejected as `WORKSPACE_NOT_FOUND` (404). The default factory is non-functional — see bug B1.

---

## SPEC (what exists)

### Surface

- **WHEN** a client issues `GET /v1/workspaces/{workspaceId}/capability-catalog` or `GET /v1/workspaces/{workspaceId}/capability-catalog/{capabilityId}`, **THE SYSTEM SHALL** route the request through APISIX to `provisioning-orchestrator` after applying the `keycloak-openid-connect`, `workspace-scope-enforcement`, `correlation-id` (header `X-Correlation-Id`), and `prometheus` plugins (`services/gateway-config/routes/workspace-capability-catalog.yaml:1-35`).

### Authentication / authorization

- **WHEN** the handler receives a request, **THE SYSTEM SHALL** read claims from `params.auth.claims` (or `params.auth`/`params.authorization`) and reject with `401 UNAUTHORIZED` if `claims.actorId`, `claims.tenantId`, or `claims.workspaceId` is missing (`workspace-capability-catalog.mjs:10-17`).
- **WHEN** the path `workspaceId` is absent or does not equal `claims.workspaceId`, **THE SYSTEM SHALL** return `403 FORBIDDEN` with code `FORBIDDEN` (`:19-21`).

### Data fetch

- **WHEN** authorization passes, **THE SYSTEM SHALL** call the injected `fetchCapabilities({ workspaceId, capabilityId, claims, params })` to obtain row-shaped capability records (`:24`).
- **WHEN** `fetchCapabilities` returns a non-array or an empty array, **THE SYSTEM SHALL** respond `404` with code `WORKSPACE_NOT_FOUND` (when `capabilityId` is null) or `CAPABILITY_NOT_FOUND` otherwise (`:26-28`).
- **WHEN** a `capabilityId` is requested but no returned row matches `row.capability_key` or `row.id`, **THE SYSTEM SHALL** respond `404 CAPABILITY_NOT_FOUND` (`:30-32`).

### Workspace context (used for snippet interpolation)

- **WHEN** building the response, **THE SYSTEM SHALL** assemble a `workspaceContext` of `{ workspaceId, tenantId, host, port, resourceNames{default,extraA,extraB}, endpoints{realtime} }`; if `params.host` / `params.port` / `params.resourceNames` / `params.endpoints` are missing, **THE SYSTEM SHALL** fall back to literal placeholder values such as `${workspaceId}.example.internal`, `443`, `${workspaceId}-primary`, `${workspaceId}-aux`, `https://functions.example.internal/api/v1/web/${workspaceId}/default/ping`, `wss://realtime.example.internal` (`workspace-capability-catalog.mjs:34-47`).

### Catalog assembly

- **WHEN** rows are present, **THE SYSTEM SHALL** delegate response construction to `buildCatalog(rows, workspaceContext)` from `services/workspace-docs-service/src/capability-catalog-builder.mjs:69-101` and return `{ workspaceId, tenantId, generatedAt, catalogVersion: '1.0.0', capabilities }` with HTTP 200 (`workspace-capability-catalog.mjs:49-77`).
- **WHEN** mapping each row, **THE SYSTEM SHALL** derive `id = row.capability_key ?? row.id`, `displayName = row.display_name ?? row.displayName`, `category`, `description`, `enabled = Boolean(row.enabled)`, `status = STATUS_MAP.get(row.status ?? row.capabilityStatus ?? (enabled ? 'active' : 'disabled')) ?? 'disabled'`, `version = row.catalog_version ?? row.version ?? '1.0.0'`, `quota = row.quota ?? undefined`, `dependencies = row.dependencies ?? []` (`capability-catalog-builder.mjs:69-89`).
- **WHEN** status normalization runs, **THE SYSTEM SHALL** map input `{enabled, active, disabled, provisioning, deprovisioning}` to the canonical `{active, disabled, provisioning, deprovisioning}`; unmapped inputs **SHALL** silently degrade to `disabled` (`capability-catalog-builder.mjs:3-9, 74`).
- **WHEN** a capability is `enabled === true`, **THE SYSTEM SHALL** populate up to 4 example snippets filtered from `snippet-catalog-data.json` by `serviceKey === id`, interpolating `{HOST}`, `{PORT}`, `{WORKSPACE_ID}`, `{RESOURCE_NAME}`, `{RESOURCE_EXTRA_A}`, `{RESOURCE_EXTRA_B}`, `{REALTIME_ENDPOINT}` using the workspace context (`capability-catalog-builder.mjs:21-36, 51-67`).
- **WHEN** a capability is `enabled === false`, **THE SYSTEM SHALL** emit an empty `examples` array and set `enablementGuide` to a hard-coded sentence keyed by capability id (Spanish-localised label fallback for unknown ids) (`capability-catalog-builder.mjs:38-48, 91-93`).
- **WHEN** a matching snippet entry carries `dependencyNote`, **THE SYSTEM SHALL** copy that note onto the capability output (`capability-catalog-builder.mjs:76, 95-97`).

### Response contract enforcement (declared, not runtime-validated by handler)

- **WHEN** the response is consumed by a downstream that validates against `workspace-capability-catalog-response.json`, the payload **SHALL** carry `{workspaceId, tenantId, generatedAt, catalogVersion, capabilities[]}` with `capabilities.minItems: 1`, where each capability's `status ∈ {active, disabled, provisioning, deprovisioning}` and the `enabled === true / enabled === false` branches of the `oneOf` constrain `examples.minItems: 1` / `maxItems: 0` respectively (`workspace-capability-catalog-response.json:1-88`).

### Audit emission

- **WHEN** a successful 200 is returned, **THE SYSTEM SHALL** fire-and-forget call `emitAuditEvent(auditEvent)` with `{ eventType: 'workspace.capability-catalog.accessed', workspaceId, tenantId, actorId, capabilityId, accessDate: timestamp.slice(0,10), correlationId, timestamp }` (`workspace-capability-catalog.mjs:59-72`).
- **WHEN** `emitAuditEvent` rejects, **THE SYSTEM SHALL** `logger.warn` once with payload `{ action, error.message }` and message `'audit-publish-failed'`; the request **SHALL** still return 200 (`:70-72`).
- **WHEN** the request supplies neither `params.correlationId` nor an `x-correlation-id` header, **THE SYSTEM SHALL** synthesise `correlationId = \`corr-${workspaceId}\`` (`:66`).

### Error path

- **WHEN** any of the steps above throws, **THE SYSTEM SHALL** `logger.error` with payload `{action, error.message}` and message `'workspace-capability-catalog-failed'`, then return `500 INTERNAL_ERROR` (`workspace-capability-catalog.mjs:78-81`).

### Sibling action (out-of-scope of the gateway route but co-located)

- **WHEN** `capability-catalog-list.mjs` is invoked, **THE SYSTEM SHALL** require `callerContext.actor.type === 'superadmin'`, query `boolean_capability_catalog` (NOT `capability_catalog_metadata`) via `listActiveCatalog` or `listAllCatalog`, and return `{capabilities: [{capabilityKey, displayLabel, description, platformDefault, isActive, sortOrder}], total}` (`capability-catalog-list.mjs:1-37`, `boolean-capability-catalog-repository.mjs:14-38`).

### Persistence (declared by migration 090; queried by nothing in the audited path)

- **WHEN** migration `090-workspace-capability-catalog.sql` runs, **THE SYSTEM SHALL** create `capability_catalog_metadata(id UUID PK, capability_key TEXT UNIQUE, display_name, category, description, catalog_version DEFAULT '1.0.0', dependencies JSONB DEFAULT '[]', common_operations JSONB DEFAULT '[]', timestamps)` and seed six rows: `postgres-database, mongo-collection, kafka-events, realtime-subscription (deps: [\"kafka-events\"]), serverless-function, storage-bucket` (`090-workspace-capability-catalog.sql:1-32`).

---

## GAPS

1. **No production `fetchCapabilities` exists in this package.** `workspace-capability-catalog.mjs:97` instantiates `main = createWorkspaceCapabilityCatalogAction()` with no DI. Every test supplies a `fetchCapabilities` mock; no module in `services/provisioning-orchestrator/` provides a real implementation that reads `capability_catalog_metadata` or any other table. The default export is a stub.

2. **Migration 090 creates a table no code reads.** `capability_catalog_metadata` is seeded with six capabilities but the workspace catalog action takes its rows from the DI callback, not this table. The `boolean-capability-catalog-repository.mjs` queries a completely different table (`boolean_capability_catalog`, created by migration 104 — not visible in this audit's reads but referenced by name in the SQL). Two coexisting "capability catalog" tables, neither of which is the data source for the workspace catalog endpoint.

3. **Cross-service relative imports.** `workspace-capability-catalog.mjs:1` reaches into a sibling service via `../../../workspace-docs-service/src/capability-catalog-builder.mjs`. `capability-catalog-builder.mjs:1` reaches into `../../internal-contracts/src/snippet-catalog-data.json`. Neither is exposed through `services/internal-contracts/src/index.mjs`. Refactoring either sibling moves the file path and silently breaks the catalog endpoint.

4. **Default-export factory has no runtime audit emitter.** `workspace-capability-catalog.mjs:5` defaults `emitAuditEvent = async () => {}`. The default `main` therefore emits no Kafka event. There is no module that wires a real emitter; tests pass mocks. Production audit emission is absent.

5. **Workspace context defaults are placeholder hostnames.** `workspace-capability-catalog.mjs:37-46`: `host` defaults to `${workspaceId}.example.internal`, `endpoints.realtime` defaults to `wss://realtime.example.internal`, etc. If the calling layer (gateway / OpenWhisk wrapper) does not supply `params.host`, `params.port`, `params.resourceNames`, `params.endpoints`, the produced snippets contain literal `.example.internal` hostnames. Customers would see this if exposed unchanged. No code in this package supplies real values.

6. **`{WORKSPACE_ID}` interpolation token is defined but unused.** `capability-catalog-builder.mjs:25` adds `{WORKSPACE_ID}` to the replacements map; sampling `snippet-catalog-data.json` shows the templates use `{HOST}, {PORT}, {RESOURCE_NAME}, {RESOURCE_EXTRA_A}`, never `{WORKSPACE_ID}`. Dead path — or, conversely, an unused contract that downstream snippets may rely on (unchecked).

7. **Hard-coded enablement-guide labels duplicate the schema's capability set.** `capability-catalog-builder.mjs:39-48` enumerates the six capability keys in a `labels` map; the SQL seed at `090-…sql:23-30` lists the same six. Migration 090 and the builder are coupled implicitly: adding a seventh capability requires changes in both places with no validator linking them. The builder also falls back to `capabilityKey` itself in the guide string (`:48`), which is the unhuman id (`storage-bucket`).

8. **`STATUS_MAP` silently degrades unknown statuses to `'disabled'`.** `capability-catalog-builder.mjs:74` — `STATUS_MAP.get(...) ?? 'disabled'`. A typo or new lifecycle state (e.g., `pending`) silently becomes `disabled`, which then triggers the `enabled === false` schema branch and adds the enablement guide. No log, no error.

9. **`status='provisioning'` with `enabled=true` violates the response schema.** `workspace-capability-catalog-response.json:60-86`: `oneOf` requires `examples.minItems: 1` when `enabled: true`. A provisioning capability with `enabled=true` but no snippet entries (e.g., a new capability without snippets seeded) yields `examples: []` and fails schema validation. The handler itself never validates the response, but downstream consumers will reject it. The unit test `tests/integration/104-plan-boolean-capabilities/capability-catalog.test.mjs:35-42` exercises a `provisioning` capability while keeping `enabled=true` and never asserts schema compliance.

10. **Empty `examples` for an enabled capability also violates the schema.** Same root cause: if `snippet-catalog-data.json` is missing entries for `serviceKey === id`, `buildExamples` returns `[]` (`capability-catalog-builder.mjs:51-67`). Schema requires ≥1. No guard.

11. **Spanish-language snippet descriptions in a contract path.** `snippet-catalog-data.json:7, 17, 25, 33, 43, 51` uses `"secretPlaceholderRef": "Usa la credencial del usuario de base de datos mostrada en la consola del workspace."`. These strings are surfaced through the contract response and are not localisable; no i18n mechanism. (Whether intentional or accidental, the contract has no locale field.)

12. **`accessDate` is UTC-based and not annotated.** `workspace-capability-catalog.mjs:65` slices `timestamp.slice(0, 10)`. A user in UTC-8 calling at 23:00 local will get a date one day ahead. Audit consumers correlating "actor's day" will be off.

13. **Auto-generated `correlationId` is non-unique per request.** `workspace-capability-catalog.mjs:66` falls back to `\`corr-${workspaceId}\``. Every request without a header from the same workspace shares the same correlation id → all audit events look like one ongoing flow. Hard to debug, breaks correlation-based observability.

14. **Audit emission is fire-and-forget and has no DLQ.** `:70-72` chains `.catch()` that only warns. A persistent Kafka outage silently drops every access event.

15. **No HTTP method validation in the handler.** The gateway route allows only GET, but the handler itself never checks `params.httpMethod`. If invoked via a non-gateway path with non-GET semantics, it still responds with 200 + side effects.

16. **No quota / rate-limit on the endpoint.** The route declares no `limit-count` plugin. Each request reads from `fetchCapabilities`, runs the builder, and fires audit. Abuse-trivial.

17. **No test asserts the action audits the canonical event shape.** Unit test in `tests/unit/workspace-capability-catalog-action.test.mjs:114-132` confirms only that a Kafka-publish failure does not fail the request. It does not assert the emitted payload validates against `workspace-capability-catalog-accessed-event.json`. The contract test in `tests/contracts/workspace-capability-catalog.contract.test.mjs:69-71` validates a fixture, not the actual emitted event.

18. **`fetchCapabilities`'s expected row shape is not documented.** The handler accepts `row.capability_key ?? row.id`, `row.display_name ?? row.displayName`, `row.catalog_version ?? row.version`, etc. — implicit dual schemas. Future implementers can produce drift between snake_case and camelCase rows.

19. **No isolation: the action trusts the entire `params` object.** `params.host`, `params.port`, `params.resourceNames`, `params.endpoints` come straight from the caller (the OpenWhisk wrapper). If the wrapper passes user-supplied fields, an attacker can inject arbitrary hostnames into the example snippets returned to other tenants. Not visible here — depends on what the OpenWhisk wrapper passes — but the handler has no allow-list.

20. **`capability-catalog-list.mjs` queries a different table than the workspace catalog.** Both actions are surfaced under "capability catalog" in the system, but `capability-catalog-list` returns rows from `boolean_capability_catalog` (boolean flags for plan capabilities). The workspace catalog action returns user-facing per-workspace capabilities. The names overlap; operators and consumers will conflate them.

---

## BUGS

### Confirmed

- **B1. The default `main` export is non-functional.**
  `services/provisioning-orchestrator/src/actions/workspace-capability-catalog.mjs:97` constructs `main = createWorkspaceCapabilityCatalogAction()` with no `fetchCapabilities`. The handler at `:24` calls `await fetchCapabilities?.({...})`; `?.()` returns `undefined`; `:26` checks `!Array.isArray(rows) || rows.length === 0` and returns `404 WORKSPACE_NOT_FOUND`. Every call to the default `main` returns 404 regardless of authentication state. The endpoint is wired to the gateway but the gateway can only ever return 404 unless some out-of-package wrapper rebuilds the action with a real `fetchCapabilities`. No such wrapper is present.

- **B2. Auto-generated `correlationId` is the same for every request without a header.**
  `workspace-capability-catalog.mjs:66` — `\`corr-${workspaceId}\``. Every audit event from the same workspace shares this id. The audit event schema (`workspace-capability-catalog-accessed-event.json:19`) requires `correlationId: minLength: 1` but does not require uniqueness; this is a logic bug, not a schema rejection. Confirmed by inspection.

- **B3. Schema requires examples.minItems: 1 for enabled capabilities, but the builder can return zero.**
  `workspace-capability-catalog-response.json:65-71` requires `examples.minItems: 1` when `enabled === true`. `capability-catalog-builder.mjs:51-67` returns `[]` if no `snippet-catalog-data.json` entry matches `serviceKey === id`. Concretely: if a new capability key is added to `capability_catalog_metadata` (or whatever real source `fetchCapabilities` reads) but no snippet entries are added to `snippet-catalog-data.json`, the response will fail schema validation — but the handler does not validate, so the failure surfaces only at downstream consumers. Confirmed code path.

- **B4. Schema's `enabled === true` branch requires at-least-one example; `status='provisioning'` capabilities with `enabled=true` and not-yet-seeded snippets will violate the contract.**
  Same root cause as B3, but specifically triggered by the lifecycle state surfaced in `tests/integration/104-plan-boolean-capabilities/capability-catalog.test.mjs:33-37`. The test re-shapes one row to `{status: 'provisioning'}` while keeping `enabled: true`. If a deployment ever provisions a capability that has no snippets yet (entirely possible for a new capability mid-rollout), the response is schema-noncompliant.

- **B5. `_migration` / cross-service import.**
  `workspace-capability-catalog.mjs:1` — `import { buildCatalog } from '../../../workspace-docs-service/src/capability-catalog-builder.mjs';`. This bypasses any package-level export boundary. Renaming `workspace-docs-service/src/capability-catalog-builder.mjs` breaks the catalog without touching the provisioning-orchestrator package. Confirmed by reading the import.

- **B6. Default `emitAuditEvent` is a no-op, and nothing wires a real one.**
  `workspace-capability-catalog.mjs:5` — `emitAuditEvent = async () => {}`. `main` at `:97` uses defaults. No producer is wired in the package. Therefore the audit contract `workspace-capability-catalog-accessed-event.json` is never emitted in production unless the OpenWhisk wrapper supplies one — and no code or config in this audit's read-set does. Confirmed absent.

- **B7. Migration 090 seeds a table that is queried by no audited code path.**
  `090-workspace-capability-catalog.sql:16-30` seeds six rows; the workspace catalog action takes its rows from a DI callback that no real implementation provides; the boolean catalog action queries a different table; no other action in `services/provisioning-orchestrator/src/actions/` references `capability_catalog_metadata`. Confirmed dead-data.

### Likely

- **B8. `STATUS_MAP` silent-degrades unknown statuses to `disabled`.**
  `capability-catalog-builder.mjs:74`. A new lifecycle state (e.g., `pending_activation`) would be mapped to `disabled` with no warning, and the capability would then carry an enablement guide — misleading the operator about which capabilities are truly off.

- **B9. Workspace context defaults leak `.example.internal` hostnames into customer-facing snippets.**
  `workspace-capability-catalog.mjs:37-46`. If the OpenWhisk wrapper omits `params.host` / `params.endpoints` (no contract requires it), customers see snippets pointing at `${workspaceId}.example.internal` and `wss://realtime.example.internal`. Likely-to-occur the first time a deployment forgets to inject real values.

- **B10. `accessDate` is UTC-derived from the server clock, no timezone column.**
  `workspace-capability-catalog.mjs:65`. Audit aggregation by "day" will be skewed for non-UTC viewers.

- **B11. `errorResponse` is called inside a `try/catch` that returns 200 in the audit-warn path.**
  `:70-72` chains a `.catch()` on the audit promise but the surrounding `return` at `:74-77` has already issued 200. If the audit emitter throws synchronously (not async), the `.catch()` is never installed because there is no Promise (the call inside `emitAuditEvent(auditEvent)` is `await`-less). Worth verifying: the default `emitAuditEvent` is async, so this works for the default; but a user-supplied sync throwing emitter would propagate to the outer `try/catch` at `:78`, yielding a `500` for a successful catalog build.

- **B12. `params.headers?.['x-correlation-id']` lookup is case-sensitive.**
  `:66`. HTTP headers are case-insensitive; depending on the gateway's case-normalisation, this access may miss `X-Correlation-Id` / `X-CORRELATION-ID`. The route plugin at `services/gateway-config/routes/workspace-capability-catalog.yaml:11-12` configures `header_name: X-Correlation-Id`. Likely mismatch — the gateway might forward as `X-Correlation-Id` rather than `x-correlation-id`.

- **B13. `fetchCapabilities?.()` is called with `params`, leaking the entire request blob (including `params.auth`, `params.headers`) to whatever the implementation does.**
  `:24` passes `{ workspaceId, capabilityId, claims, params }`. If a real `fetchCapabilities` logs its argument for debugging, secrets in the auth claims would land in logs.

- **B14. The handler trusts `params.resourceNames.extraB` to be a URL but the default uses `https://functions.example.internal/api/v1/web/...` — no validation.**
  `:42` and `capability-catalog-builder.mjs:28`. A malicious caller (the OpenWhisk wrapper) supplying `params.resourceNames.extraB = "javascript:alert(0)"` would land that string inside example snippets returned to the client. Out of band of normal flow but no defence.

- **B15. The Spanish-language `secretPlaceholderRef` strings are present in a contract whose schema has no `locale` field.**
  `snippet-catalog-data.json:7,17,25,…` vs. `workspace-capability-catalog-response.json` (no `locale`). Consumers cannot localise. Likely incidental but worth flagging.

### Needs verification

- **B16. `boolean-capability-catalog-repository.listAllCatalog({ includeInactive: false })` is identical to `listActiveCatalog()`.**
  `boolean-capability-catalog-repository.mjs:24-38` — the `includeInactive: false` branch runs the same `WHERE is_active = true` query as `listActiveCatalog`. Not directly a bug for the workspace catalog action, but the redundant branch suggests `listAllCatalog({})` (default false) accidentally calls a path equivalent to `listActiveCatalog`. Verify whether `capability-catalog-list.mjs:14-17` ever passes `includeInactive=false` from the default-branch path.

- **B17. The gateway route declares `workspace-scope-enforcement` plugin without listing the required scope.**
  `services/gateway-config/routes/workspace-capability-catalog.yaml:9-10` — plugin enabled but no `required_scopes` config. The plugin's default behaviour (without explicit scopes) is unclear from this file. Verify by reading the plugin's Lua source.

- **B18. The contract test validates fixtures, not handler output.**
  `tests/contracts/workspace-capability-catalog.contract.test.mjs:13-89` builds a fixture by calling `buildCatalog` on hand-crafted rows and validates it. The actual `main` handler is never exercised against the schema. Verify that no other test invokes `main` and validates the response against `workspace-capability-catalog-response.json`.

---

## Scope note for downstream spec authoring

C2 as described in the capability map is essentially a façade with no operational backing in this repository. Before writing OpenSpec FRs:

1. Decide where the *real* `fetchCapabilities` lives — either implement it inside `provisioning-orchestrator` reading `capability_catalog_metadata` (or whichever table is canonical) and join with per-workspace enablement state, or delete the action and migration 090 as scaffolding.
2. Reconcile the two coexisting tables (`capability_catalog_metadata` vs. `boolean_capability_catalog`). The former is unused; the latter drives plan capability sets. The capability map should clarify which one feeds the workspace catalog.
3. Move `capability-catalog-builder.mjs` to a shared location (`services/internal-contracts/` or a new `@falcone/catalog` package) so the cross-service relative import goes away.
4. Wire a real audit emitter; today the event contract is enforced only by a contract-test fixture, not the runtime.
5. Patch the `correlationId` fallback (B2) before the audit emitter is wired, otherwise every event will collapse onto a per-workspace constant.
