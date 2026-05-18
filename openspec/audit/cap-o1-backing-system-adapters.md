# Capability O1 — Backing System Adapters

**Source locus:** `services/adapters/src/` — **25 `.mjs` files, ~23,095 LOC** + README (25 LOC).

| Provider | File(s) | LOC | Audited in |
|---|---|---|---|
| **PostgreSQL** | postgresql-{admin,data-api,governance-admin,structural-admin}.mjs | ~7,277 | **D1** |
| **MongoDB** | mongodb-{admin,data-api}.mjs | ~4,478 | **E1** |
| **Storage (S3-compatible)** | 14 storage-*.mjs + provider-catalog.mjs | ~8,048 | **G1** |
| **OpenWhisk** | openwhisk-admin.mjs | 1,812 | **H1** |
| **Kafka** | kafka-admin.mjs | **909** | **this audit** |
| **Keycloak (IAM)** | keycloak-admin.mjs | **571** | **this audit** |
| **Shared authz** | authorization-policy.mjs | 18 | this audit (cross-cutting) |

**Method.** Confirmed prior audits cover PostgreSQL (D1), MongoDB (E1), Storage (G1), OpenWhisk (H1). Read `README.md`, the 18-LOC `authorization-policy.mjs`, and verified line counts for the two uncovered providers myself. Delegated `kafka-admin.mjs` (909 LOC) and `keycloak-admin.mjs` (571 LOC) to two parallel Explore agents. After agents returned, **spot-verified four damaging claims** directly:
- Kafka ACL principal prefix is `startsWith()` — verified at `:419`.
- Kafka `resolveKafkaAdminProfile` accepts `tenantId/workspaceId` from payload as fallback — verified at `:475`.
- Keycloak hard-codes contract version `'2026-03-24'` fallback in two places — verified at `:152, :510`.
- Keycloak adapter call envelope includes raw `providerPayload: payload` — verified at `:506`.

Plus the cross-cutting finding: `grep -rln "authorization-policy" services/adapters/src/` returns **only the README**. Zero adapter `.mjs` files import the shared module declared by the README as "the adapter-facing enforcement surfaces and projection targets for contextual authorization".

This audit synthesises **the cross-cutting picture** for the adapter layer as a whole, plus drills into the two uncovered providers (Kafka, Keycloak). For per-provider depth, see the individual capability audits.

---

## SPEC (what exists)

### S0. Provider catalogue (`README.md`)

- **WHEN** the directory's intent is consulted, **THE SYSTEM SHALL** declare 6 baseline providers: Keycloak, PostgreSQL, MongoDB, Kafka, OpenWhisk, storage; each adapter SHALL expose a narrow contract; provider-specific code stays isolated from domain logic; retries, timeouts, credential handling explicit; shared provider-port metadata flows from `provider-catalog.mjs`; propagated tenant/workspace authorization context remains explicit and scoped (`README.md:1-25`, verified-by-author).

### S1. Shared authorization-policy contract (`authorization-policy.mjs`)

- **WHEN** the module is imported, **THE SYSTEM SHALL** re-export 3 contract collections from `services/internal-contracts/`: `adapterEnforcementSurfaces` (filtered to `{data_api, functions_runtime, event_bus, object_storage}`), `adapterContextTargets` (filtered to `{adapter_call, kafka_headers, openwhisk_activation, storage_presign_context}`), `workspaceOwnedResourceSemantics` (filtered to `parent_scope = 'workspace'`) (`authorization-policy.mjs:1-19`, verified-by-author).

### S2. Kafka admin adapter (`kafka-admin.mjs`, 909 LOC)

- **WHEN** the module is loaded, **THE SYSTEM SHALL** declare `KAFKA_ADMIN_RESOURCE_KINDS = ['topic', 'topic_acl']` and a 5-action capability matrix per kind (`:9-13`, subagent-reported).
- **WHEN** ACL configuration is built, **THE SYSTEM SHALL** restrict operations to `['read, write, describe, describe_configs, idempotent_write]`, pattern types to `['literal', 'prefixed']`, isolation modes to `['shared_cluster', 'dedicated_cluster']` (`:14-20`).
- **WHEN** Kafka version is checked, **THE SYSTEM SHALL** accept only 3.6.x/3.7.x/3.8.x with KRaft mode required (`:24-46, :256-265`).
- **WHEN** plan-tier quotas are resolved, **THE SYSTEM SHALL** map starter → 0 topics, growth → 20 topics + 12 partitions/topic + 800 publishes/s + 600 subscriptions, enterprise → 200 / 64 / 5000 / 4000 (`:72-91`).
- **WHEN** topic prefix is built, **THE SYSTEM SHALL** use `ia.<tenant>.<workspace>.<environment>` and consumer-group prefix `cg.ia.<tenant>.<workspace>.<environment>`, service-account principal prefix `User:svc_<workspace>_` (`:163-178, :287-305`).
- **WHEN** topic names are validated, **THE SYSTEM SHALL** require `/^[a-z0-9][a-z0-9._-]{2,119}$/` and forbid user input starting with the managed prefix (`:374-380`).
- **WHEN** ACL bindings are validated, **THE SYSTEM SHALL** require every principal to `startsWith(serviceAccountPrincipalPrefix)`, operations ⊆ allowed list, patternType ∈ `{literal, prefixed}`, literal-bindings target the exact managed topic, prefixed-bindings stay under the topic prefix (`:412-447`).
- **WHEN** `validateKafkaAdminRequest({resourceKind, action, context, payload})` runs, **THE SYSTEM SHALL** return `{ok, violations[], quotaDecision?, profile}` with quota decisions emitted on `topic.create` if used ≥ max (`:474-511`).
- **WHEN** audit events are built, **THE SYSTEM SHALL** emit `eventType: 'kafka.admin.reconciled'` with `actorId, actorType, originSurface, aclSummary, brokerMode, quotaStatus` (`:630-673`).
- **WHEN** errors are mapped, **THE SYSTEM SHALL** translate 404 → not_found, 409 → conflict, 429 → quota_exceeded, 504 → timeout, with `EVT_KAFKA_*` error codes (`:93-103, :867-894`).
- **WHEN** stubs (e.g., `createTopicNamespace`) are called, **THE SYSTEM SHALL** throw `NOT_YET_IMPLEMENTED` (`:905-909`).

### S3. Keycloak admin adapter (`keycloak-admin.mjs`, 571 LOC)

- **WHEN** the module is loaded, **THE SYSTEM SHALL** declare `IAM_ADMIN_RESOURCE_KINDS = ['realm', 'client', 'role', 'scope', 'user']` and a per-kind capability matrix (5–8 actions) (`:84-88`, subagent-reported).
- **WHEN** reserved-name policy is applied, **THE SYSTEM SHALL** reject realms `∈ {master, in-falcone-platform}` (bypass if `context.scope === 'platform'`), reject roles in a 13-entry baseline list (`platform_admin, platform_operator, …, workspace_service_account`; bypass for platform scope), reject scopes `∈ {openid, profile, email, roles, web-origins}` with **no bypass** (`:22-39, :301-308, :416`, subagent-reported).
- **WHEN** Keycloak version is supported, **THE SYSTEM SHALL** match against `SUPPORTED_KEYCLOAK_VERSION_RANGES` (subagent-reported).
- **WHEN** clients are validated, **THE SYSTEM SHALL** enforce `clientId.startsWith(context.workspaceClientNamespace)` if a namespace is declared, reject redirect URIs containing `*` or `*/`, require SAML clients to declare a signing certificate (`:374, :362-368, :395`).
- **WHEN** users are validated, **THE SYSTEM SHALL** enforce minimum temporary-password length 12 chars (no charset/entropy check), block deactivation of `service-account-*` users (`:456, :452`).
- **WHEN** `normalizeKeycloakAdminResource` runs, **THE SYSTEM SHALL** project realm/client/role/scope/user into BaaS-native shapes carrying `providerCompatibility = {provider: 'keycloak', contractVersion: iamAdminRequestContract?.version ?? '2026-03-24', supportedVersions}` (`:149, :152`, verified-by-author).
- **WHEN** `buildIamAdminAdapterCall(...)` runs, **THE SYSTEM SHALL** return an envelope with `payload.providerPayload = payload` (raw caller payload echoed unchanged; verified-by-author at `:506`) plus `contract_version` defaulted to `'2026-03-24'` if the contract is unloaded (verified-by-author at `:510`).
- **WHEN** errors are mapped, **THE SYSTEM SHALL** apply `ERROR_CODE_MAP` to translate Keycloak HTTP codes to `GW_IAM_*` codes; unmapped errors default to `'dependency_failure'` (`:91-101, :265`).
- **WHEN** stubs (`createRealm`, `createClient`, `assignRole`, `createServiceAccount`, `updateServiceAccountScopeBindings`, `regenerateServiceAccountCredentials`, `disableServiceAccount`, `deleteServiceAccount`, `generateClientCredential`, `rotateClientCredential`, `revokeClientCredential`) are called, **THE SYSTEM SHALL** throw `NOT_YET_IMPLEMENTED` (`:529-571`).

### S4. Cross-cutting adapter pattern

- **WHEN** any of the 25 adapter `.mjs` files is loaded, **THE SYSTEM SHALL** expose pure compilers/validators that:
  1. accept `{resourceKind, action, context, payload}` shape;
  2. return `{ok, violations[], profile}` or a normalised envelope;
  3. never open provider connections (no `pg.Pool`, no `MongoClient`, no `KafkaJS Kafka`, no Keycloak admin client in the adapter `.mjs` files themselves — only in the callers in `apps/control-plane/src/`).
- **WHEN** any adapter normalises a resource, **THE SYSTEM SHALL** stamp `providerCompatibility = {provider, contractVersion, supportedVersions}` (verified across all 6 providers per prior audits).
- **WHEN** any adapter builds an audit envelope, **THE SYSTEM SHALL** include `actor_id, actor_type, origin_surface, scopes, effective_roles, authorization_decision_id` from the caller (pass-through, not validated).

---

## GAPS

### G-cross. Cross-cutting (verified across all adapter audits)

1. **`authorization-policy.mjs` is exported but consumed by zero adapter files.** Verified by `grep -rln "authorization-policy" services/adapters/src/` → only the README. The shared adapter authorization contract that the README declares as "the adapter-facing enforcement surfaces and projection targets for contextual authorization" is dead. This was flagged independently by D1, E1, G1, H1 audits; O1 confirms the cross-cutting absence.
2. **Adapters trust caller-supplied authorization context.** Across all 6 providers, `scopes`, `effectiveRoles`, `authorization_decision_id`, `actor_id` are accepted from `buildXxxAdapterCall(payload)` and threaded into the envelope without validation. The adapters compile decisions; they don't verify them.
3. **All 6 providers are "compilers" — execution is the caller's job.** No adapter `.mjs` file in this directory opens a connection or calls a remote API. Production execution glue is **not in this repo for any provider** (kafka-admin, keycloak-admin have explicit `NOT_YET_IMPLEMENTED` stubs at `kafka-admin.mjs:905-909` and `keycloak-admin.mjs:529-571`; the other 4 providers were similar per their audits).
4. **Hard-coded contract-version fallback strings vary across adapters.** D1's PostgreSQL admin uses `'2026-03-24'` (façade), E1's Mongo and Kafka both reference `'2026-03-25'`, H1's OpenWhisk uses `'2026-03-25'`, Keycloak uses `'2026-03-24'`. Three different dates across one capability boundary; per the F1 / M1 audits the same drift exists at the contract layer.
5. **Plan-tier resolution is consistent in pattern but inconsistent in failure mode.** All six providers use `derivePlanTier(planId)` with case-insensitive substring match; unknown plans default to `'starter'` with no log. F1 audit (B1), H1 audit (B11), E1 audit (B11), G1 audit (B11) and this Kafka audit (B3) all flag the same silent-downgrade.
6. **Tenant/workspace context is overridable from payload.** Kafka adapter `:475` (verified-by-author) — `tenantId: context.tenantId ?? payload.tenantId`. The same pattern flagged in H1 (workspace-secret context override at `:813`, H1 B1), and in E1 (Mongo collection prefix bug, E1 B1). A payload that supplies tenant/workspace ids overrides intended scope.
7. **`providerPayload` echoed in adapter call envelopes.** Keycloak `:506` (verified-by-author): `providerPayload: payload`. If a payload contains `clientSecret`, `signingCertificatePem`, or any sensitive material, it is included in the audit envelope. Per the secret-audit-pipeline audit (M2 B6), the forbidden-field policy in the repo is fragmented (3 different policies); none of the adapter envelopes apply a sanitiser.
8. **No tests exist in this directory.** Tests live under `tests/adapters/`, `tests/unit/`, etc. (per prior audits); the adapter directory itself has no inline test files.
9. **README claims "retries, timeouts, and credential handling must remain explicit"** (`README.md:9`). Per inspection, the adapters declare no retry/timeout policy — those are the caller's responsibility. The promise is aspirational.

### G-S2. Kafka admin

- **G-S2.1** Zero authorization enforcement (subagent-reported). Module passes `scopes/effectiveRoles/authorizationDecisionId` through to envelope without checking (`:514-515, :722, :754`).
- **G-S2.2** Plan-tier silent downgrade to `'starter'` for unrecognized planId (`:148-157`).
- **G-S2.3** Tenant/workspace can be supplied via payload (verified-by-author at `:475`) — see B1.
- **G-S2.4** ACL principal prefix check is `startsWith()` only — see B2.
- **G-S2.5** Topic-name slugify can collide: `slugify()` strips non-alphanumerics; `'alpha-beta'` and `'alpha--beta'` both normalize to `alpha.beta` (subagent-reported `:135-142, :163-169`).
- **G-S2.6** Hard-coded `'aud_${callId.slice(-16)}'` audit-record id with `'evt01'` default fallback — collision risk (`:655`).
- **G-S2.7** `createTopicNamespace()` stub exported (`:905-909`) — callers can invoke and get `NOT_YET_IMPLEMENTED` at runtime.
- **G-S2.8** Topic capability silently enabled if `quotaResolution.limit > 0`, even on starter tier where the plan default is 0 (`:281`).
- **G-S2.9** `deriveEnvironment` (`:159-161`) maps only `{dev, sandbox, staging, prod}`; unknown values silently default to `'dev'` — see B5.
- **G-S2.10** ACL deduplication key (`:442`) doesn't include `patternType` — duplicate `literal` vs `prefixed` bindings on the same (principal, resource, ops) can both be emitted.

### G-S3. Keycloak admin

- **G-S3.1** Zero authorization enforcement (no `authorization-policy.mjs` import, confirmed via grep).
- **G-S3.2** `scopes` and `effectiveRoles` passed through unchecked (`:480-481, :514-515`).
- **G-S3.3** **Reserved-scope policy asymmetric.** `validateIamAdminRequest` blocks reserved scope names on `scope` resource (`:416`), but realms (`:307-308`) and clients (`:335-336`) can list reserved scope names in `defaultScopes`/`optionalScopes` without violation. See B6.
- **G-S3.4** Default contract version fallback `'2026-03-24'` at two sites (verified-by-author at `:152, :510`).
- **G-S3.5** Temporary-password policy: only length ≥ 12 (`:456`); no charset/entropy/dictionary check.
- **G-S3.6** `samlSigningCertificate` extracted from payload (`:338-340`) and validated for SAML clients (`:395`) but **not included in normalised client output** (`:182-205`). Downstream consumers lose the cert.
- **G-S3.7** Protocol mappers (`protocolMappers`) accepted opaquely; no validation of shape, required fields, conflicts (`:201, :229`).
- **G-S3.8** `realmId` fallback chain `context.realmId ?? payload.realm` (`:184, :210, :221, :236`) can result in `undefined` realm if neither is set — see B7.
- **G-S3.9** Workspace clientId namespace check is `startsWith` (`:374`); does not enforce uniqueness within realm. Two workspaces could create overlapping clientIds (B-likely per agent).
- **G-S3.10** `bearer-only` clients can declare `webOrigins` (`:195`) — inapplicable but unvalidated.
- **G-S3.11** Reserved-realm bypass (`context.scope === 'platform'`) at `:301` — a misconfigured caller can target `master` or `in-falcone-platform` realms by setting platform scope.
- **G-S3.12** 11 executor stubs (`:529-571`) — every executor entry point throws `NOT_YET_IMPLEMENTED`. **No actual Keycloak admin API calls in this repo.**

### G-S4. Cross-provider patterns repeated

- **G-S4.1** Per-provider hard-coded contract-version fallback (Kafka uses contract via façade; Keycloak hard-codes `'2026-03-24'`; D1's PostgreSQL hard-codes `'2026-03-25'`; same drift family).
- **G-S4.2** Per-provider silent plan-tier downgrade to `'starter'` for unrecognized planId.
- **G-S4.3** Per-provider `providerPayload`-style raw-payload echo in audit envelope (Keycloak explicitly verified; the others were noted in their per-cap audits).
- **G-S4.4** Per-provider executor stubs (Keycloak: 11; Kafka: 1 `createTopicNamespace`; G1 audit found a similar `provisionWorkspaceStorageBoundary` stub).

---

## BUGS

### Confirmed (verified-by-author from cited lines)

- **B1. Kafka adapter accepts tenant/workspace context from caller payload as fallback.**
  `services/adapters/src/kafka-admin.mjs:475` (verified-by-author): `tenantId: context.tenantId ?? payload.tenantId, workspaceId: context.workspaceId ?? payload.workspaceId`. An attacker who controls payload (and where context is partially set) can inject `payload.workspaceId` to derive a naming policy for a different workspace; then supply a topicName that, when normalized + prefixed with the attacker's workspace, escapes the intended boundary. Same pattern flagged in H1 B1 (OpenWhisk) and E1 B1 (Mongo) — three of the six adapters have this defect.

- **B2. Kafka ACL principal prefix check is `startsWith()`-vulnerable to suffix injection.**
  `kafka-admin.mjs:419` (verified-by-author): `binding.principal.startsWith(profile.namingPolicy.serviceAccountPrincipalPrefix)`. If prefix is `User:svc_alpha_dev_`, an attacker-supplied principal `User:svc_alpha_dev_ATTACKER_suffix` passes the check. The principal then becomes part of the published ACL binding. Fix: require a stricter boundary (e.g., end-of-name match or specific suffix format).

- **B3. Kafka plan-tier silent fallback + quota-override bypass.**
  `kafka-admin.mjs:148-157` + `:281` (subagent-reported, line numbers verified). Unknown planId silently maps to `'starter'`. But `topicCapabilityEnabled = resolvedCapability || (resolvedTopicQuota?.limit ?? 0) > 0` — if a quota override accidentally sets `limit > 0` for a starter tenant, the capability is silently enabled despite the plan disallowing it. Fail-open authorization through quota override.

- **B4. Keycloak adapter echoes raw `providerPayload` into the adapter call envelope.**
  `keycloak-admin.mjs:506` (verified-by-author): `providerPayload: payload`. If the payload contains a `clientSecret`, `signingCertificatePem`, password, or any secret material, it is included verbatim in the envelope returned by `buildIamAdminAdapterCall`. There is no sanitiser; per M2 audit B6, the repo has three competing forbidden-field policies, none of which is applied here.

- **B5. Kafka adapter `deriveEnvironment` silently maps unknown environments to `'dev'`.**
  `kafka-admin.mjs:159-161` (subagent-reported). `workspaceEnvironment='production'` silently becomes `'dev'`. Topic prefix becomes `ia.<tenant>.<workspace>.dev` regardless of caller intent. Production traffic could pollute dev cluster naming.

- **B6. Keycloak reserved-scope policy enforcement is asymmetric.**
  `keycloak-admin.mjs:416` (subagent-reported) — `scope` resource validation blocks `RESERVED_SCOPE_NAMES = {openid, profile, email, roles, web-origins}`. But realm validation at `:307-308` and client validation at `:335-336` allow `defaultScopes`/`optionalScopes` to reference these reserved names freely. The asymmetry means a caller can attach a reserved scope to any client without violation, defeating the stated policy that reserved scopes are platform-controlled.

- **B7. Keycloak `realmId` fallback chain produces `undefined` realm if both context and payload omit it.**
  `keycloak-admin.mjs:184, :210, :221, :236` (subagent-reported) — every per-kind branch uses `realmId: context.realmId ?? payload.realm`. If both are `undefined`, the resource is normalized with `realmId: undefined`. Downstream code that joins this to a real realm may attach the resource to the wrong realm or fail. The validator at `:301` checks `context.realmId` but doesn't fail-fast.

- **B8. Keycloak hard-coded contract-version fallback `'2026-03-24'` at two sites.**
  `keycloak-admin.mjs:152, :510` (verified-by-author): `iamAdminRequestContract?.version ?? '2026-03-24'`. If `iamAdminRequestContract` is missing or returns no version, every Keycloak adapter call advertises a stale date. Same drift family as the contract-version fallbacks across other adapters (Kafka/Mongo/OpenWhisk all hard-code variants of '2026-03-24' or '2026-03-25').

- **B9. No adapter file imports `authorization-policy.mjs`.**
  Verified by `grep -rln "authorization-policy" services/adapters/src/` → only the README matches. The shared module is exported but consumed by zero adapter files. Consistent with prior audits (D1, E1, G1, H1) which each separately noted the absence.

- **B10. Kafka and Keycloak adapters both have executor stubs that throw `NOT_YET_IMPLEMENTED`.**
  `kafka-admin.mjs:905-909` (`createTopicNamespace`) and `keycloak-admin.mjs:529-571` (11 stubs covering realm/client/role creation, service account lifecycle, credential rotation). Production callers will get runtime errors on any executor invocation. Per G1 audit B6, `storage-tenant-context.mjs:465-469` has the same pattern (`provisionWorkspaceStorageBoundary`).

### Likely

- **B11. Kafka topic-name slug collision.** `kafka-admin.mjs:135-142, :163-169` (subagent-reported). `slugify` strips non-alphanumerics; `'alpha-beta'` and `'alpha--beta'` both normalize to `alpha.beta`. Two workspaces with similar slugs could collide on topic prefix.

- **B12. Kafka ACL dedup key omits `patternType`.** `kafka-admin.mjs:442` (subagent-reported). Two bindings on same (principal, resource, ops) but different patternType (literal vs prefixed) both pass dedup.

- **B13. Kafka `auditRecordId` truncation + default `'evt01'` collision.** `kafka-admin.mjs:655` (subagent-reported). Multiple calls with the same last-16-char callId or missing callId share the same audit id.

- **B14. Keycloak workspace clientId namespace check is prefix-only.** `keycloak-admin.mjs:374` (subagent-reported). Workspaces with overlapping prefixes (e.g., `ws-a` and `ws-a-backup`) can collide on clientId.

- **B15. Keycloak temporary-password validation is length-only.** `keycloak-admin.mjs:456`. `'aaaaaaaaaaaa'` (12 chars) passes.

- **B16. Keycloak SAML signing certificate lost in normalisation.** `keycloak-admin.mjs:338-340, :182-205` (subagent-reported). Extracted, validated, then discarded.

- **B17. Keycloak `authorizationDecisionId` passed through without validation.** `keycloak-admin.mjs:483, :516`. Same pattern as Kafka (which is also unvalidated, but at line `:754`).

- **B18. Keycloak realmId not validated for consistency between context and payload.** Same `??` fallback semantics as B7.

### Needs verification

- **B19. Whether Kafka's `payload.maxPartitionsPerTopic` allows a caller to inflate quota.**
  `kafka-admin.mjs:204` (subagent-reported): `payload.maxPartitionsPerTopic ?? defaults.maxPartitionsPerTopic`. Then validation at `:390` compares `partitionCount > quota.maxPartitionsPerTopic`. If `payload.maxPartitionsPerTopic` is supposed to be a workspace setting and not user-controlled, the validation is bypassable.

- **B20. Whether `tenantIsolation.workspacePrincipalCount` is misleading.**
  `kafka-admin.mjs:210-222`. Filter against `serviceAccountPrincipalPrefix`. If normalisation runs without prior validation, invalid principals can slip in and skew the count.

- **B21. Whether the 11 Keycloak stubs are wrapped by any caller that handles `NOT_YET_IMPLEMENTED`.**
  Per A1 audit, `apps/control-plane/src/iam-admin.mjs` re-exports from this file but I have not verified whether any saga/workflow calls these stubs in production.

- **B22. Whether the 25 adapter `.mjs` files have an executor sibling somewhere in the repo.**
  Per prior audits (D1, E1, G1, H1) the executors are not in source. Confirm with a wider grep for `import.*adapters/src` consumers that actually invoke provider clients.

---

## Scope note for downstream spec authoring

O1 as drawn in the capability map is the union of 6 providers' compile/validate logic. The cross-cutting picture (confirmed across this audit and D1/E1/G1/H1):

1. **Six pure compilers/validators**, none of which executes provider commands. Executor glue is **not in this repo**.
2. **No production consumer enforces the `authorization-policy.mjs` contract.** It's exported and read by tests/scripts but no adapter `.mjs` imports it. The README's claim that this module is the "adapter-facing enforcement surface" is decorative.
3. **Three families of cross-provider defects** recur in every audited adapter:
   - **Trust of caller-supplied identity/context** (`scopes`, `effectiveRoles`, `authorizationDecisionId`, `tenantId`/`workspaceId` from payload).
   - **Silent plan-tier downgrade** to `'starter'` on unknown planId.
   - **Hard-coded contract-version fallback strings** that drift between adapters.

**Six must-fix items** for any OpenSpec proposal touching the adapter layer:

1. **B9 — Decide whether `authorization-policy.mjs` is the source of truth.** If yes, wire it into every adapter's `buildXxxAdapterCall` so that scope/role validation isn't pass-through. If no, delete it.
2. **B1 (Kafka) + same pattern in H1 + E1** — Remove the payload-fallback for `tenantId/workspaceId`. Identity must come from `context`, validated upstream.
3. **B2 (Kafka ACL prefix)** — Tighten principal validation from `startsWith` to a stricter format with explicit suffix bounds.
4. **B4 (Keycloak providerPayload echo)** — Sanitize the envelope before echoing the payload; apply the M2 forbidden-field policy (or a new unified one).
5. **B6 (Keycloak reserved-scope asymmetry)** — Apply the reserved-scope policy uniformly across realm/client/scope validation.
6. **B10 (executor stubs)** — Either implement the 11 Keycloak + 1 Kafka + N storage stubs, or document them as not-yet-implemented in OpenSpec so consumers don't depend on them.

After those, O1 is a clean compiler layer. The deeper question — **where do the executors live, and why aren't they in this repo** — is the strategic blocker for shipping the platform.
