# Capability O2 — Internal Contracts (cross-service registry)

**Source locus:** `services/internal-contracts/` — 1 entry module (`src/index.mjs`, 1767 LOC) + 55 JSON contract files + a stub `package.json` whose `lint`/`test`/`typecheck` scripts all `console.log` placeholders.

**Method.** Read `package.json`, the full `src/index.mjs` (both halves), surveyed every consumer that imports the registry (50 importers across `apps/` and `services/`), then spot-verified the most damaging claims — version-drift across registry JSONs, hard-coded date defaults, `example.com` hostname, alias-vs-relative-path inconsistency, missing top-level `version` field on `public-route-catalog.json`. All findings carry `file:line` citations.

**Scope.** Per the capability map this is one capability covering "internal contracts (cross-service registry)". In practice it is **the single canonical state-store for all cross-service shapes** (services, adapter ports, contracts, interaction flows, deployment topology, authorisation model, domain model, observability stack, public API taxonomy, public-route catalog, plus 38 event/payload schemas). It also hosts non-trivial business logic: tenant-effective-capability resolution, workspace API-surface derivation, tenant clone drafting, lifecycle mutation evaluation, plan-change evaluation.

---

## SPEC (what exists)

### S1. Module layout

- **WHEN** the `services/internal-contracts/src/index.mjs` module is imported, **THE SYSTEM SHALL** declare 21 `new URL('./*.json', import.meta.url)` resolvers (some `const`, some `export`) (`index.mjs:3-23, :10-14`).
- **WHEN** the module finishes loading, **THE SYSTEM SHALL** re-export 21 JSON contracts via `export { default as XXX } from './yyy.json' with { type: 'json' };` static-import attributes (`:24-44`).
- **WHEN** the module top-level executes, **THE SYSTEM SHALL** lazily cache the parsed contents of 20 registry JSONs in module-private `cachedXxx` singletons (`:46-66`) and synchronously compute 21 `XXX_VERSION` constants via `readXxx().version` (`:236-255`).
- **WHEN** any `readXxx()` is called, **THE SYSTEM SHALL** parse with `JSON.parse(readFileSync(url, 'utf8'))` and memoise (`:68-234`).

### S2. Service-map / topology accessors

- **WHEN** `listServices()`, `getService(serviceId)`, `listAdapterPorts()`, `getAdapterPort(adapterId)`, `listContracts()`, `getContract(contractId)`, `listInteractionFlows()`, `listAdapterPortsForConsumer(serviceId)`, `listContractsForService(serviceId)` are called, **THE SYSTEM SHALL** return the corresponding section from `internal-service-map.json` (`:261-317`).
- **WHEN** `listEnvironmentProfiles()`, `getEnvironmentProfile(environmentId)`, `listDeploymentPlatforms()`, `getDeploymentContract(contractId)` are called, **THE SYSTEM SHALL** return the corresponding section from `deployment-topology.json` (`:289-303`).
- **WHEN** four service-id constants (`CONTROL_API_SERVICE_ID`, `PROVISIONING_ORCHESTRATOR_SERVICE_ID`, `EVENT_GATEWAY_SERVICE_ID`, `AUDIT_MODULE_SERVICE_ID`) are imported, **THE SYSTEM SHALL** return the literal strings `'control_api'`, `'provisioning_orchestrator'`, `'event_gateway'`, `'audit_module'` (`:256-259`).

### S3. Authorisation-model accessors

- **WHEN** authorisation accessors are called (`listAuthorizationContracts`, `getAuthorizationContract`, `listAuthorizationRoles`, `getAuthorizationRole`, `listEnforcementSurfaces`, `getEnforcementSurface`, `listResourceSemantics`, `getResourceSemantics`, `listResourceActions`, `listPermissionMatrix`, `listContextPropagationTargets`, `getContextPropagationTarget`, `listNegativeAuthorizationScenarios`), **THE SYSTEM SHALL** return the corresponding section from `authorization-model.json` (`:319-387`).

### S4. Public-API and route accessors

- **WHEN** `getPublicApiRelease`, `listApiFamilies`, `getApiFamily`, `listResourceTaxonomy`, `getResourceTaxonomy` are called, **THE SYSTEM SHALL** return the corresponding sections of `public-api-taxonomy.json` (`:389-399, :955-961`).
- **WHEN** `listPublicRoutes`, `getPublicRoute(operationId)`, `filterPublicRoutes(filters)` are called, **THE SYSTEM SHALL** return entries from `public-route-catalog.json.routes`; `filterPublicRoutes` SHALL test array-valued route fields with `includes`, scalar fields with strict equality (`:401-403, :935-953`).

### S5. Observability registry accessors

- **WHEN** any of 41 observability accessors are called (covering metrics stack, dashboards, health checks, audit pipeline/event-schema/query-surface/export-surface/correlation-surface, business-metrics, usage-consumption, quota-policies, threshold-alerts, hard-limit-enforcement, console-alerts, quota-usage-view), **THE SYSTEM SHALL** read from the corresponding `observability-*.json` and return the matching section, defaulting to `[]`, `{}`, or `null` if the section is missing (`:405-933`).
- **WHEN** `getAuditEventSchemaForSubsystem(subsystemId)` is called, **THE SYSTEM SHALL** look up the subsystem first in `subsystems[id]`, then in `subsystem_roster[]` matching `subsystem_id || id`, then in `subsystem_roster[id]` (if object-keyed); when no match is found, **THE SYSTEM SHALL** return the unfiltered schema (`:525-546`).

### S6. Domain-model and lifecycle accessors

- **WHEN** `listDomainContracts`, `getDomainContract`, `listDomainEntities`, `getDomainEntity`, `listDomainRelationships`, `listLifecycleTransitions`, `listLifecycleEvents(entityType?)`, `listBusinessStateMachines`, `getBusinessStateMachine`, `listCommercialPlans`, `getCommercialPlan`, `listQuotaPolicies`, `getQuotaPolicy`, `listDeploymentProfileCatalog`, `getDeploymentProfileCatalogEntry`, `listProviderCapabilityCatalog`, `getProviderCapabilityCatalogEntry`, `listExternalApplicationSupportedFlows`, `getExternalApplicationSupportedFlow`, `listExternalApplicationTemplates`, `getExternalApplicationTemplate`, `listExternalApplicationPlanLimits`, `getExternalApplicationPlanLimit`, `getEffectiveCapabilityResolutionContract`, `getEffectiveCapabilityResolutionDescriptor`, `listPlanChangeScenarios` are called, **THE SYSTEM SHALL** return the corresponding section of `domain-model.json` (`:963-1069`).

### S7. Effective-capability-resolution functions

- **WHEN** `resolveTenantEffectiveCapabilities({tenantId, planId, resolvedAt})` is called, **THE SYSTEM SHALL** look up the commercial plan, derive the quota policy and deployment profile, intersect provider capabilities with `plan.capabilityKeys`, and return `{scope:'tenant', tenantId, planId, deploymentProfileId, quotas[], capabilities[], resolvedAt, correlationContext:{contractVersion, planes[]}}`; SHALL throw `Error('Unknown plan ${planId}.')` if plan is not in the catalogue; SHALL throw `Error('Plan ${planId} is missing quota policy or deployment profile metadata.')` if either lookup is empty (`:1111-1145`).
- **WHEN** `resolveWorkspaceEffectiveCapabilities({tenantId, workspaceId, workspaceEnvironment, planId, resolvedAt})` is called, **THE SYSTEM SHALL** delegate to `resolveTenantEffectiveCapabilities`, filter capabilities by `capability.allowedEnvironments.includes(workspaceEnvironment)`, then return `{scope:'workspace', workspaceId, ...}` (`:1147-1165`).

### S8. Workspace-surface and clone functions

- **WHEN** `resolveWorkspaceApiSurface({workspaceId, workspaceSlug, workspaceEnvironment, iamRealm, applications[]})` is called, **THE SYSTEM SHALL** look up the environment profile (throwing if unknown), build `controlApiBaseUrl`, `consoleBaseUrl`, `identityBaseUrl` (with optional realm), `realtimeBaseUrl`, and an `applicationBaseUrlPattern`; SHALL return the four base URLs as `endpoints[]` plus a per-application `applicationEndpoints[]` with `publicBaseUrl` and `callbackBaseUrl` (`:1183-1239`).
- **WHEN** `resolveWorkspaceResourceInheritance({mode, sourceWorkspaceId, logicalResources})` is called, **THE SYSTEM SHALL** partition resources into `sharedResourceKeys`/`specializedResourceKeys` by `sharingScope === 'tenant_shared' || specializationMode === 'shared'`, then return `{mode, sourceWorkspaceId, logicalResources, sharedResourceKeys, specializedResourceKeys, requiresCloneLineage: mode==='clone_workspace' && Boolean(sourceWorkspaceId)}` (`:1241-1265`).
- **WHEN** `buildWorkspaceCloneDraft({sourceWorkspace, targetWorkspace, clonePolicy})` is called, **THE SYSTEM SHALL** throw `'sourceWorkspace.workspaceId is required to build a clone draft.'` if missing, otherwise merge a fixed clone-policy default (`includeApplications, includeServiceAccounts, includeManagedResourceBindings, resetCredentialReferences, reuseTenantLogicalResources, cloneMetadata` all `true`) (`:1267-1300`).

### S9. Tenant inventory, export, governance dashboard, lifecycle, purge

- **WHEN** `buildTenantResourceInventory({tenant, workspaces, externalApplications, serviceAccounts, managedResources, generatedAt})` is called, **THE SYSTEM SHALL** count resources by `kind` and by `state`, and emit per-workspace breakdowns of `applicationCount`, `serviceAccountCount`, `managedResourceCount`, `resourceKinds`, `resourceStates` (`:1320-1360`).
- **WHEN** `buildTenantFunctionalConfigurationExport(...)` is called, **THE SYSTEM SHALL** wrap the inventory in an export envelope with a fixed `includedSections[]` list and `recoveryArtifacts: [consistency_checkpoint, inventory_summary]`; SHALL derive `exportId` from `tenant.exportProfile.lastExportId` or fall back to `'exp_${tenantId.slice(4)}_snapshot'` (`:1362-1408`).
- **WHEN** `summarizeTenantGovernanceDashboard(...)` is called, **THE SYSTEM SHALL** compute per-limit `quotaAlerts[]` with `severity ∈ {'blocked' (≥100%), 'warning' (≥80%), 'nominal' (<80%)}`, then return the inventory plus `allowedActions` from `getAllowedBusinessTransitions('tenant_lifecycle', tenant.state)` (`:1410-1458`).
- **WHEN** `buildTenantPurgeDraft({tenant, actorUserId, approvalTicket, confirmationText})` is called, **THE SYSTEM SHALL** default `confirmationText` to `'PURGE ${tenantId} ${slug}'`, derive `expectedState='deleted'`, default `requiresElevatedAccess=true` unless `retentionPolicy.purgeRequiresElevatedAccess === false`, and same for `requiresDualConfirmation` (`:1460-1472`).
- **WHEN** `evaluateTenantLifecycleMutation({tenant, action, workspaces, managedResources, now, hasElevatedAccess, hasSecondConfirmation})` is called, **THE SYSTEM SHALL** map `action ∈ {activate, suspend, reactivate, soft_delete, purge}` to a `{currentState, transition}` rule; SHALL block `purge` unless retention has elapsed AND an export checkpoint exists AND `hasElevatedAccess && hasSecondConfirmation`; SHALL compute `descendantImpacts[]` per action (`:1474-1603`).

### S10. Initial-tenant bootstrap

- **WHEN** `resolveInitialTenantBootstrap({tenantId, ownerUserId, workspaceId, workspaceEnvironment, planId, tenantStorageContext, provisioningRunId, lifecycleTrigger, resolvedAt})` is called, **THE SYSTEM SHALL** resolve tenant and workspace effective capabilities, union their `capabilityKeys`, then for each bootstrap template emit a `resourceState` whose `status` is one of `{'pending', 'skipped', 'dependency_wait', 'blocked'}` based on `provisioningMode`, `requiredCapabilityKey`, and (for `default_storage_bucket` only) the `tenantStorageContext.state` / `reasonCode` (`:1605-1731`).
- **WHEN** the special-cased `default_storage_bucket` template has no `tenantStorageContext`, **THE SYSTEM SHALL** return `status: 'dependency_wait'` with `reasonCode: 'CONTEXT_MISSING'`; if context is `suspended`/`soft_deleted` or has `reasonCode: 'CAPABILITY_NOT_AVAILABLE'`, SHALL return `status: 'blocked'`; otherwise `'pending'` (`:1654-1699`).
- **WHEN** the function returns, **THE SYSTEM SHALL** include `ownerBindings: [{tenant_membership/tenant_owner}, {workspace_membership/workspace_owner}]` and `retry: {retryable: false, attemptCount: 0, idempotencyKey: 'signup-activation-${tenantId}-${workspaceId}'}` (`:1701-1730`).

### S11. Plan-change evaluation

- **WHEN** `evaluatePlanChange({fromPlanId, toPlanId, currentUsage, resolvedAt})` is called, **THE SYSTEM SHALL** resolve tenant effective capabilities for both plans, diff capability sets into `addedCapabilities[]`/`removedCapabilities[]`, walk only `toQuotaLimits` to build `quotaDelta[]`, flag any metric where `currentUsage[metricKey] > nextLimit.limit` as `blockingMetrics[]`, and return `status ∈ {'compatible', 'requires_remediation'}` (`:1733-1767`).

---

## GAPS

### G1. The package alias is dead

- The `package.json` declares `name: '@in-falcone/internal-contracts'` (`package.json:2`), but **zero importers use the alias.** Verified by `grep "from '@in-falcone/internal-contracts'"` returning 0 hits across `apps/`, `services/`, `packages/`. All **50 production importers** use relative paths instead — at least 4 distinct depth conventions:
  - `'../../internal-contracts/src/index.mjs'` (from sibling services)
  - `'../../../services/internal-contracts/src/index.mjs'` (from `apps/control-plane/src/`)
  - `'../../../../services/internal-contracts/src/index.mjs'` (from `apps/control-plane/src/workflows/`)
  - direct JSON paths like `'../../../services/internal-contracts/src/manual-intervention-required-event.json'`
- The pnpm workspace registration is therefore decorative. Renaming the package, changing its export-conditions, or relocating it would break nothing through the alias but break 50 files through path drift.

### G2. The package has no tests, lint, or typecheck

- `package.json:7-11`: `lint`, `test`, `typecheck` are all `node -e "console.log('… placeholder')"`. **The contract registry that 50 importers depend on has zero self-tests.** Some assertions exist in the consumer test suite (`tests/unit/service-map.test.mjs`, `tests/contracts/internal-service-map.contract.test.mjs`), but they assert *what the registry returns now*, not invariants the registry must uphold.

### G3. Mixed-shape contract directory with two distinct conventions

- 55 JSON files live side-by-side in `src/`. **22 carry a top-level `version` field** and are consumed as "versioned registries". **33 carry no top-level `version`** (verified with the per-file `head -5 | grep version` sweep) and are JSON-Schema payload definitions.
- The module's `XXX_VERSION` constants at `:236-255` assume every registry JSON has `.version`. If any registry-style JSON is missing or renamed, the top-level `const ... = readXxx().version` throws at *import time*, preventing any consumer from loading the package.
- The mixed convention is undocumented. There is no naming or sub-directory split between "registry contracts" and "event-payload schemas".

### G4. Version drift between registry JSONs

- Five distinct versions across the registry as of audit:
  - `2026-03-24` — authorization-model.json, deployment-topology.json, domain-model.json
  - `2026-03-25` — internal-service-map.json
  - `2026-03-26` — public-api-taxonomy.json, public-route-catalog.json (`release.header_version`)
  - `2026-03-28` — **all 15 observability-*.json** (audit-correlation-surface, audit-event-schema, audit-export-surface, audit-pipeline, audit-query-surface, business-metrics, console-alerts, dashboards, hard-limit-enforcement, health-checks, metrics-stack, quota-policies, quota-usage-view, threshold-alerts, usage-consumption)
- `observability-quota-usage-view.json` *self-declares* its dependence on `source_authorization_contract: '2026-03-24'` and `source_public_api_contract: '2026-03-26'`. There is no validator that enforces these source-version anchors remain consistent — the observability layer can silently drift ahead while still declaring an older anchor, with no compile-time or load-time signal.

### G5. `public-route-catalog.json` has a non-uniform `version` shape

- The file has no top-level `version`; its semantic version is nested under `release.header_version` (`public-route-catalog.json:1-7`). The module does *not* compute a `PUBLIC_ROUTE_CATALOG_VERSION` constant; there is no parity with `PUBLIC_API_VERSION`. Consumers depending on a consistent "every registry has a `_VERSION`" interface get a silent miss for routes.

### G6. Hard-coded `'2026-03-24T00:00:00Z'` default in 8 function signatures

- `:1111` (`resolveTenantEffectiveCapabilities.resolvedAt`),
  `:1152` (`resolveWorkspaceEffectiveCapabilities.resolvedAt`),
  `:1326` (`buildTenantResourceInventory.generatedAt`),
  `:1368` (`buildTenantFunctionalConfigurationExport.generatedAt`),
  `:1416` (`summarizeTenantGovernanceDashboard.generatedAt`),
  `:1479` (`evaluateTenantLifecycleMutation.now`),
  `:1622` (`resolveInitialTenantBootstrap.resolvedAt`),
  `:1733` (`evaluatePlanChange.resolvedAt`).
- A caller who omits the timestamp gets **frozen-clock semantics in production**. `evaluateTenantLifecycleMutation` at `:1526` uses `now` to compute `retentionReady = !purgeEligibleAt || new Date(purgeEligibleAt).getTime() <= new Date(now).getTime()` — i.e. if the caller drops `now`, retention windows are evaluated against `2026-03-24T00:00:00Z`. This silently grants purge eligibility for any tenant whose `purgeEligibleAt` is ≤ that date — see B2.

### G7. Hard-coded `'in-falcone.example.com'` hostname in URL builder

- `:1177`: `return https://${workspaceSlug}.apps.${workspaceEnvironment}.in-falcone.example.com/${applicationSlug};`. This is the workspace-subdomain branch of `getWorkspaceApplicationBaseUrl`. **Every workspace public URL routed through this branch hits a non-routable example.com domain.** The other branch at `:1180` uses `environmentProfile.hostnames.api` which is sourced from `deployment-topology.json`; only the subdomain branch is literal.

### G8. No null-safety on registry lookups

- `resolveTenantEffectiveCapabilities` calls `plan.capabilityKeys.includes(...)` at `:1131`; if `plan.capabilityKeys` is undefined, `.includes` throws TypeError.
- `resolveWorkspaceEffectiveCapabilities` calls `capability.allowedEnvironments.includes(...)` at `:1156`; same TypeError risk if `allowedEnvironments` is undefined for any capability.
- `evaluatePlanChange` at `:1738-1739` reads `getCommercialPlan(fromPlanId).quotaPolicyId` directly; while `resolveTenantEffectiveCapabilities` already threw if the plan was missing, the redundant lookup is undefended against a race where the registry mutates mid-call (theoretical with the cache layer).

### G9. `evaluatePlanChange` ignores `from`-only quota metrics

- The loop at `:1745-1755` walks **only `toQuotaLimits`.** Quota metrics present in `from` but absent in `to` are silently dropped from `quotaDelta`. Downstream consumers cannot tell that a plan downgrade removed an entire quota dimension.

### G10. `evaluateTenantLifecycleMutation.purge` retention gate is fail-open

- `:1524-1527`: `const retentionReady = !purgeEligibleAt || new Date(purgeEligibleAt).getTime() <= new Date(now).getTime();`. **If `purgeEligibleAt` is missing on `governance.retentionPolicy`, retention is treated as ready.** A tenant with no retention policy can be purged immediately, contrary to the stated design.

### G11. `evaluateTenantLifecycleMutation` accepts boolean flags as caller assertions

- `:1480-1481, :1548`: `hasElevatedAccess`, `hasSecondConfirmation` are bare booleans the caller passes. There is no IAM check, no challenge/response, no validation against an approval ticket. A caller can pass `true, true` to authorise a purge regardless of actor identity. The function name "evaluate" suggests defensive evaluation; the implementation is a rubber stamp.

### G12. `buildTenantPurgeDraft.confirmationText` is never verified

- `:1465`: builds an expected confirmation text (`'PURGE ${tenantId} ${slug}'`). `evaluateTenantLifecycleMutation.purge` never compares the caller-supplied text against this draft. The draft is an opening-formality artifact that nothing enforces.

### G13. `countBy` skips falsy keys silently

- `:1308-1313`: `if (!key) return counts;`. Resources with `state: ''`, `kind: 0`, or any falsy classifier are silently dropped from inventory counts. Downstream "resourceStates" totals may understate.

### G14. `sumQuotaUsage` is undefended

- `:1316-1318`: `workspaceSubquotas = []` default; `subquota.used ?? 0` for missing field. **But** the surrounding `summarizeTenantGovernanceDashboard` at `:1429` calls it with `quotaProfile.workspaceSubquotas` only when `limit.scope === 'workspace'` — if `quotaProfile` is undefined, the default at `:1426` makes it `{limits:[], workspaceSubquotas:[], governanceStatus:'nominal'}`. Safe in the common case.

### G15. `evaluatePlanChange` dead-conditional ternary

- `:1738-1739`: `getQuotaPolicy(fromResolution.planId ? getCommercialPlan(fromPlanId).quotaPolicyId : undefined)`. Because `resolveTenantEffectiveCapabilities` would have thrown if the plan were unknown, `fromResolution.planId` is always truthy on this line. The `: undefined` branch is dead code; the surrounding `if (fromResolution.planId)` adds nothing.

### G16. Cross-package contract imports use four different relative-path depths

- The contract-boundary file in `services/provisioning-orchestrator/src/contract-boundary.mjs:1-21` imports:
  - `../../internal-contracts/src/index.mjs` (the registry)
  - `../../../tests/contracts/schemas/idempotency-key-record.json` (and 4 more, from `tests/`)
  - `../../../services/internal-contracts/src/failure-classified-event.json` (and 3 more, from the registry directory but via a longer path than the first import)
- **Production code imports schemas from `tests/contracts/schemas/`.** Test fixtures and registry contracts share the same `with { type: 'json' }` import idiom but live in two unrelated directories. There is no single source of truth.

### G17. `getAuditEventSchemaForSubsystem` has three lookup branches and a silent fallback

- `:525-546`: tries `schema.subsystems[id]`, then `schema.subsystem_roster.find(entry => entry.subsystem_id === id || entry.id === id)`, then `schema.subsystem_roster[id]` (object-keyed). If none match, returns the **unfiltered top-level schema** — meaning a typo'd subsystem id silently returns the full schema rather than `null` or undefined.

### G18. Stale workspace OpenAPI version export is unused by versioning logic

- `:37`: `export { default as workspaceOpenApiVersion } from './workspace-openapi-version.json'`. Per the J1 audit, OpenAPI versioning logic lives in `apps/control-plane/src/openapi-builder.*`, not here. This contract is exported but is not consumed by any version-derivation code in the registry.

### G19. `getEffectiveCapabilityResolutionContract` and `getEffectiveCapabilityResolutionDescriptor` return different shapes for nominally-related queries

- `:1059-1065`: `Contract` returns `readDomainModel().contracts.effective_capability_resolution` (a versioned contract definition with `owner`, `version`, `required_fields`); `Descriptor` returns `readDomainModel().effective_capability_resolution` (the resolution algorithm description with `layers[]`). The two are colocated in `domain-model.json` and named similarly but answer different questions; a caller could easily reach for the wrong one.

### G20. `INTERNAL_CONTRACT_VERSION` is misleadingly named

- `:236`: `export const INTERNAL_CONTRACT_VERSION = readInternalServiceMap().version;`. It is the version of `internal-service-map.json` (one of 22 registries), not "the contract version". A consumer believing this is *the* version of the internal-contracts package will silently lock to whatever version internal-service-map happens to be at (currently `'2026-03-25'`), unaware that authorization-model is at `'2026-03-24'` and observability is at `'2026-03-28'`.

### G21. Module-load cost

- The top-level constants at `:236-255` and the `XXX_VERSION` assignments force synchronous `JSON.parse(readFileSync(...))` for **20 JSON files at every import** of this module. With 50 importers and Node's per-module evaluation guarantee, this is a single one-time cost, but the eager parsing also means a malformed JSON anywhere in `src/` blocks the whole platform from booting.

---

## BUGS

### Confirmed (verified-by-author from cited lines)

- **B1. `getWorkspaceApplicationBaseUrl` returns an `example.com` hostname for any environment listed in `optional_workspace_subdomain.allowed_environments`.**
  `services/internal-contracts/src/index.mjs:1177`: `return https://${workspaceSlug}.apps.${workspaceEnvironment}.in-falcone.example.com/${applicationSlug};`. The other branch at `:1180` correctly uses `environmentProfile.hostnames.api`. **Every workspace whose environment is in the allow-list gets a non-routable URL.** This is the same `*.example.com` placeholder family flagged in the F2 (realtime), F3 (webhooks) and N1 (gateway) audits, and confirms the placeholder hostname pattern is platform-wide, not localised to one capability.

- **B2. `evaluateTenantLifecycleMutation.purge` is fail-open when `purgeEligibleAt` is missing.**
  `index.mjs:1524-1527`: `const retentionReady = !purgeEligibleAt || new Date(purgeEligibleAt).getTime() <= new Date(now).getTime();`. Missing-field semantics: `!undefined === true`, so retention is treated as ready. Combined with G6 (frozen-clock fallback) and G11 (caller-supplied authorisation flags), a caller passing `{action:'purge', hasElevatedAccess:true, hasSecondConfirmation:true}` to a tenant with no retention policy passes the gate trivially.

- **B3. The `@in-falcone/internal-contracts` package name is dead.**
  `package.json:2` declares the name; **`grep "from '@in-falcone/internal-contracts'"` returns 0 hits across the repo.** All 50 importers use relative paths. The package alias is unenforced; replacing the package name or moving the package directory would not break any production importer (but moving the directory would break all 50).

- **B4. Eight production-facing functions default to a hard-coded `'2026-03-24T00:00:00Z'` timestamp.**
  `index.mjs:1111, :1152, :1326, :1368, :1416, :1479, :1622, :1733`. A caller who forgets the `resolvedAt`/`generatedAt`/`now` arg gets frozen-clock semantics. Three of these (`evaluateTenantLifecycleMutation.now`, `resolveInitialTenantBootstrap.resolvedAt`, `evaluatePlanChange.resolvedAt`) affect mutation eligibility, idempotency-key derivation, and quota-limit comparisons respectively.

- **B5. `idempotencyKey` for initial-tenant bootstrap is derived from caller args without a clock.**
  `index.mjs:1728`: `idempotencyKey: 'signup-activation-${tenantId ?? 'tenant'}-${workspaceId ?? 'workspace'}'`. If `tenantId` or `workspaceId` is null/undefined, the key collides on `'signup-activation-tenant-workspace'` for every caller in that state. A retry storm with missing context produces a single shared key — the idempotency contract collapses.

- **B6. `public-route-catalog.json` lacks a top-level `version`.**
  `public-route-catalog.json:1-7` — `version` is nested under `release.header_version`. The registry module reads versions from 21 other JSONs at `:236-255` but silently has no `PUBLIC_ROUTE_CATALOG_VERSION` export. A consumer trying to enforce a route-catalog version with `getPublicRoute(...).contract_version` would receive `undefined`.

- **B7. The registry mixes "versioned registries" and "schema payloads" in one directory with no naming convention to distinguish them.**
  33 of 55 JSON files have no top-level `version`; 22 do. The 33 schemas are valid JSON Schema documents; the 22 registries are version-stamped contract collections. The module shape (`readXxx().version` at module load) assumes the second pattern. If a contributor renames a schema to look like a registry filename, the next import would crash on `readXxx().version` if it had been wired into the `XXX_VERSION` block.

- **B8. Hostname-collision risk for workspaces with same slug in different environments.**
  `index.mjs:1177` — workspace subdomain is `${workspaceSlug}.apps.${workspaceEnvironment}.<base>`. The slug+environment tuple defines uniqueness. If two tenants both have a workspace with slug `'main'` in the same environment, the URL collides. There is no tenant qualifier in the subdomain.

- **B9. `getAuditEventSchemaForSubsystem` returns the full schema on miss, not null.**
  `index.mjs:525-546`. A typo'd `subsystemId` silently returns the unfiltered schema — a caller iterating its `event_types` field on the unfiltered schema may process audit events for unrelated subsystems.

### Likely

- **B10. `INTERNAL_CONTRACT_VERSION` is misleadingly named and locked to a single registry.**
  `index.mjs:236`. Constants of this name typically mean "the version of the package itself"; here it returns whatever `internal-service-map.json` declares (currently `'2026-03-25'`). Consumers asserting compatibility against this constant pass even when other registries have drifted to `'2026-03-28'`. Reuse-by-confusion.

- **B11. `evaluatePlanChange` silently drops quota metrics present only in `fromPlan`.**
  `index.mjs:1745`: loop iterates only `toQuotaLimits.entries()`. A plan downgrade that removes a quota dimension never shows in `quotaDelta` and cannot block the change — the dropped metric becomes invisible to the caller, who may assume "no removed dimension" means "safe".

- **B12. `evaluatePlanChange` falsely reports `'compatible'` if either plan has no quota policy.**
  `index.mjs:1738-1739, :1071-1073`. `indexQuotaLimits(undefined)` returns an empty Map. The `for…of toQuotaLimits.entries()` then yields zero iterations, no `blockingMetrics`, status `'compatible'`. A plan with a missing quotaPolicy passes plan-change evaluation regardless of current usage.

- **B13. `resolveWorkspaceEffectiveCapabilities` will TypeError on capabilities missing `allowedEnvironments`.**
  `index.mjs:1156`: `capability.allowedEnvironments.includes(workspaceEnvironment)`. If any provider capability in the catalogue has no `allowedEnvironments` field, the filter throws. There is no defensive `?? []`.

- **B14. `countBy` silently swallows resources with falsy classifier values.**
  `index.mjs:1308-1313`. Resources with `state: ''` or `kind: 0` are skipped from `resourcesByKind`/`resourcesByState`. Inventory totals may appear lower than actual.

- **B15. `evaluateTenantLifecycleMutation` accepts the caller's authorisation assertions verbatim.**
  `index.mjs:1480-1481, :1548-1556`. `hasElevatedAccess` and `hasSecondConfirmation` are uninspected booleans. This is by design (per the function name, "evaluate") — but downstream call sites must wire IAM lookups themselves; this audit cannot verify any caller does so. The function does not log, audit, or otherwise record that authorisation came from outside it.

- **B16. `buildTenantPurgeDraft.confirmationText` is decorative.**
  `index.mjs:1460-1471` generates an expected text; `evaluateTenantLifecycleMutation` never compares against it. Any caller-supplied text passes the lifecycle gate.

- **B17. `resolveInitialTenantBootstrap` defaults `provisioningRunId` to literal `'prn_bootstrappreview'`.**
  `index.mjs:1620`. If multiple bootstrap evaluations omit the arg, the audit/correlation key collides on the same run id.

- **B18. `'signup-activation-${tenantId}-${workspaceId}'` idempotency key collides across plans for the same workspace.**
  `index.mjs:1728`. Two bootstraps for the same workspace on different plans produce the same key. If the system uses the key for dedup, a plan change during onboarding is silently dropped.

- **B19. `evaluatePlanChange` reuses `getCommercialPlan` twice for the same plan id.**
  `index.mjs:1738-1739`. Already verified by the `resolveTenantEffectiveCapabilities` call above; the second lookup adds cost and a redundant TypeError surface if the cache is concurrently invalidated.

### Needs verification (requires running code)

- **B20. With `with { type: 'json' }` import attributes, Node runtime version matters.**
  21 import sites at `index.mjs:24-44, :115-…`. This ES2025 syntax requires Node ≥ 22.12 stable. If any deploy target runs Node 20 LTS with `--experimental-json-modules` or the older `assert { type: 'json' }`, every import fails at parse time. Confirm the runtime baseline.

- **B21. Whether `tests/contracts/schemas/*.json` is the same JSON the registry exports.**
  `services/provisioning-orchestrator/src/contract-boundary.mjs:9-14` imports five `tests/contracts/schemas/*.json` schemas (idempotency-key-record, retry-attempt, async-operation-retry-request, async-operation-retry-response, idempotency-dedup-event) — but `idempotency-dedup-event.json` *also* exists in `services/internal-contracts/src/idempotency-dedup-event.json` and is re-exported as `idempotencyDedupEventSchema` (`index.mjs:28`). Verify whether the two files agree byte-for-byte or have silently drifted.

- **B22. Whether `INTERNAL_CONTRACT_VERSION` is actually consumed anywhere.**
  Exported at `:236` but the audit did not enumerate consumers. If no one reads it, it is dead. If anyone reads it as "the registry version", they are wrong (B10).

- **B23. Whether downstream consumers handle the "unfiltered schema on miss" semantics of `getAuditEventSchemaForSubsystem` correctly.**
  `index.mjs:525-546`. Per the M1 audit, audit consumers expect a per-subsystem envelope; receiving the full schema silently is a likely defect.

- **B24. Whether `buildWorkspaceCloneDraft.targetWorkspace.resourceInheritance` defaults to `mode: 'clone_workspace'`.**
  `index.mjs:1291-1297` falls back to `resolveWorkspaceResourceInheritance({mode:'clone_workspace', sourceWorkspaceId, logicalResources: sourceWorkspace.resourceInheritance?.logicalResources ?? []})`. If `sourceWorkspace.resourceInheritance` is undefined, this clones zero logical resources — likely-correct but worth confirming against the lifecycle policy.

- **B25. Whether the registry's `cached*` singletons can leak stale state across hot reloads.**
  `index.mjs:46-66`. Standard Node module-level caching; harmless under fresh process start, but if any consumer (e.g., a dev-server with HMR) tries to swap a registry JSON without restarting, the cache hides the change. Per G2 there are no tests asserting this behaviour.

---

## Scope note for downstream spec authoring

The internal-contracts registry is **the load-bearing data-store for cross-service shape and policy in this monorepo**. It is consumed by:
- the control-plane façades (every `apps/control-plane/src/*.mjs` registry-binding file),
- the provisioning orchestrator (`contract-boundary.mjs`),
- the event gateway and audit-module boundaries,
- the web-console (`apps/web-console/src/actions/*`),
- and indirectly the tests folder (`tests/contracts/`, `tests/unit/service-map.test.mjs`).

The audit shows **three structural defects** that any OpenSpec proposal touching contracts should resolve before adding new shapes:

1. **The alias is dead (B3) and depth-of-import varies (G16).** Either remove the package name, or commit to it and rewrite all 50 importers to use it. Today's middle ground is the worst of both worlds: renaming or moving the directory breaks everything; renaming the alias breaks nothing.

2. **Versions drift between sibling registries (G4, B6, B10).** There is no single "contract version" — there are 22 registries with 5 distinct dates, plus 33 schemas with no versioning at all. The exported `INTERNAL_CONTRACT_VERSION` constant is the version of one registry pretending to speak for the whole package.

3. **The registry hosts non-trivial business logic that no test exercises (G2, B2, B11, B12, B15).** `evaluateTenantLifecycleMutation`, `evaluatePlanChange`, `resolveInitialTenantBootstrap`, and `buildTenantPurgeDraft` together control purge eligibility, plan migration, signup bootstrap, and tenant destruction. They live in a package whose own test suite is three `console.log` placeholders. The fact that the registry conflates "static contract definitions" with "evaluator functions" is the structural reason these defects exist where they do.

The cleanup is invasive but the surface is contained: one entry module, 55 JSON files, 50 importers. After it, O2 is a clean cross-service registry. Until then, every cross-service spec rests on a package whose own `lint`/`test`/`typecheck` are `console.log`.
