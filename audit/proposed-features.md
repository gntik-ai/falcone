# Proposed Features — Falcone BaaS (source-derived)

> Advanced feature proposals inferred **only** from real code gaps (missing, stubbed, partial, or modeled-but-not-executed surfaces).
> Every proposal cites the exact `path::symbol` (or `file:line`) where the gap is observable. Documentation excluded per golden rule.
> Ranked by value/effort (highest first). Generated: 2026-06-08.

| ID | Title | Extends | Priority | Complexity | Risk |
|----|-------|---------|----------|------------|------|
| feat-rls-enforced-migrations | Database-enforced RLS for service-owned tenant tables | cap-tenant-isolation | P0 | M | low |
| feat-per-tenant-rate-quota | Per-tenant / per-workspace rate-limit partitioning at the gateway | cap-gateway / cap-quotas-plans | P0 | M | medium |
| feat-tenant-purge-executor | Retention-driven tenant purge executor (saga teardown) | cap-tenant-lifecycle / cap-tenant-provisioning | P0 | L | high |
| feat-audit-anomaly-alerts | Real-time security/anomaly alerting on the audit stream | cap-audit | P1 | M | low |
| feat-tenant-custom-rbac | Per-tenant custom roles & permission bindings | cap-iam-admin (new: cap-tenant-rbac) | P1 | L | medium |
| feat-webhook-secret-tenant-scope | Tenant/workspace columns + scoping on webhook signing secrets | cap-tenant-isolation / cap-webhooks | P1 | S | low |
| feat-usage-billing-export | Metered-usage → billing/invoice export hook | cap-quotas-plans (new: cap-billing) | P1 | M | low |
| feat-storage-cred-rotation-policy | Expiry-driven rotation policy for storage programmatic credentials | cap-storage | P2 | M | low |
| feat-data-residency-pinning | Per-tenant region/residency pinning & enforcement | cap-tenant-provisioning (new: cap-data-residency) | P2 | L | medium |
| feat-cdc-rate-limit-overflow | Per-workspace CDC overflow buffering / dead-letter | cap-pg-cdc | P2 | M | low |

---

## feat-rls-enforced-migrations — Database-enforced RLS for service-owned tenant tables

- **Extends:** cap-tenant-isolation
- **Priority:** P0 · **Complexity:** M · **Risk:** low

**Motivation (code gap).** Tenant isolation for the service-owned tables is enforced **only in application code** (`WHERE tenant_id = $1 AND workspace_id = $2`), with **no database-level Row-Level Security** as a defense-in-depth backstop. A repository-wide scan shows the *only* file containing `ENABLE ROW LEVEL SECURITY` / `CREATE POLICY` is `docs/reference/postgresql/tenant-isolation-baseline.sql` — which lives under `docs/` (not an executable migration, and excluded from code reasoning). The actual executable migrations create indexes but **no RLS**:
- `services/webhook-engine/migrations/001-webhook-subscriptions.sql:17` — `idx_ws_tenant_workspace` index only; no `CREATE POLICY`.
- `services/scheduling-engine/migrations/001-scheduling-tables.sql:35` — `idx_sj_tenant_workspace` index only; no RLS on `scheduled_jobs`, `scheduling_configurations`, `scheduled_executions`.
- `services/realtime-gateway/src/migrations/003-create-realtime-sessions.sql` — `realtime_sessions` has `tenant_id`/`workspace_id` columns but no policy; queries rely on caller-supplied predicates.
- `services/provisioning-orchestrator/src/migrations/089-api-key-rotation.sql` — `service_account_rotation_states`/`_history` carry `tenant_id` but no RLS.

Because isolation is enforced by hand in each query (e.g. `services/scheduling-engine/src/quota.mjs::getActiveJobCount`), a single forgotten predicate in any service handler is an IDOR/cross-tenant leak. This is the cardinal BaaS risk and currently has no DB safety net.

**What it adds.** Ship per-service migrations that `ENABLE ROW LEVEL SECURITY` (and `FORCE ROW LEVEL SECURITY`) on every tenant-scoped table, with `CREATE POLICY` predicates of the form `tenant_id = current_setting('app.tenant_id') AND workspace_id = current_setting('app.workspace_id')`, mirroring the pattern that already exists for the shared `control` schema. Each service’s DB access layer sets `SET LOCAL app.tenant_id`/`app.workspace_id` from the propagated `X-Tenant-Id`/`X-Workspace-Id` headers before queries run.

**Public surface touched.** Migrations under `services/{webhook-engine,scheduling-engine,realtime-gateway,provisioning-orchestrator,backup-status}/migrations/`; DB connection wrappers in each service’s `src/` (e.g. `services/scheduling-engine/src/quota.mjs`, `services/webhook-engine/src/*`). No HTTP contract change.

**Value.** Tenant isolation defense-in-depth — converts isolation from an application-discipline guarantee into a database-enforced invariant, eliminating the entire class of "forgotten `WHERE tenant_id`" leaks. Directly strengthens audit priority #1.

---

## feat-per-tenant-rate-quota — Per-tenant / per-workspace rate-limit partitioning at the gateway

- **Extends:** cap-gateway, cap-quotas-plans
- **Priority:** P0 · **Complexity:** M · **Risk:** medium

**Motivation (code gap).** Gateway rate limits are defined as **flat per-route-class counters with no tenant/workspace key dimension** — they are global, not per-tenant, so one noisy tenant can exhaust a shared budget for everyone (noisy-neighbor). Evidence: `services/gateway-config/base/public-api-routing.yaml::qosProfiles` (lines 136–190) defines `requestsPerMinute`/`burst`/`rateLimitClass` per profile (`platform_control: 240/min`, `event_gateway: 180/min`, `native_admin: 30/min`) but contains **no** `limitKey`, `keyBy`, or `byTenant` field. A grep for `limitKey|keyBy|by_tenant|rateLimitKey` across the routing config returns nothing. The plan model already carries quota dimensions per tenant (`services/internal-contracts/src/index.mjs::buildCapabilityResolution` → `quotas[]` with `enforcementMode`), so the per-tenant budget data exists but is never wired into gateway rate limiting.

**What it adds.** Extend each `qosProfile` with a `limitKey` (e.g. `X-Tenant-Id` or `X-Tenant-Id:X-Workspace-Id`) so APISIX `limit-count`/`limit-req` partitions counters per tenant, and resolve the limit value from the tenant’s plan quota (`resolveTenantEffectiveCapabilities` output) rather than a static constant. Emit `X-RateLimit-*` headers per tenant (the CORS profile already exposes them — `fn-gateway-03`).

**Public surface touched.** `services/gateway-config/base/public-api-routing.yaml` (qosProfiles + plugin config); plan-quota lookup via `services/internal-contracts/src/index.mjs::resolveTenantEffectiveCapabilities`. All `/v1/*` routes observe per-tenant 429 behavior.

**Value.** Cost/quota isolation and fair-use enforcement (audit priority #4). Removes the cross-tenant blast radius of a single abusive tenant and lets premium plans purchase higher throughput.

---

## feat-tenant-purge-executor — Retention-driven tenant purge executor (saga teardown)

- **Extends:** cap-tenant-lifecycle, cap-tenant-provisioning
- **Priority:** P0 · **Complexity:** L · **Risk:** high

**Motivation (code gap).** Tenant purge is fully **modeled as a preview/draft but has no executor**. The retention window is evaluated (`services/internal-contracts/src/index.mjs::evaluateTenantLifecycleMutation:1523-1543` checks `purgeEligibleAt`, `requiresElevatedAccess`, `export_checkpoint`) and a draft is built (`buildTenantPurgeDraft:1460`), but nothing actually performs the cascading delete. The provisioning-orchestrator has many janitorial sweep actions — `async-operation-orphan-sweep.mjs`, `credential-rotation-expiry-sweep.mjs`, `quota-override-expiry-sweep.mjs`, `secret-rotation-expiry-sweep.mjs` — yet **no `tenant-purge`/retention-sweep action** (directory listing of `services/provisioning-orchestrator/src/actions/`). The provisioning appliers (`appliers/{iam,kafka,postgres,mongo,storage,functions}-applier.mjs`) only have a create/apply path; there is no symmetric retention-driven teardown that fans out across all six domains. Result: soft-deleted tenants accumulate indefinitely; the `retentionPolicy.purgeEligibleAt` is checked but never acted upon, leaving orphaned cross-domain data (a lifecycle-cleanup gap, audit priority #5).

**What it adds.** A scheduled `tenant-purge-sweep` orchestrator action that (1) finds tenants whose `state='deleted'` and `purgeEligibleAt` has elapsed, (2) requires the dual-confirmation/elevated-access already modeled, (3) drives a deletion saga invoking each applier’s teardown to remove IAM realm, Kafka topics/ACLs, Postgres schema, Mongo data, storage namespace, and OpenWhisk namespace, then (4) hard-deletes service-owned rows and emits a `tenant.purged` audit event with a verifiable destruction manifest.

**Public surface touched.** New action `services/provisioning-orchestrator/src/actions/tenant-purge-sweep.mjs`; teardown methods on `services/provisioning-orchestrator/src/appliers/*-applier.mjs`; `POST /v1/admin/tenants/{tenantId}/purge` wired to `buildTenantPurgeRequestDraft` (`apps/control-plane/src/tenant-management.mjs`). Emits `asyncOperationStateChangedSchema` events.

**Value.** Closes the tenant deletion-with-cascading-cleanup gap (no orphaned cross-tenant data), satisfies data-retention/right-to-erasure obligations, and reclaims provisioned resources. High risk because it is irreversibly destructive across all adapters — must reuse the existing dual-confirmation + export-checkpoint guards.

---

## feat-audit-anomaly-alerts — Real-time security/anomaly alerting on the audit stream

- **Extends:** cap-audit
- **Priority:** P1 · **Complexity:** M · **Risk:** low

**Motivation (code gap).** The audit pipeline **persists, queries, exports, and correlates** events but **nothing watches the stream for security anomalies**. The pipeline contract (`services/internal-contracts/src/observability-audit-pipeline.json`) defines subsystems and event categories (including `access_control_modification`, `billing_boundary_change`) and the security event class exists (`services/audit/src/contract-boundary.mjs::capabilityEnforcementDeniedEvent`, extended retention; `cross_tenant_violation` error class in `services/internal-contracts/src/authorization-model.json`), yet there is **no consumer that reacts** to a burst of `cross_tenant_violation`, repeated capability-enforcement denials, or auth failures. A grep for `anomaly|brute|impossible_travel|failed_login|threat|securityAlert` across `services/` and `apps/` returns nothing. The only alerting that exists is quota threshold alerts to `quota.threshold.alerts` (`fn-metrics-02`) — purely usage-based, not security-based.

**What it adds.** A stream consumer (sibling to `secret-audit-handler`) that subscribes to the audit Kafka subsystem, applies per-tenant rules (e.g. N `cross_tenant_violation` in T seconds, repeated capability denials, credential-reset spikes), and emits structured security alerts to a `console.security.alerts` topic with per-tenant scope envelope, feeding the existing oscillation/suppression machinery (`services/internal-contracts/src/index.mjs::getAlertOscillationDetection`, `getAlertSuppressionDefaults`).

**Public surface touched.** New service `services/audit-anomaly-handler/` (mirrors `services/secret-audit-handler/src/index.mjs` tailer→publisher shape); reuses `getAuditEventRequiredFields`/`getAuditScopeEnvelope` for parsing. Optionally surfaced via `GET /v1/admin/audit/*` alert views.

**Value.** Per-tenant security observability (audit priority #7): turns the already-rich audit substrate from forensic-only into proactive detection of cross-tenant probing and privilege-escalation attempts — the highest-severity events in a multitenant BaaS.

---

## feat-tenant-custom-rbac — Per-tenant custom roles & permission bindings

- **Extends:** cap-iam-admin (new capability: cap-tenant-rbac)
- **Priority:** P1 · **Complexity:** L · **Risk:** medium

**Motivation (code gap).** Authorization uses a **fixed, platform-defined permission matrix** with **no per-tenant custom role definition**. `services/internal-contracts/src/authorization-model.json::permission_matrix` (line 716+) enumerates a static set of roles (`platform_admin`, `platform_operator`, …) with hard-coded `allowed_actions`/`denied_actions`. Tenants cannot define their own roles: `services/adapters/src/keycloak-admin.mjs::RESERVED_ROLE_NAMES` (14 entries) actively **blocks** mutation of platform/tenant/workspace role names for non-platform scope (`keycloak-admin.mjs:412`), and while `effective_roles` flow through the gateway (`X-Actor-Roles`, `fn-ctx-01`) and `tenant.effective_permissions.read/recalculate` actions exist, there is no surface to *author* a tenant-scoped role bundling a subset of permissions. Tenant admins are therefore stuck with the platform’s coarse role grants.

**What it adds.** A tenant-scoped role catalog: define custom roles (name-spaced to avoid `RESERVED_ROLE_NAMES` collisions) that bind a subset of the permission_matrix actions, persist role→permission bindings per `(tenant_id, workspace_id)`, and fold them into the `effective_roles`/`effective_permissions` resolution already consumed downstream. Recalculation reuses the existing `*.effective_permissions.recalculate` action.

**Public surface touched.** New routes `GET/POST/PUT/DELETE /v1/admin/iam/tenant-roles/*` in the IAM family (`services/gateway-config/base/public-api-routing.yaml`, `planCapabilityAnyOf: [identity.sso.oidc]`); resolution logic alongside `services/internal-contracts/src/authorization-model.json`; binding persistence via a new migration. Mutations validated against `RESERVED_ROLE_NAMES`.

**Value.** Self-service authZ (audit priority #3): lets tenant admins implement least-privilege internally without platform involvement, a baseline expectation for a mature multitenant BaaS. Medium risk — must guarantee custom roles can never grant cross-tenant or platform-reserved actions.

---

## feat-webhook-secret-tenant-scope — Tenant/workspace columns + scoping on webhook signing secrets

- **Extends:** cap-tenant-isolation, cap-webhooks
- **Priority:** P1 · **Complexity:** S · **Risk:** low

**Motivation (code gap).** Every webhook table carries `tenant_id`/`workspace_id` **except `webhook_signing_secrets`**, which is scoped only by `subscription_id` FK. `services/webhook-engine/migrations/001-webhook-subscriptions.sql:21-31` defines `webhook_signing_secrets (subscription_id, secret_cipher, secret_iv, …)` with **no `tenant_id`/`workspace_id` columns and no scoping index** — unlike `webhook_subscriptions` (`:1-17`) and `webhook_deliveries` (`:33-52`) which both have `(tenant_id, workspace_id)`. Any query that reaches the secrets table by `subscription_id` alone (e.g. a join bug or a guessed/leaked subscription UUID) has no tenant predicate to fall back on. This is the one table in the webhook engine where the isolation invariant is structurally absent, and it holds the most sensitive material (signing-secret ciphertext).

**What it adds.** Add `tenant_id`/`workspace_id` columns (back-filled from the parent subscription), a `(tenant_id, workspace_id)` index, and a compound predicate (or RLS policy, see `feat-rls-enforced-migrations`) on all signing-secret reads so secret retrieval is always tenant-scoped, not subscription-only.

**Public surface touched.** Migration in `services/webhook-engine/migrations/`; secret read/rotation paths in `services/webhook-engine/src/` that load `webhook_signing_secrets`. No HTTP contract change.

**Value.** Closes a structural tenant-isolation hole on the most sensitive webhook data with minimal effort — pure value/effort win (audit priority #1). Pairs naturally with feat-rls-enforced-migrations.

---

## feat-usage-billing-export — Metered-usage → billing / invoice export hook

- **Extends:** cap-quotas-plans (new capability: cap-billing)
- **Priority:** P1 · **Complexity:** M · **Risk:** low

**Motivation (code gap).** Falcone **meters usage but never turns it into billable records**. The `quota_metering` subsystem exists with a scheduled calculation cycle (`services/internal-contracts/src/observability-usage-consumption.json::calculation_audit:245-261` — `cycleId`, `processedScopes`, `origin_surface: scheduled_operation`) and consumption snapshots are produced (`services/provisioning-orchestrator/src/actions/tenant-consumption-snapshot-get.mjs`, `workspace-consumption-get.mjs`). The audit pipeline even reserves a `billing_boundary_change` category (`observability-audit-pipeline.json:123`). But the business-metrics contract **explicitly disclaims billing**: `services/internal-contracts/src/observability-business-metrics.json:275` — *"it does not define billing calculations, alert thresholds, or UI composition."* The recon notes a `billing` item under `/v1/platform/*` but no emitter exists. So metered data is computed and audited but never exported to any billing/invoicing sink.

**What it adds.** A per-cycle billing export hook: on each `quota_metering` calculation cycle, project per-tenant consumption snapshots into immutable, idempotent usage records (keyed by `cycleId` + `tenant_id`) and publish them to a `console.billing.usage` topic / pluggable billing adapter, with a `GET /v1/platform/billing/usage` query surface. Reuses the existing consumption snapshot dimensions; no new metering required.

**Public surface touched.** New billing emitter consuming `tenant-consumption-snapshot-get.mjs` output; routes under `/v1/platform/billing/*` (`services/gateway-config/routes/platform-admin-routes.yaml`); new Kafka topic `console.billing.usage`. Reuses `billing_boundary_change` audit category.

**Value.** Monetization/cost (audit priority #4): closes the loop from metered consumption to revenue, the missing commercial layer of an otherwise complete plan/quota system. Low risk — read-only projection of already-computed snapshots.

---

## feat-storage-cred-rotation-policy — Expiry-driven rotation policy for storage programmatic credentials

- **Extends:** cap-storage
- **Priority:** P2 · **Complexity:** M · **Risk:** low

**Motivation (code gap).** Credential rotation is **expiry-automated for service accounts but manual-only for storage credentials**. Service-account credentials have a full age/expiry policy and an automated sweep: `services/provisioning-orchestrator/src/migrations/089-api-key-rotation.sql::tenant_rotation_policies` (`max_credential_age_days`, `warn_before_expiry_days`) plus `services/provisioning-orchestrator/src/actions/credential-rotation-expiry-sweep.mjs`. By contrast, storage programmatic credentials only support **on-demand** rotation with no age policy or sweep: `services/adapters/src/storage-programmatic-credentials.mjs::rotateStorageProgrammaticCredential` / `apps/control-plane/src/storage-admin.mjs::rotateStorageProgrammaticCredentialPreview` increment a version only when explicitly called. There is no `max_credential_age_days` equivalent for S3-compatible keys and no expiry sweep — long-lived storage keys never age out.

**What it adds.** Extend the tenant rotation policy to cover storage programmatic credentials (max age, grace period, warn-before-expiry), and add a storage-credential expiry sweep that mirrors `credential-rotation-expiry-sweep.mjs`, auto-rotating (with grace overlap) keys older than the policy and emitting `credential_rotation` audit events (already an optional category in `observability-audit-pipeline.json:107`).

**Public surface touched.** `services/adapters/src/storage-programmatic-credentials.mjs`; new sweep action under `services/provisioning-orchestrator/src/actions/`; policy storage extending `tenant_rotation_policies`. Surfaced under `/v1/storage/*` credential routes (`apps/control-plane/src/storage-admin.mjs::listStorageAdminRoutes`).

**Value.** Security hardening (audit priority #3): brings storage credentials to parity with service-account credential hygiene, removing indefinitely-lived data-plane keys. Low risk via grace-period overlap.

---

## feat-data-residency-pinning — Per-tenant region / data-residency pinning & enforcement

- **Extends:** cap-tenant-provisioning (new capability: cap-data-residency)
- **Priority:** P2 · **Complexity:** L · **Risk:** medium

**Motivation (code gap).** Data residency is **modeled in the topology contract but hard-pinned to a single region with no per-tenant control or enforcement**. `services/internal-contracts/src/deployment-topology.json` sets `region_mode: "single_region"` and `region_ref: "eu-west-1"` on **every** environment profile (lines 114, 144, 174, 206); `multi_region` appears only as a `future_topology.evolution_targets` aspiration (line 238) with a routing rule that traffic *may* shift regions "without changing tenant-visible hostnames" (line 240). There is no tenant attribute selecting a region, no enforcement that a tenant’s Postgres schema / storage namespace / Kafka topics are placed in its chosen region, and provisioning appliers (`services/provisioning-orchestrator/src/appliers/*`) take no region parameter. For a multitenant BaaS, the inability to pin a tenant’s data to a jurisdiction is a compliance gap.

**What it adds.** A per-tenant `dataResidency.region` attribute resolved at provisioning time and threaded through every applier so IAM realm, Postgres schema, Mongo, storage namespace, and Kafka topics are placed in the pinned region; gateway routing honors residency; a residency-violation audit event fires if a request would cross the boundary. Builds on the already-reserved `placement_metadata: [environment_id, cluster_ref, region_ref]` (`deployment-topology.json:229-233`).

**Public surface touched.** Tenant create/update (`/v1/admin/tenants/*`, `apps/control-plane/src/tenant-management.mjs`); region parameter on `services/provisioning-orchestrator/src/appliers/{iam,kafka,postgres,mongo,storage,functions}-applier.mjs`; `deployment-topology.json` region resolution.

**Value.** Multi-region / data-residency (compliance, audit priorities #5–#6): unlocks regulated workloads and is a prerequisite the codebase already gestures toward but has not implemented. Medium risk — affects the entire provisioning saga and routing layer.

---

## feat-cdc-rate-limit-overflow — Per-workspace CDC overflow buffering / dead-letter

- **Extends:** cap-pg-cdc
- **Priority:** P2 · **Complexity:** M · **Risk:** low

**Motivation (code gap).** CDC events that exceed the per-workspace rate window are **permanently dropped with no recovery path**. `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs::_allow(workspaceId)` enforces a per-workspace sliding 1-second window (`PG_CDC_MAX_EVENTS_PER_SECOND`, default 1000); on exceed the event is dropped and only a metric (`pg_cdc_events_rate_limited_total`) is incremented (`fn-pg-cdc-02`). There is no overflow buffer, no dead-letter topic, and no backpressure — a tenant briefly exceeding 1000 changes/sec **silently and irrecoverably loses change events**, breaking CDC delivery guarantees for downstream consumers (functions, realtime, webhooks). The Mongo CDC side persists resume tokens for durability (`services/mongo-cdc-bridge/src/index.mjs::ResumeTokenStore`), so the platform clearly values exactly-once-ish CDC, making the silent-drop behavior an inconsistency.

**What it adds.** Replace the silent drop with a bounded per-workspace overflow buffer plus a dead-letter Kafka topic (`{prefix}.{tenantId}.{workspaceId}.pg-changes.dlq`) for events that cannot be drained within a deadline, and surface an overflow/backpressure metric and audit event so operators and tenants can detect loss. Preserves the tenant/workspace topic-namespacing invariant from `deriveTopic`.

**Public surface touched.** `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs` (`_allow`, `publish`); new DLQ topic in the CDC namespace; metrics/audit emission. No HTTP contract change.

**Value.** Data-integrity and per-tenant observability (audit priorities #4, #7): converts silent, unbounded CDC loss into a recoverable, observable event, aligning the Postgres CDC path with the durability guarantees already present on the Mongo CDC path.

---

## Notes on excluded ideas (insufficient code evidence)

- **SDK/codegen** is already partially present (`services/openapi-sdk-service`, `services/internal-contracts/src/index.mjs::sdkGenerationCompletedEvent`), so it is an existing capability (`cap-workspace-docs`), not a gap — excluded.
- **API-key rotation & scopes** for service accounts already exists (`services/provisioning-orchestrator/src/migrations/089-api-key-rotation.sql`, `credential-rotation-expiry-sweep.mjs`); only the *storage-credential* sub-case is a real gap (covered by feat-storage-cred-rotation-policy).
- **Webhooks/event subscriptions** and **per-tenant backup/restore** are already implemented (`cap-webhooks`, `cap-backup-restore`) — not proposed wholesale; only the signing-secret scoping gap is real (feat-webhook-secret-tenant-scope).
- **Soft-delete** is implemented (`deleted_at` columns throughout); the real gap is the *purge/retention executor* (feat-tenant-purge-executor), not soft-delete itself.
</content>
</invoke>
