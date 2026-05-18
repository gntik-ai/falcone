# Capability E1 — MongoDB Admin (adapters)

**Source locus:**
- Adapter: `services/adapters/src/mongodb-admin.mjs` — 1935 LOC, 77.6 KB.
- Façade re-export: `apps/control-plane/src/mongo-admin.mjs` — 112 LOC of thin façades over the adapter plus `services/internal-contracts/`.
- Shared (unused-by-adapter) authorization model: `services/adapters/src/authorization-policy.mjs` (18 LOC).
- Tests: `tests/adapters/mongodb-admin.test.mjs`, `tests/unit/mongo-admin.test.mjs`, `tests/contracts/mongodb-admin.compatibility.test.mjs`.
- Schema declared in `apps/control-plane/openapi/families/mongo.openapi.json`.

**Sibling not in E1 (capability-map gap):** `services/adapters/src/mongodb-data-api.mjs` (2543 LOC, 89 KB) is the analogous data-plane CRUD adapter. The map's D1 entry bundled the PostgreSQL admin and data-API adapters under one capability; the equivalent Mongo data-API is *not* surfaced in any capability map entry. This audit covers only `mongodb-admin.mjs` per the strict E1 scope but flags the omission.

**Method.** Read the façade (`apps/control-plane/src/mongo-admin.mjs`) and shared authorization-policy myself. Delegated a single Explore agent to read the 1935-LOC adapter end-to-end. After the agent returned, **spot-verified the four most damaging claims** by directly reading the exact line ranges. Claims marked **Verified-by-author** were re-grounded; **Subagent-reported** means I relayed the agent's analysis without re-grounding; **Verified-and-corrected** means the underlying file behaves differently from what the agent reported and I have adjusted the claim accordingly.

**Structural up-front:**
- This adapter is a **pure compiler/validator**. It returns plans, validation results, and audit metadata. It does not open MongoDB connections or run admin commands.
- The adapter does **not** import `services/adapters/src/authorization-policy.mjs`. The shared "adapter enforcement surfaces" contract is dead with respect to E1. Authorization is implicit: the caller passes `scopes`/`effectiveRoles`/`actorId`/`actorType` through `buildMongoAdminAdapterCall`, the adapter records them on the audit envelope, and never checks them.
- The façade at `apps/control-plane/src/mongo-admin.mjs:1-112` is purely declarative; it re-exports contract getters and a `summarizeMongoAdminSurface` aggregator. Same façade-pattern as the other control-plane entries.

---

## SPEC (what exists)

### S1. Compatibility, profile, and configuration

- **WHEN** `getMongoCompatibilityMatrix()` is invoked, **THE SYSTEM SHALL** return a frozen `SUPPORTED_MONGO_VERSION_RANGES` describing 6.x / 7.x / 8.x ranges with `{adminApiStability, topologies, isolationModes, segregationModels, guarantees}` (`mongodb-admin.mjs:761` — subagent-reported).
- **WHEN** `isMongoVersionSupported(version)` is called, **THE SYSTEM SHALL** return `true` only for non-empty strings whose major prefix matches a supported range (`mongodb-admin.mjs:765-773` — subagent-reported).
- **WHEN** `resolveMongoAdminProfile(context = {})` is called, **THE SYSTEM SHALL** derive `{planId (default `pln_01growth`), isolationMode, clusterTopology, segregationModel, supportedIsolation/Topology/Segregation, allowedRoleBindings, quotaGuardrails{maxDatabasesPerWorkspace/Tenant, maxCollectionsPerDatabase/Tenant, maxIndexesPerCollection, maxViewsPerDatabase, maxTemplatesPerWorkspace, maxUsersPerDatabase, maxRoleBindingsPerUser}, namingPolicy{tenantPrefix, workspacePrefix, databasePrefix, collectionPrefix, userPrefix, ownedNamePrefix, maxDatabaseNameLength, maxCollectionNameLength, maxUserNameLength, maxTemplateIdLength, forbiddenDatabaseNames, forbiddenCollectionPrefixes}, minimumEnginePolicy{executionIdentity, maximumCredentialLifetimeHours}, allowedRoleBindings (isolation-aware), various *_Supported flags}` (`mongodb-admin.mjs:776-…`; key lines **verified-by-author** at `:780-833`).
- **WHEN** the profile is built and `segregationModel === 'tenant_database'`, **THE SYSTEM SHALL** set `databasePrefix = \`${tenantKey}_\`` and `collectionPrefix = \`${workspaceKey}_\`` (verified-by-author at `:788-792`); when `segregationModel === 'workspace_database'`, **THE SYSTEM SHALL** set `databasePrefix = \`${workspaceKey}_\`` and leave `collectionPrefix = undefined` (verified-by-author at `:792`).
- **WHEN** `userPrefix` is not supplied via context, **THE SYSTEM SHALL** default it to `\`${workspaceKey}_\`` (verified-by-author at `:791`).
- **WHEN** plan tier is `pln_01starter`, **THE SYSTEM SHALL** force `shared_cluster` and apply minimum quotas (1 DB/workspace, 24 collections/DB, …); `pln_01enterprise` permits 12 DBs/workspace, 256 collections/DB, and both isolation modes (`mongodb-admin.mjs:124-197` — subagent-reported).

### S2. Validation entry points

- **WHEN** `validateMongoAdminRequest({resourceKind, action, context, payload})` runs, **THE SYSTEM SHALL** compute base violations (plan/isolation/topology/segregation/version/resource-action compatibility — `:846-886, :1384`), dispatch to the resource-specific validator (`:1386-1410`), derive `quotaDecision` (`:1412`), and return `{ok, violations[], quotaDecision?, profile}` (`:1414-1419`) — subagent-reported.
- **WHEN** `validateDatabaseRequest` runs (`:920-957`, **verified-by-author**), **THE SYSTEM SHALL** require `databaseName` for non-list/non-get operations, require it for get/delete, validate against `/^[a-z0-9][a-z0-9_]{2,47}$/`, reject `MONGO_RESERVED_DATABASES = {admin, config, local}`, enforce `databaseName.startsWith(profile.namingPolicy.databasePrefix)` only when `context.enforceOwnedPrefix !== false`, and enforce `currentDatabaseCount < maxDatabasesPerWorkspace` and `currentTenantDatabaseCount < maxDatabasesPerTenant` on `create`.
- **WHEN** `validateCollectionRequest` runs (`:959-…`, **verified-by-author** through `:994`), **THE SYSTEM SHALL** require `databaseName`, require `collectionName` on non-list, validate `/^[a-z0-9][a-z0-9_]{2,63}$/`, reject names with the `system.` prefix, restrict `collectionType` to the supported set, and require `maxDocuments` or `sizeBytes` on capped collections.
- **WHEN** `validateIndexRequest` runs (`:1075-…`, subagent-reported), **THE SYSTEM SHALL** require database+collection+index name, key definition, validate `ttlSeconds`, rebuild strategy ∈ `MONGO_INDEX_REBUILD_STRATEGIES`, `maxParallelCollections === 1`, require approval token for rebuilds, and enforce per-collection index quota.
- **WHEN** `validateViewRequest` runs (`:1122-…`, subagent-reported), **THE SYSTEM SHALL** require database+view+`sourceCollectionName` and a pipeline with ≥1 stage, validate each stage is `{operator}`, and block `$out`/`$merge`.
- **WHEN** `validateTemplateRequest` runs (`:1161-…`, subagent-reported), **THE SYSTEM SHALL** validate `templateId` against `/^[A-Za-z][A-Za-z0-9_-]{2,80}$/`, normalise defaults/variables, and enforce per-workspace template quota.
- **WHEN** `validateUserRequest` runs (`:1191-1265`, **verified-by-author**), **THE SYSTEM SHALL** require `databaseName`, require `username` on non-list, validate `/^[a-z0-9][a-z0-9_.-]{2,63}$/`, enforce `username.startsWith(profile.namingPolicy.userPrefix)` only when `context.enforceOwnedPrefix !== false`, **reject any request whose `payload.password` is truthy** (`:1215-1217`), require either a `passwordBinding` or `rotatePassword === true` on create/update, validate `passwordBinding.secretRef`/`serviceAccountId`, enforce `passwordBinding.lifecycle.maxLifetimeHours <= profile.minimumEnginePolicy.maximumCredentialLifetimeHours` (default 336 h), require unique role-binding combos, cap `roleBindings.length` at `profile.quotaGuardrails.maxRoleBindingsPerUser`, require every `roleBinding.roleName ∈ profile.allowedRoleBindings`, and restrict collection-scoped role bindings to `read`/`readWrite`.
- **WHEN** `validateRoleBindingRequest` runs (`:1267-…`, subagent-reported), **THE SYSTEM SHALL** require `username`/`databaseName`/`roleName`, validate role against `allowedRoleBindings`, and block non-read/readWrite roles on collection scopes.

### S3. Normalisation, error mapping, and adapter call build

- **WHEN** `normalizeMongoAdminResource(resourceKind, payload, context)` runs, **THE SYSTEM SHALL** project the payload into a BaaS-native shape per resource kind: database/collection/index/view/template/user/role_binding each get their own normalised envelope with stable fields (`:1449-1589` — subagent-reported).
- **WHEN** `normalizeMongoAdminError(error, context)` runs, **THE SYSTEM SHALL** classify by `error.classification` or HTTP status `(404→not_found, 409→conflict, 429→rate_limited, 504→timeout, else dependency_failure)`, map to `ERROR_CODE_MAP` (`GW_MONGO_*` codes, status, retryable), and return `{status, code, title, detail{…}, retryable, providerError, message}` (`:1595-1626` — subagent-reported).
- **WHEN** `buildMongoAdminAdapterCall(payload)` runs, **THE SYSTEM SHALL** (1) run `validateMongoAdminRequest` and return `{ok:false, violations, profile}` on failure, (2) normalise the resource, (3) build `adminCredentialBinding` `{scope, bindingType, serviceAccountRef, secretRef, rotationPolicy, lifecycle}` (`:1692-1695`), (4) assemble `preExecutionWarnings`, `auditSummary`, `correlationContext`, `recoveryGuidance`, `minimumPermissionGuidance`, and an `adminEvent` with `eventType = \`mongo.admin.${resourceKind}.accepted\``, `outcome: 'accepted'`, `streamDelivery.topic: 'mongo.admin'`, (5) return a single adapter-call envelope carrying `actor_id, actor_type, origin_surface, scopes, effective_roles, correlation_context`, and the full payload including normalisation + event (`:1662-1794` — subagent-reported).
- **WHEN** `buildMongoAdminMetadataRecord(...)` runs, **THE SYSTEM SHALL** project an audit/observability record for post-execution sinks `(resourceKind, tenantId, workspaceId, observedAt, metadata{primaryRef, action, provider, segregationModel, credentialScope, credentialLifecycleState, warningCount, eventType, minimumPrivilegePrinciple}, resource, …)` (`:1797-1845` — subagent-reported).
- **WHEN** `buildMongoInventorySnapshot(...)` runs, **THE SYSTEM SHALL** aggregate counts (databases, collections, indexes, views, templates, users, roleBindings), echo `quotas/namingPolicy/minimumEnginePolicy`, attach `credentialPosture`, and stamp `auditCoverage{capturesActorContext, capturesCredentialBinding, capturesCorrelationContext, …}` as `true` (`:1848-1895+` — subagent-reported).

### S4. Façade contract surface (consumer of the adapter)

- **WHEN** `apps/control-plane/src/mongo-admin.mjs` is imported, **THE SYSTEM SHALL** expose `mongoApiFamily`, `mongoAdminRequestContract`, `mongoAdminResultContract`, `mongoInventorySnapshotContract`, `mongoAdminEventContract`, `mongoAdminRoutes` (filtered to family=`'mongo'`), and `MONGO_ADMIN_AUDIT_CONTEXT_FIELDS = ['actor_id','actor_type','origin_surface','correlation_id','authorization_decision_id','target_tenant_id','target_workspace_id']` (**verified-by-author** at `apps/control-plane/src/mongo-admin.mjs:1-30`).
- **WHEN** `getMongoCompatibilitySummary(context)` is called, **THE SYSTEM SHALL** return `{provider:'mongodb', contractVersion: mongoAdminRequestContract?.version ?? '2026-03-25', clusterProfile, isolationMode, …, supportedVersions[]}` (**verified-by-author** at `apps/control-plane/src/mongo-admin.mjs:76-109`). Note the hard-coded fallback `'2026-03-25'`.

---

## GAPS

### G-cross. Cross-cutting

1. **`mongodb-data-api.mjs` (2543 LOC) is not in any capability-map entry.** It sits next to the admin file and clearly serves the data-plane CRUD surface for Mongo, parallel to `postgresql-data-api.mjs` (which D1 bundles). The map's E1 entry says "admin" only and the map has no E1' / E3. The data-API adapter is therefore untracked.
2. **The adapter does not import `authorization-policy.mjs`.** Same finding as D1 cross-cutting. `grep -l "authorization-policy" services/adapters/src/mongodb-admin.mjs` returns nothing. The "adapter enforcement surfaces" contract is exposed but unused.
3. **Adapter is a pure compiler.** As with D1, no SQL/command is executed here. Atomicity, partial-failure recovery, post-exec verification are the caller's problem. The `adminEvent.outcome` is hard-coded `'accepted'` (`:1726-1741`) — there is no `rejected`/`failed` event from this adapter.

### G-S1. Compatibility / profile

- **G-S1.1** The compatibility summary's `contractVersion` falls back to a hard-coded `'2026-03-25'` when the contract isn't loaded (`apps/control-plane/src/mongo-admin.mjs:81`). Stale string drift risk identical to the IAM façade in D1.
- **G-S1.2** `collectionPrefix` is `undefined` when `segregationModel === 'workspace_database'` (verified at `:792`). Downstream consumers that treat the profile's namingPolicy as authoritative will receive `undefined` for this field with no comment in the contract.

### G-S2. Validation

- **G-S2.1 Collection prefix is computed but never enforced.** `grep collectionPrefix mongodb-admin.mjs` returns only `:792, :823, :1443` — declaration, return-object embed, and re-export inside `normalizeMongoAdminResource`. `validateCollectionRequest` at `:959-994` only checks regex + reserved `system.*` prefix. No `startsWith(profile.namingPolicy.collectionPrefix)` anywhere (**verified-by-author**). In `tenant_database` segregation a workspace user can create collections in any other workspace's namespace within the same tenant database. See B1.
- **G-S2.2 Pipeline validation is shallow.** `validateViewRequest` (`:1122-…`) blocks `$out`/`$merge` but allows `$lookup`, `$facet`, `$unionWith`, `$function`, `$javascript`, `$accumulator` — Mongo stages that can read across collections/databases or execute server-side JS (subagent-reported).
- **G-S2.3 View source collection is unvalidated.** `sourceCollectionName` is required but not checked against a known set of collections in the same database, or constrained to the tenant's scope (subagent-reported).
- **G-S2.4 `partialFilterExpression` and `collation` on indexes pass through raw.** `:615-616, :1080` — accepted as arbitrary objects. If a downstream executor interpolates rather than parameterises, injection is possible (subagent-reported; not exploitable from this adapter alone).
- **G-S2.5 Reserved-collection-prefix list is fixed to `system.*`.** Newer Mongo internal collections (e.g., `enxcol_.*`, `oplog.*`) are not blocked.
- **G-S2.6 `validateUserRequest` rejects raw passwords unconditionally** (`:1215-1217`, **verified-by-author**). Good — but the payload still arrives at the adapter and is normalised into `auditSummary` / `requestedResource` before validation rejects it. A consumer that logs raw `payload` objects on validation failure leaks the password. Worth a hardening note even though the validator does its job.
- **G-S2.7 No template scope enforcement.** `validateTemplateRequest` validates the id pattern and quota but not that templates apply to permitted resource kinds.
- **G-S2.8 `enforceOwnedPrefix` kill-switch is reachable.** Both `validateDatabaseRequest:939` and `validateUserRequest:1210` use `context.enforceOwnedPrefix !== false` (**verified-by-author**). Default behaviour is strict (`undefined !== false` = strict). The bug is not the default — it's that *callers* can set `enforceOwnedPrefix: false` to bypass the prefix check entirely. Whether this is reachable from untrusted input depends on upstream code and is **not knowable from this adapter alone**. Flagged as needs verification (see B2).

### G-S3. Normalisation / adapter call

- **G-S3.1** `adminEvent.outcome` is hard-coded `'accepted'` (`:1726-1741`). There is no factory for emitting a `rejected` event when validation fails, even though `buildMongoAdminAdapterCall` returns `{ok:false, violations}` in that case (`:1682-1689`). Audit consumers will only ever see accept events from this adapter.
- **G-S3.2** `adminCredentialBinding.secretRef` is constructed as a string `secret://${serviceAccountRef}/active` (`:342`) without checking that the secret exists. Verification deferred to executor (subagent-reported).
- **G-S3.3** `normalizeName()` (`:256-258`) trims but does not validate, so if `normalizeMongoAdminResource` is called outside `validateMongoAdminRequest`, names with invalid characters survive normalisation (subagent-reported).
- **G-S3.4** `actor_id`/`scopes`/`effective_roles` pass through unchecked. The adapter does not even sanity-check that `actor_id` is non-empty.

### G-Tests. Tests

- **G-T1** Unit and adapter tests appear sparse relative to the surface size (1935 LOC). Subagent found ~6 test cases in `tests/adapters/mongodb-admin.test.mjs`. The control-plane façade is not exercised here; its only test is contract validation.
- **G-T2** No test asserts that `validateCollectionRequest` rejects names violating `collectionPrefix` (because the check doesn't exist — see B1).
- **G-T3** No fuzz / boundary tests on `partialFilterExpression`, `collation`, or pipeline-stage operators.

---

## BUGS

### Confirmed (verified-by-author from the cited lines)

- **B1. Collection-prefix isolation is unenforced.** `services/adapters/src/mongodb-admin.mjs:792` derives `collectionPrefix = \`${workspaceKey}_\`` for `tenant_database` segregation; `:823` and `:1443` re-export it on the profile/resource envelope. **`validateCollectionRequest` (`:959-994`) never references it.** Verified by `grep -n "collectionPrefix" mongodb-admin.mjs` returning only the three definition/embed sites and no `startsWith` check. In `tenant_database` segregation, where multiple workspaces share a single tenant database, a request from workspace A can create / mutate a collection in workspace B's namespace as long as the database prefix is correct and the collection name passes the generic regex. This is the highest-impact correctness bug in this adapter.

- **B2. `enforceOwnedPrefix` kill-switch is reachable from the request context.** `mongodb-admin.mjs:939` and `:1210` (**verified-by-author**) use `context.enforceOwnedPrefix !== false`. The intent is "strict by default, with an explicit escape". The escape itself is fine for trusted callers, but the adapter does not validate that the escape comes from a trusted source — it reads `context.enforceOwnedPrefix` from the same `context` object the caller hands to `buildMongoAdminAdapterCall`. If the upstream layer copies any caller-supplied field into `context`, prefix enforcement collapses to off. **Whether this is reachable in production depends on upstream code not visible from this file** — but the kill-switch is field-named, undocumented, and not gated by privilege. Best practice would be to require an out-of-band boolean signed/validated separately.

- **B3. `payload.password` is rejected but reaches the audit/normalised payload first.** `mongodb-admin.mjs:1215-1217` (**verified-by-author**) issues a violation when `payload.password` is set. However, `validateMongoAdminRequest` is the *first* thing `buildMongoAdminAdapterCall` calls (`:1682-1689`), and if violations exist the function returns early with `{ok:false, violations, profile}`. The normalised resource (`:1691`) and the audit envelope (`:1703-1741`) are only built on the success branch. So the password does *not* land in the adapter's audit envelope under normal flow. **The risk is narrower than the subagent characterised:** if a caller fishes the raw `payload` out of the request and logs it on validation failure (a common but bad pattern), the password leaks. The adapter itself does the right thing.

- **B4. `adminEvent.outcome` is always `'accepted'`.** `:1726-1741`. No event is emitted by this adapter for rejected validations. Combined with the fact that `buildMongoAdminAdapterCall` returns `{ok:false}` quietly, audit pipelines that count `mongo.admin.*.accepted` events miss every rejection. Confirmed by code inspection.

- **B5. Adapter does not import the shared `authorization-policy.mjs`.** Verified by `grep`. Same as D1 cross-cutting bug. Authorization is implicit on `effective_roles`/`scopes` pass-through; the adapter records but does not check them.

### Likely (smells / structural risks, derived from subagent analysis)

- **B6. View pipeline `$out`/`$merge` blocked but `$lookup`/`$function`/`$javascript` allowed.** `:1147-1155` (subagent-reported). On older Mongo versions or with server-side scripting enabled, `$function` is arbitrary JS execution; `$lookup` reaches into other collections; `$unionWith` reaches across databases. Even on modern Mongo, none of these honour the adapter's tenant scoping.

- **B7. `sourceCollectionName` for views is unvalidated against scope.** `:1135-1136` (subagent-reported). A view can reference a collection in a different database (or tenant, if the executor allows). The adapter does not constrain the reference.

- **B8. `partialFilterExpression` and `collation` are stored as opaque user-supplied objects.** `:615-616, :1080` (subagent-reported). Safe inside this adapter, but a hot potato for the executor.

- **B9. `MONGO_RESERVED_COLLECTION_PREFIXES` only includes `system.`.** Other internal Mongo collection name spaces (`enxcol_.*` for client-side field-level encryption, `oplog.*` on replicas) are not blocked.

- **B10. `adminCredentialBinding.secretRef` is not checked for existence.** `:342` (subagent-reported). Caller-side existence check or executor-side failure is the only signal.

- **B11. Hard-coded contract-version fallback `'2026-03-25'`** in the façade (`apps/control-plane/src/mongo-admin.mjs:81`, **verified-by-author**). Same shape as the D1 finding for `iam-admin.mjs`. If the contract isn't loaded at startup, the surface advertises a stale version.

- **B12. Quota checks happen pre-create with no post-commit re-check.** `:944-954` and similar in the per-resource validators (subagent-reported). Two concurrent creates that both pass quota in this adapter rely on the executor to serialise.

- **B13. `normalizeName` (`:256-258`) trusts identifiers if called outside `validateMongoAdminRequest`.** Risk only if a caller bypasses validation and normalises directly (subagent-reported).

### Needs verification

- **B14. Whether `context.enforceOwnedPrefix` is reachable from untrusted input** depends entirely on how upstream callers (control-plane handlers, console actions) build the `context`. Cannot be determined from this file alone. Confirm by tracing every call site of `buildMongoAdminAdapterCall` / `validateMongoAdminRequest`.

- **B15. Adapter behaviour when `passwordBinding.lifecycle.maxLifetimeHours` is missing.** `:1231` uses `(passwordBinding?.lifecycle?.maxLifetimeHours ?? 0) > …` — missing fields default to 0, which always passes the upper-bound check. Verify whether the intent is to fail-closed (require explicit `maxLifetimeHours`).

- **B16. Index `MONGO_INDEX_REBUILD_STRATEGIES` content.** Subagent flagged the validator but did not enumerate the allowed strategies. Verify whether the list includes any dangerous strategies (e.g., online-rebuild that holds a long lock).

- **B17. Role-binding allowlist for `dedicated_cluster` vs `shared_cluster`.** `:784-787` selects between `MONGO_SHARED_CLUSTER_ALLOWED_ROLE_BINDINGS` and `MONGO_DEDICATED_CLUSTER_ALLOWED_ROLE_BINDINGS` (verified-by-author). The subagent did not enumerate either set. Verify that neither list includes `root`, `__system`, `backup`, `restore`, `clusterAdmin`, `dbAdminAnyDatabase`, or `userAdminAnyDatabase`.

- **B18. Tests cover the regex and quota paths but the subagent did not enumerate which paths are uncovered.** Verify by running coverage; suspect candidates: rebuild-strategy validation, view pipeline rejection, role-binding collection-scope restriction, `enforceOwnedPrefix` kill-switch behaviour.

---

## Scope note for downstream spec authoring

E1 should be split into three sub-capabilities to match reality:

- **E1a — Mongo Admin Compiler/Validator** (this audit). The 1935-LOC compiler that normalises requests, validates, and emits audit envelopes.
- **E1b — Mongo Data-API Compiler/Validator** (uncovered by current map). The 2543-LOC sibling in `services/adapters/src/mongodb-data-api.mjs`.
- **E1c — Mongo Admin Executor** (not in this repo, by design). Whoever consumes the compiled `buildMongoAdminAdapterCall(...)` envelope and runs the actual Mongo admin command.

Before formalising FRs, the four highest-impact items to address:

1. **B1: collection-prefix isolation is unenforced** — add `startsWith(profile.namingPolicy.collectionPrefix)` to `validateCollectionRequest` when the profile carries one. This is a tenant-isolation regression in `tenant_database` mode.
2. **B4: emit a `rejected` event from the adapter on validation failure**, mirroring the `accepted` shape.
3. **B5/B11: wire `authorization-policy.mjs`** as a shared module that this and D1's PostgreSQL adapters consult; remove hard-coded contract-version fallbacks.
4. **B14: trace every call site of `buildMongoAdminAdapterCall`** to verify that `context.enforceOwnedPrefix` cannot come from untrusted input.
