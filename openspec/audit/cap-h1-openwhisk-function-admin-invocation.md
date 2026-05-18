# Capability H1 — OpenWhisk Function Admin & Invocation

**Source locus:**
- Adapter: `services/adapters/src/openwhisk-admin.mjs` — **1812 LOC, 75 KB.**
- Control-plane façades (four files, total ~870 LOC):
  - `apps/control-plane/src/functions-admin.mjs` (289 LOC) — re-exports + invocation envelope helpers.
  - `apps/control-plane/src/functions-audit.mjs` (164 LOC) — audit emission and audit-query scope enforcement.
  - `apps/control-plane/src/functions-import-export.mjs` (207 LOC) — bundle export/import + collision validation.
  - `apps/control-plane/src/console-backend-functions.mjs` (198 LOC) — console-backend workflow invocations via saga.
- Tests: `tests/adapters/openwhisk-admin.test.mjs`, `tests/e2e/console/console-backend-openwhisk.test.mjs`.
- OpenAPI fragment: `apps/control-plane/openapi/families/functions.openapi.json`.

**Method.** Read the four control-plane façades myself (each ≤300 LOC), delegated the 1812-LOC adapter to a single Explore agent. After it returned, **spot-verified the four most damaging claims** by direct reads of the cited line ranges. **One subagent claim — the "scope mismatch bypass" at lines 813-831 — was re-grounded and corrected: the variables used are the same, but a real fail-open exists when `context.workspaceId` is falsy. I describe it correctly below.**

**Up-front observations:**
- This adapter is a **pure compiler/validator**, like the other adapter capabilities. Functions exported are `validate*`, `build*`, `normalize*`, `resolve*` — no OpenWhisk REST/HTTP calls anywhere. The capability map's claim that this is a "Tenant-facing serverless surface backed by OpenWhisk, with deployment, invocation, triggers, secrets, and quota" is correct in scope but the *runtime that calls OpenWhisk is not in this repo*. `grep -rln "buildOpenWhiskAdminAdapterCall\|validateOpenWhiskAdminRequest"` returns only the adapter itself and tests — no consumer.
- The HTTP route `POST /v1/functions/{id}/invoke` declared in `apps/control-plane/openapi/families/functions.openapi.json` has **no handler in source**. `grep -rln "POST /v1/functions"` returns only the adapter, the gateway-config route table (which gates the path but does not specify an upstream), the OpenAPI fragments, migration files, the authorization model, a web-console test fixture, and `apps/control-plane/src/console-backend-functions.mjs` (which calls saga workflows, not OpenWhisk). The map's TODO "function package storage, code-build, and trigger registration concretely live in the repo was not traced" is confirmed unresolved.
- The adapter does **not** import `services/adapters/src/authorization-policy.mjs`. Same pattern as D1/E1/G1.
- Both `functions-admin.mjs:179` and `functions-audit.mjs` carry hard-coded contract-version fallbacks (`'2026-03-25'` and `'2026-03-27T00:00:00Z'` respectively) — same drift pattern as in D1/E1.

---

## SPEC (what exists)

### S1. Constants and supported resource model

- **WHEN** the adapter is imported, **THE SYSTEM SHALL** expose: `OPENWHISK_ACTION_SOURCE_KINDS = {inline_code, packaged_artifact, stored_reference, runtime_image}`, `OPENWHISK_SUPPORTED_ACTION_RUNTIMES` (`nodejs:20, python:3.11, php:8.2, go:1.22, java:21, container:image`), `OPENWHISK_SUPPORTED_TRIGGER_KINDS` (manual, event_topic, cron, http, kafka, storage), `OPENWHISK_ALLOWED_WEB_ACTION_VISIBILITY = {public, private}`, `OPENWHISK_CONSOLE_BACKEND_INITIATING_SURFACE`, `SUPPORTED_OPENWHISK_VERSION_RANGES` (subagent-reported `:17-33`).
- **WHEN** the façade is imported, **THE SYSTEM SHALL** expose `FUNCTION_SECRET_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,62}$/` and `SUPPORTED_WEB_ACTION_VISIBILITY_STATES` (`apps/control-plane/src/functions-admin.mjs:47-48`, verified-by-author).

### S2. Plan-tier resolution

- **WHEN** `derivePlanTier(planId)` runs, **THE SYSTEM SHALL** map by case-insensitive substring: `'enterprise' → enterprise`, `'growth' → growth`, otherwise `'starter'` (subagent-reported at `:186-195`).
- **WHEN** `resolveOpenWhiskAdminProfile(context)` runs, **THE SYSTEM SHALL** return `{namespaceStrategy, subjectProvisioning, deploymentProfileId, quotaGuardrails, minimumEnginePolicy, …Supported flags}` (subagent-reported at `:84-118`).
- **WHEN** `getOpenWhiskCompatibilitySummary(context)` runs (façade), **THE SYSTEM SHALL** report `{provider: 'openwhisk', contractVersion: functionAdminRequestContract?.version ?? '2026-03-25', namespaceStrategy, …, quotaSupport: {scopes: ['tenant','workspace'], dimensions: ['function_count','invocation_count','compute_time_ms','memory_mb'], routeIds: ['getFunctionTenantQuota','getFunctionWorkspaceQuota']}, supportedRuntimes, supportedVersions}` (`functions-admin.mjs:173-235`, verified-by-author).

### S3. Resource validation (compiler)

- **WHEN** action create/update is validated, **THE SYSTEM SHALL** check `runtime ∈ OPENWHISK_SUPPORTED_ACTION_RUNTIMES`, `entrypoint`, `sourceKind ∈ OPENWHISK_ACTION_SOURCE_KINDS`, `timeoutSeconds ≤ 900`, `memoryMb ≤ 2048` (subagent-reported `:636-676`).
- **WHEN** a trigger is validated, **THE SYSTEM SHALL** require `sourceType` (manual/event_topic/cron/http/kafka/storage), `scheduleExpression` for cron, `sourceRef` for event_topic/http (subagent-reported `:753-762`).
- **WHEN** a rule is validated, **THE SYSTEM SHALL** require a valid trigger+action pairing and `activationState ∈ {active, inactive}` (subagent-reported `:788-799`).
- **WHEN** a package is validated, **THE SYSTEM SHALL** check `visibility ∈ {private, workspace_shared}` and the namespace binding prefix `pkgctx:{namespaceName}` (subagent-reported `:26`).
- **WHEN** the namespace is derived, **THE SYSTEM SHALL** use `ia-{tenant}-{workspace}-{environment}` and reject user-supplied physical identifiers (subagent-reported `:68-78, 587-590`).
- **WHEN** an HTTP exposure is built, **THE SYSTEM SHALL** validate `authMode ∈ {workspace_token, signed_url, public_readonly}` and methods ⊆ `{GET, POST, PUT, PATCH, DELETE}`; defaults are `authMode='workspace_token'`, `methods=['POST']`, `path='/functions/{actionName}'`, `publicUrl='https://api.in-falcone.example/functions/{actionName}'` (verified-by-author at `:1001-1015`).
- **WHEN** a storage trigger is built, **THE SYSTEM SHALL** filter `eventTypes` against `OPENWHISK_ALLOWED_STORAGE_EVENT_TYPES` (subagent-reported `:1018-…`).
- **WHEN** a workspace secret is validated, **THE SYSTEM SHALL** require `secretName` matching `FUNCTION_SECRET_NAME_PATTERN`, require `secretValue` only for create/update, reject `secretValue` for non-mutating actions (verified-by-author at `:810-839`).

### S4. Invocation envelope (no actual invocation)

- **WHEN** `validateConsoleBackendInvocationRequest(request, context)` runs, **THE SYSTEM SHALL** require `tenantId, workspaceId, correlationId` and reject if mismatched against caller scope (subagent-reported `:1061-1096`).
- **WHEN** `buildConsoleBackendInvocationEnvelope(context, payload)` runs in the façade, **THE SYSTEM SHALL** require `responseMode`, require `triggerContext.kind === 'direct'`, require `tenantId` and `workspaceId`, run `validateConsoleBackendInvocationRequest`, and return `{identity, annotation, request}` (verified-by-author at `functions-admin.mjs:244-286`).
- **WHEN** `buildOpenWhiskInvocationRequest(payload, context)` is consulted (called from `dispatchWorkflowAction`), **THE SYSTEM SHALL** include `acceptedAt: new Date().toISOString()` (verified-by-author at `:1806-1809`).
- **WHEN** `dispatchWorkflowAction(namespace, actionRef, payload, annotation)` runs, **THE SYSTEM SHALL** return `{activationId: \`act_${workflowId|actionRef}_${idempotencyKey-slice12 or 'pending'}\`, namespace, actionRef, annotation: {initiating_surface: 'console_backend', workflowId, correlationId, tenantId, workspaceId}, request: buildOpenWhiskInvocationRequest(...)}` (verified-by-author at `:1792-1812`). **The function performs no OpenWhisk REST call.**

### S5. Activation, audit, rollback, quota

- **WHEN** an activation result is normalised, **THE SYSTEM SHALL** map `status ∈ {running, succeeded, failed, timed_out, cancelled}` and copy context annotation (subagent-reported `:1098-1112`).
- **WHEN** a rollback is validated, **THE SYSTEM SHALL** require `versionId`, reject `invalid`/`retired` targets, and emit an audit event with source+target version evidence (subagent-reported `:1672-1727`).
- **WHEN** `emitDeploymentAuditEvent`/`emitAdminActionAuditEvent`/`emitRollbackEvidenceEvent`/`emitQuotaEnforcementEvent` is called (façade), **THE SYSTEM SHALL** call `assertBaseContext(context)` requiring `actor`, `tenantId`, `workspaceId`, and publish to topic `'function.audit.events'` via `context.publishAuditEvent ?? defaultStub` (verified-by-author at `functions-audit.mjs:24-118`).
- **WHEN** an audit query is scoped, **THE SYSTEM SHALL** require `params.tenantId === context.tenantId` and `params.workspaceId === context.workspaceId`, throwing `SCOPE_VIOLATION` otherwise; **AND SHALL** clamp `limit ≤ 200`, throwing `LIMIT_EXCEEDED` (verified-by-author at `functions-audit.mjs:40-74`).
- **WHEN** an audit coverage report is built, **THE SYSTEM SHALL** require `adminContext.isSuperadmin`, throwing `COVERAGE_UNAUTHORIZED` otherwise (verified-by-author at `functions-audit.mjs:133-154`).
- **WHEN** a quota enforcement event is emitted, **THE SYSTEM SHALL** require `detail.decision ∈ {allowed, denied}` (verified-by-author at `functions-audit.mjs:114-119`).
- **WHEN** an OpenWhisk-native error is mapped, **THE SYSTEM SHALL** translate `404→not_found, 409→conflict, 422→quota_exceeded, 429→rate_limited, 504→timeout`, preserving `providerError` (subagent-reported `:1741-1768`).

### S6. Import / export (façade)

- **WHEN** `buildScopeValidatedExportRequest(context, resourceRef)` runs, **THE SYSTEM SHALL** require `tenantId, workspaceId, correlationId` and reject if `resourceRef.tenantId/workspaceId` mismatch the caller; default `bundleVersion` is `'2026-03-27'` (verified-by-author at `functions-import-export.mjs:33-63`).
- **WHEN** `buildScopeValidatedImportRequest(context, bundle)` runs, **THE SYSTEM SHALL** reject cross-tenant or cross-workspace bundles and stamp the import with caller scope, default `importOperation: 'apply'` (verified-by-author at `functions-import-export.mjs:65-99`).
- **WHEN** `validateImportBundle(bundle, context)` runs, **THE SYSTEM SHALL** require `bundle.bundleVersion`, return `SCOPE_VIOLATION` for cross-scope resources, return `COLLISION` for names in `context.existingNames`, return `POLICY_CONFLICT` for unsupported web-action visibilities, return `UNSUPPORTED_BUNDLE` for malformed input (verified-by-author at `functions-import-export.mjs:101-172`).
- **WHEN** `buildImportErrorResponse(code, correlationId, resource)` runs, **THE SYSTEM SHALL** return status `409` for `COLLISION`, else `422`, with hard-coded `requestId: 'req_import_validation'`, `timestamp: '2026-03-27T00:00:00Z'`, and a default `resource.path: '/v1/functions/workspaces/{workspaceId}/definitions/import'` (verified-by-author at `functions-import-export.mjs:178-197`).

### S7. Console-backend workflow surface (`console-backend-functions.mjs`)

- **WHEN** `getConsoleBackendIdentityRequirements()` is invoked, **THE SYSTEM SHALL** return `{actor_type: 'workspace_service_account', initiating_surface, required_scope_fields: ['tenantId','workspaceId','correlationId'], authorization_model_role: 'workspace_service_account'}` (verified-by-author at `console-backend-functions.mjs:19-26`).
- **WHEN** `validateConsoleBackendScope(context)` runs, **THE SYSTEM SHALL** require `tenantId` and `workspaceId`, and reject if `requestTenantId/requestWorkspaceId` differ from `context.tenantId/workspaceId` (verified-by-author at `console-backend-functions.mjs:28-63`).
- **WHEN** `buildConsoleBackendWorkflowInvocation(context, actionRef, payload)` runs, **THE SYSTEM SHALL** require `actionRef`, `tenantId`, `workspaceId`, `correlationId`; run `validateConsoleBackendScope`; build a representative public API call with hard-coded `X-API-Version: '2026-03-25'`, default `responseMode: 'synchronous'`, default `triggerContext: {kind: 'direct'}`, default `idempotencyKey: \`idem:${correlationId}:${actionName}\``; run `validateConsoleBackendInvocationRequest`; throw on either validation failure (verified-by-author at `console-backend-functions.mjs:65-127`).
- **WHEN** `invokeWorkflow(workflowId, params, callerContext)` runs, **THE SYSTEM SHALL** delegate to `executeSaga` from `apps/control-plane/src/saga/index.mjs` (verified-by-author at `console-backend-functions.mjs:191-193`).
- **WHEN** a workflow id is queried via `getConsoleWorkflowRouteClassification(id)`, **THE SYSTEM SHALL** look up against four hard-coded classifications: `WF-CON-002 (createTenant)`, `WF-CON-003 (createWorkspace)`, `WF-CON-004 (service-account credentials)`, `WF-CON-006 (createServiceAccount)` (verified-by-author at `console-backend-functions.mjs:129-166`).

---

## GAPS

### G-cross. Cross-cutting

1. **The actual function-invocation HTTP handler is not in this repo.** `grep -rln "POST /v1/functions" services apps` returns route declarations and tests only, plus `console-backend-functions.mjs` (which calls **saga workflows**, not OpenWhisk). No file in source consumes `buildOpenWhiskAdminAdapterCall` to actually invoke an OpenWhisk action. This matches the capability map's TODO ("function package storage, code-build, and trigger registration concretely live in the repo was not traced").
2. **Adapter does not import `services/adapters/src/authorization-policy.mjs`.** Same finding as D1/E1/G1.
3. **Hard-coded contract-version fallback drift.** `functions-admin.mjs:179` → `'2026-03-25'`; `functions-audit.mjs` topic & timestamps → `'2026-03-27T00:00:00Z'`; `functions-import-export.mjs:189` → `'2026-03-27T00:00:00Z'`; `console-backend-functions.mjs:96` → `'2026-03-25'` as a literal `X-API-Version`. Three different dates across one capability.
4. **Default public URL is a literal example hostname.** `services/adapters/src/openwhisk-admin.mjs:1008` falls back to `https://api.in-falcone.example/functions/{name}` (verified-by-author). Same family as the other adapters' `keycloak.example` defaults. See B2.
5. **Hard-coded `'2026-03-27T00:00:00Z'` as a request timestamp.** `functions-import-export.mjs:189`. Every import-error response carries this fake timestamp.

### G-adapter (resource validation)

- **G-S3.1** No reserved-action / reserved-namespace blocklist beyond the namespace-prefix check. `_/whisk.system/*` and other system-reserved names are not explicitly blocked (subagent-reported `:596-800`).
- **G-S3.2** `inlineCode` accepted without byte-length validation (subagent-reported `:1138-1146`). Payload bloat possible.
- **G-S3.3** Kafka trigger validation accepts arbitrary `sourceRef` without format/syntax check (subagent-reported `:1247`).
- **G-S3.4** Storage trigger: bucket name, object key patterns, and credentials are not validated for each entry in `storageTriggers` (subagent-reported `:1185-1187`).
- **G-S3.5** Concurrency limit per action is not in the quota guardrails (subagent-reported `:1153-1159, :205-234`).
- **G-S3.6** Web-action visibility `public` not cross-checked with package visibility; a public web action in a `workspace_shared` package may leak metadata (subagent-reported `:659-668, :1160-1168`).

### G-adapter (authorization)

- **G-S3.7** `validateOpenWhiskAdminRequest` calls `resolveWorkspaceEffectiveCapabilities` but does not check `effectiveRoles`/`scopes` against per-resource capabilities (subagent-reported `:909-967, :580`). Only plan-tier enablement is enforced. Caller passing `scopes=[], effectiveRoles=[]` to `buildOpenWhiskAdminAdapterCall` is not rejected.
- **G-S3.8** **Workspace-secret scope check guard is fail-open when `context.workspaceId` is missing.** `:826` — `if (context.workspaceId && payloadWorkspaceId && payloadWorkspaceId !== context.workspaceId)`. If `context.workspaceId` is `undefined`, the AND short-circuits before the `!==` check; the scope check never fires. Combined with `:813` deriving `payloadWorkspaceId = payload.workspaceId ?? context.targetWorkspaceId`, a caller who can either omit `context.workspaceId` or who supplies a different `context.targetWorkspaceId` reaches a no-violation state. See B1.

### G-adapter (audit / secrets)

- **G-S3.9** Secret-resolution state (`resolved/unresolved/pending`) is stored on the normalized resource (`:1175-1177`) but not surfaced in `buildOpenWhiskAdminAuditSummary` (`:1328-1333`, subagent-reported).
- **G-S3.10** Error responses include `providerError` (`:1741-1768`); if the OpenWhisk-side error leaks a secret name, it propagates to the caller (subagent-reported).
- **G-S3.11** Tenant isolation evidence claims `capturesTenantIsolation: true` but does not record query scope on `list` actions (subagent-reported `:1328-1333`).

### G-adapter (other)

- **G-S3.12** `derivePlanTier` (`:186-195`) returns `'starter'` for any unknown plan id, silently downgrading. Same pattern as F1's B1 and G1's silent fallbacks.
- **G-S3.13** Error classification defaults to `'dependency_failure'` for any unknown OpenWhisk status (subagent-reported `:1742-1750`).
- **G-S3.14** `dispatchWorkflowAction` (verified-by-author at `:1792-1812`) returns a synthesized `activationId` without validating `namespace` or `actionRef`, hard-codes `initiating_surface: 'console_backend'`, and performs no OpenWhisk call. The function looks like a stub mirroring the production adapter shape.

### G-façade

- **G-F.1** `functions-audit.mjs:34-37` — `publishAuditEvent` defaults to `((payload, meta) => ({topic, eventId}))` if `context.publishAuditEvent` is not supplied. **The default is a no-op stub that returns metadata without publishing.** If any caller forgets to wire a real publisher, audit events are silently dropped.
- **G-F.2** `functions-audit.mjs:91` — the audit-query loader defaults to `(() => ({items: [], page: {size, nextCursor: undefined}}))`. Audit queries on un-wired callers return empty results silently.
- **G-F.3** `functions-audit.mjs:145` — `buildAuditCoverageReport` hard-codes `generatedAt: params.generatedAt ?? '2026-03-27T00:00:00Z'`. Frozen timestamp.
- **G-F.4** `console-backend-functions.mjs:191-193` — `invokeWorkflow` calls `executeSaga`. If the saga engine's runtime is the broken stub from the A1 audit (idempotency drops `workflow_id`, retry-override no state guard, etc.), the workflow invocations inherit those bugs.
- **G-F.5** `functions-import-export.mjs:147` — `resourceTypeHasWebActions` returns true for both `function_action`/`action` AND for `function_definition_export`/`function_definition_import`. Export/import resources are not themselves web-action carriers — the visibility check fires for resources that have no visibility field, masking real validation gaps.

### G-tests

- **G-T1** Only two test files: `tests/adapters/openwhisk-admin.test.mjs` and `tests/e2e/console/console-backend-openwhisk.test.mjs`. No test exercises `dispatchWorkflowAction`, no test exercises the workspace-secret scope-check fail-open path.

---

## BUGS

### Confirmed (verified-by-author from cited lines)

- **B1. Workspace-secret scope check fails open when `context.workspaceId` is missing.**
  `services/adapters/src/openwhisk-admin.mjs:826` (verified-by-author):
  ```js
  if (context.workspaceId && payloadWorkspaceId && payloadWorkspaceId !== context.workspaceId) {
    violations.push('workspace secret request must stay within the caller workspace scope.');
  }
  ```
  And similarly for `context.tenantId && payloadTenantId` at `:830`. **The guard short-circuits when `context.workspaceId` is falsy** — the cross-scope check never fires. Combined with `:813` (`payloadWorkspaceId = payload.workspaceId ?? context.targetWorkspaceId`), an upstream that forgets to populate `context.workspaceId` (or that lets `context.targetWorkspaceId` come from request body) lets a caller target any workspace's secrets. The same fail-open exists for tenant.
  *Note: this is a corrected restatement of the subagent's "scope mismatch bypass" claim — the subagent attributed it to variable-name divergence, but on re-grounding the variables are the same and the bug is the truthy-guard pattern.*

- **B2. Public URL default points at the placeholder host `api.in-falcone.example`.**
  `services/adapters/src/openwhisk-admin.mjs:1008` (verified-by-author):
  ```js
  publicUrl: payload.publicUrl ?? `https://api.in-falcone.example/functions/${normalizeLogicalName(...)}`
  ```
  Same family as the F2 audit's `keycloak.example` and G1's deterministic verification ids. If the caller omits `payload.publicUrl`, customers see an unresolvable hostname. The same file's CORS allow-origin at `:1012` defaults to `'https://console.in-falcone.example'`.

- **B3. The actual function-invocation handler is not in this repo.**
  `grep -rln "POST /v1/functions"` returns only route declarations and tests (verified-by-author by `grep`). No file calls into `buildOpenWhiskAdminAdapterCall` or wires the OpenAPI route `POST /v1/functions/{id}/invoke` to an OpenWhisk client. The map's H1 "Tenant-facing serverless surface" is a contract layer only — production invocation glue is out-of-repo.

- **B4. `dispatchWorkflowAction` returns a synthetic activation envelope without validating inputs.**
  `services/adapters/src/openwhisk-admin.mjs:1792-1812` (verified-by-author). Inputs `namespace`, `actionRef`, `payload`, `annotation` are not validated; the function unconditionally returns `{activationId: \`act_${slug}_${idemSlice12 || 'pending'}\`, namespace, actionRef, ...}`. If a caller treats the result as a real OpenWhisk activation id, the id is fabricated and not bound to any real invocation. Most likely intended as a planning helper, but the function name implies dispatch and no comment marks it as a stub.

- **B5. Multiple hard-coded contract-version / timestamp fallbacks across one capability.**
  `apps/control-plane/src/functions-admin.mjs:179` → `'2026-03-25'`; `apps/control-plane/src/functions-import-export.mjs:189` → `'2026-03-27T00:00:00Z'`; `apps/control-plane/src/functions-audit.mjs:145` → `'2026-03-27T00:00:00Z'`; `apps/control-plane/src/console-backend-functions.mjs:96` → `'2026-03-25'` as a literal `X-API-Version` (all verified-by-author). Three dates across four files in one capability — a missing contract at startup or a stale import will silently advertise mismatched versions.

- **B6. `functions-audit.publishAuditEvent` defaults to a no-op stub.**
  `apps/control-plane/src/functions-audit.mjs:34-37` (verified-by-author):
  ```js
  function publishAuditEvent(event, context = {}) {
    const publisher = context.publishAuditEvent ?? ((payload, meta = {}) => ({ topic: meta.topic, eventId: toEventId(payload) }));
    publisher(event, { topic: FUNCTION_AUDIT_TOPIC });
    return toEventId(event);
  }
  ```
  If `context.publishAuditEvent` is unset, the stub *returns* a fake `{topic, eventId}` object that mimics a successful publish. The four exported `emit*` functions return `toEventId(event)` and never throw. Any caller that doesn't wire a real publisher silently drops every audit event.

- **B7. `functions-audit.queryAuditRecords` default loader returns empty.**
  `functions-audit.mjs:91` (verified-by-author) — `const loader = context.queryAuditRecords ?? (() => ({ items: [], page: { size: query.limit, nextCursor: undefined } }))`. If a caller forgets the loader, queries return empty with no warning.

- **B8. `functions-admin.summarizeFunctionsAdminSurface` action-collection routeCount is misclassified.**
  `apps/control-plane/src/functions-admin.mjs:135-137` (verified-by-author):
  ```js
  routeCount: actionRoutes.filter((route) => route.method === 'GET').length
  ```
  This counts every GET on `function_action` resourceType (line 76: `actionRoutes = functionsAdminRoutes.filter((route) => route.resourceType === 'function_action')`). But "action_collection" means LIST. `GET /actions/{id}` (single-action get) is also a GET. The count conflates single-action gets with collection lists.

- **B9. `functions-import-export.resourceTypeHasWebActions` includes export/import resources.**
  `functions-import-export.mjs:174-176` (verified-by-author):
  ```js
  return ['function_action', 'action', 'function_definition_export', 'function_definition_import'].includes(resourceType);
  ```
  Export/import resources do not themselves have web actions — those fields apply to actions inside the bundle, not the bundle itself. The visibility validation will fire on the wrong objects, masking real errors.

### Likely

- **B10. Secret-reference workspace scope not enforced in normalised resource.** Subagent-reported `:1171-1179`. Normalised resource includes per-secret `workspaceId` but no check that all secret refs match the caller's workspace. Downstream executor that trusts the payload could resolve cross-workspace secrets.

- **B11. Plan-tier silent downgrade to `'starter'` for unknown ids.** `:186-195` (subagent-reported). Same pattern as F1 B1.

- **B12. Tenant-isolation evidence missing on `list` actions.** `:1328-1333` (subagent-reported). Audit event cannot reconstruct query scope.

- **B13. Error classification defaults to `'dependency_failure'` for unknown OpenWhisk status.** `:1742-1750` (subagent-reported). 418 / 451 / future codes all become "dependency failure".

- **B14. Kafka and storage triggers accept arbitrary `sourceRef`.** Subagent-reported `:1247, :1185-1187`. No format check.

- **B15. No concurrency limit in quota guardrails.** Subagent-reported `:1153-1159`.

- **B16. Hardcoded `'console_backend'` initiating-surface in `dispatchWorkflowAction`.** `:1794` (verified-by-author). If a non-console caller invokes this helper, the annotation is wrong.

- **B17. `functions-audit.assertScopedQuery` permits empty tenant/workspace mismatch via override fields.** `functions-audit.mjs:44, :50` (verified-by-author):
  ```js
  if ((params.tenantId ?? context.routeTenantId ?? context.targetTenantId ?? context.tenantId) !== context.tenantId) { … }
  ```
  Same fallback chain repeated for workspaceId. The chain ends with `context.tenantId`, so if `params.tenantId` AND `context.routeTenantId` AND `context.targetTenantId` are all `undefined`, the LHS resolves to `context.tenantId` and the check passes. That's intentional. **But** if `context.routeTenantId` is set to an attacker-supplied value while `params.tenantId` is undefined, the check uses `routeTenantId` and compares to `context.tenantId` — which is correct. The fail-open path is: if `context.tenantId` is itself missing, the `invariant` at `:41` catches it first. So this is actually OK on re-reading — flag as needs-verification.

### Needs verification

- **B18. Does the saga engine used by `invokeWorkflow` exhibit the bugs found in the A1 audit?** A1 found `executeSaga` has multiple correctness issues (idempotency lookup drops workflow_id, retry-override missing state guard, etc.). `console-backend-functions.mjs:191-193` calls it directly. Workflow invocations inherit those bugs.

- **B19. Is `dispatchWorkflowAction` ever called by production code?** Looks like a planning helper rather than a real dispatcher. Verify by grep across the repo.

- **B20. Does the OpenAPI declaration of `POST /v1/functions/{id}/invoke` correspond to any APISIX route?** Capability gate file declares `/v1/functions/*/invoke` under the `functions_public` capability (per G1 / capability-map references) but no upstream is wired. Verify by reading `services/gateway-config/routes/*.yaml`.

- **B21. Does `dispatchWorkflowAction`'s synthetic `activationId` collide for distinct invocations?** The id is `act_${workflowId|actionRef|'workflow'}_${idempotencyKey.slice(-12) || 'pending'}`. If both `workflowId` and `actionRef` and `idempotencyKey` are absent, the id is literally `act_workflow_pending`. Many invocations could share this id.

---

## Scope note for downstream spec authoring

H1 has the same shape as F1 (event-gateway): a complete contract layer (validation, normalisation, audit envelope) and no production runtime. Four items to address before formalising FRs:

1. **B3 — locate or build the function-invocation runtime.** Without it, every FR about `POST /v1/functions/{id}/invoke` is aspirational. The runtime needs to consume the adapter's compiled call envelopes and talk to OpenWhisk (or whatever serverless runtime the deployment chooses).
2. **B1 — fix the workspace-secret scope-check fail-open** by either requiring `context.workspaceId` (assert-and-throw if absent) or by inverting the check to `payloadWorkspaceId && payloadWorkspaceId !== (context.workspaceId ?? null)`.
3. **B6 — wire a real audit publisher.** The façade's default stub silently drops every audit event. The current shape (`context.publishAuditEvent ?? noop`) is dangerous; switch to fail-closed (throw if no publisher).
4. **B5 — collapse the three contract-version / timestamp fallbacks** into one source of truth.

Secondary items (B7 default-empty loader, B8 routeCount classification, B9 import/export visibility check, B16 hard-coded initiating surface) are quick fixes that prevent silently incorrect outputs. After those, the rest of the adapter is well-decomposed and straightforward to spec — but downstream auditors should keep in mind that the runtime layer remains a major undocumented dependency.
