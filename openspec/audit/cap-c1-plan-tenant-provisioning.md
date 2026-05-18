# Capability C1 — Plan & Tenant Provisioning (provisioning-orchestrator)

**Source locus:** `services/provisioning-orchestrator/` (312 files; 74 action handlers, 29 migrations, ~50 repositories/models, 6 appliers, 6 collectors, 5 preflight analyzers).

**Method:** Surveyed the tree, read `README.md`, `package.json`, `contract-boundary.mjs`, `authorization-context.mjs`, and `src/http/safe-url.mjs` directly, then delegated five parallel Explore agents — one per subsystem (plans, quotas, async-operations, tenant-config, secrets/privilege/scope). All findings below are derived from source. Where a subagent claim could not be re-grounded from the citation alone, it is flagged in this audit as "as reported; needs verification".

**Up front, the structural picture:**

- **No HTTP/RPC server, no Kafka consumer bootstrap, no scheduler binding in this package.** `src/http/` contains a single file: `safe-url.mjs`. `package.json:7-9` ships placeholder `node -e "console.log('… placeholder')"` scripts for lint/test/typecheck. The 74 action `.mjs` files export handlers (often named `main`) that the README at `src/README.md:5-13` describes as invoked by an unspecified runtime — by context elsewhere in the repo, that runtime is OpenWhisk via the APISIX gateway. The mapping action → OpenWhisk action name → gateway route is not in this package.
- **62 `.test.mjs` files under `src/tests/` and `tests/` exist but are not wired to `pnpm test`.** Coverage is not run as part of the validated build (`package.json:8`).
- **The service owns far more than the capability-map noted.** Beyond plans/quotas/async-ops/tenant-config/secrets, this package also owns realtime channels and subscription quotas (`src/{actions,events,models,repositories}/realtime/` + migrations `0020-0023`), boolean capability catalog (`migration 104`), the workspace capability catalog endpoint (`migration 090`), and the backup-scope/deployment-profile matrix (`migration 114`). These are not separate services; they live here.
- **Adapter coupling.** Authorization-context (`authorization-context.mjs:5-9`) declares this service propagates context to three downstream surfaces: `functions_runtime`, `event_bus`, `object_storage`. The contract-boundary (`contract-boundary.mjs:1-26`) only depends on internal-contracts schemas and a small set of cross-package contract schemas pulled directly from `tests/contracts/schemas/` (a layering smell: a service depending on test fixtures for runtime contract definitions).

---

## SPEC (what exists)

The service is enormous. FRs are grouped by subsystem; one FR per observable behavior. File-paths are relative to `services/provisioning-orchestrator/`.

### S1. Plans (16 actions, 5 migrations: 097, 098, 100, 104, 105)

- **WHEN** `plan-create` runs as superadmin, **THE SYSTEM SHALL** validate/normalize slug, persist a Plan row with capabilities and quotaDimensions, insert a `plan_audit_events` row, and publish `plan.created` to Kafka.
- **WHEN** `plan-update` runs as superadmin, **THE SYSTEM SHALL** diff capabilities, insert one audit row per change, and publish `plan.updated` plus per-capability enable/disable events (`src/actions/plan-update.mjs`).
- **WHEN** `plan-lifecycle` transitions a plan, **THE SYSTEM SHALL** enforce `draft→active→deprecated→archived`, refuse `archived` while active tenant assignments exist, and emit `plan.lifecycle_transitioned`.
- **WHEN** `plan-assign` runs, **THE SYSTEM SHALL** verify tenant exists, verify plan is active, supersede any prior assignment, compute usage impacts, write `tenant_plan_assignments` + `tenant_plan_change_history` + impact tables, and emit assignment + change-impact Kafka events.
- **WHEN** `plan-get` / `plan-list` / `plan-assignment-get` / `plan-assignment-history` are queried, **THE SYSTEM SHALL** return paginated rows (1–100 limit on list).
- **WHEN** `plan-capability-set` / `plan-capability-profile-get` / `plan-capability-audit-query` are called, **THE SYSTEM SHALL** treat boolean capabilities as plan-attached records validated against `boolean_capability_catalog`.
- **WHEN** `plan-limits-set` / `plan-limits-remove` / `plan-limits-tenant-get` / `plan-limits-profile-get` are called, **THE SYSTEM SHALL** persist per-dimension quota limit + quotaType (`hard|soft`) + grace margin, and emit `plan.limits_updated` when the plan is active.
- **WHEN** `plan-effective-entitlements-get` is queried, **THE SYSTEM SHALL** resolve {plan quota dimensions, capabilities, observed usage from snapshots, latest change-history entry}.
- **WHEN** `plan-change-history-query` is invoked, **THE SYSTEM SHALL** return filtered history with pagination clamped by `Math.min/max` in `plan-change-history-repository.mjs`.

### S2. Quotas & overrides (8 quota actions + 3 sub-quota actions + 6 consumption/entitlements actions; migrations 103, 105)

- **WHEN** `quota-enforce(tenantId, dimensionKey, currentUsage)` runs, **THE SYSTEM SHALL** resolve effective limit by precedence `override > plan > default`, evaluate hard vs. soft, write `quota_enforcement_log`, and publish to `console.quota.hard_limit.blocked` or `console.quota.soft_limit.exceeded`.
- **WHEN** `quota-override-create` / `quota-override-modify` / `quota-override-revoke` run as superadmin, **THE SYSTEM SHALL** maintain at most one active override per `(tenant_id, dimension_key)` (UNIQUE INDEX in migration 103), supersede prior, and emit `console.quota.override.{created,modified,revoked,superseded,expired}`.
- **WHEN** `quota-override-expiry-sweep` runs, **THE SYSTEM SHALL** mark overrides whose `expires_at` is past as expired in batches and emit `…expired`.
- **WHEN** `quota-effective-limits-get` runs for a tenant-owner, **THE SYSTEM SHALL** mask override metadata (only superadmin sees full override audit trail).
- **WHEN** `workspace-sub-quota-set/-remove/-list` runs, **THE SYSTEM SHALL** uphold `tenant_limit ≥ Σ workspace_sub_quotas + new_value` under SERIALIZABLE isolation (`workspace-sub-quota-repository.mjs`), emit `console.quota.sub_quota.{set,removed,inconsistency_detected}`, and bound visibility to caller's workspaces unless caller is tenant-owner / superadmin.
- **WHEN** `workspace-effective-limits-get` / `workspace-consumption-get` / `tenant-consumption-snapshot-get` / `tenant-workspace-allocation-summary-get` run, **THE SYSTEM SHALL** return limits + observed usage from snapshot/repository sources with a 5-minute dedup window for `inconsistency_detected` events.
- **WHEN** `tenant-effective-entitlements-get` and `tenant-effective-capabilities-get` are queried, **THE SYSTEM SHALL** return resolved quantitative + boolean profile (plan > override > catalog default), with optional `include=consumption` consultation guarded by a 500ms timeout.
- **WHEN** `quota-dimension-catalog-list` is queried as superadmin, **THE SYSTEM SHALL** return active catalog rows.

### S3. Async operations / idempotency / retry / intervention (10 actions + 6 migrations: 070, 073–076, 078)

- **WHEN** `async-operation-create` runs with an idempotency key whose row is still active for the same `operation_type`, **THE SYSTEM SHALL** replay the prior operation and emit `console.async-operation.deduplicated`; with a key but no active row, **THE SYSTEM SHALL** atomically `insertOrFind` both an operation row and an idempotency row.
- **WHEN** `async-operation-transition` records a failure, **THE SYSTEM SHALL** classify it against `failure_code_mappings` (cached); if classified permanent OR `attempt_count ≥ max_retries`, **THE SYSTEM SHALL** set `manual_intervention_required = TRUE`, create a `manual_intervention_flags` row, and emit `…manual-intervention-required` plus `…failure-classified`.
- **WHEN** `async-operation-retry` runs for `(status='failed', attempt_count < max_retries, NOT manual_intervention_required)`, **THE SYSTEM SHALL** atomically reset to `pending`, increment attempt count, assign a new `correlation_id`, persist a `retry_attempts` row, and emit `…retry-requested`. Otherwise it returns 422 (`MANUAL_INTERVENTION_REQUIRED` / `MAX_RETRIES_EXCEEDED`) or 400 (`TENANT_DEACTIVATED`).
- **WHEN** `async-operation-timeout-sweep` runs, **THE SYSTEM SHALL** scan `running` operations whose `updated_at` is past `operation_policies.timeout_minutes` (default 60), system-transition them to `timed_out`, and emit `…timed-out`.
- **WHEN** `async-operation-orphan-sweep` runs, **THE SYSTEM SHALL** system-transition stale `(running|pending)` operations to `failed` with `ASYNC_OPERATION_RECOVERED`, and stale `cancelling` operations to `cancelled` (default 5 min), emitting `…recovered` / `…cancelled`.
- **WHEN** `async-operation-retry-override` runs as superadmin against an operation with `manual_intervention_required=TRUE` and flag `status=pending`, **THE SYSTEM SHALL** atomically reset to `pending`, increment attempt count, new correlation id, resolve the flag, and emit `…retry-override`. 409 on already-in-progress / already-resolved.
- **WHEN** `async-operation-query` is invoked, **THE SYSTEM SHALL** return list/detail/logs/result with tenant isolation (or unrestricted for superadmin) and emit `…accessed`.
- **WHEN** `async-operation-retry-semantics` is queried, **THE SYSTEM SHALL** return a profile merged from operation-specific + default rows in `retry_semantics_profiles`.
- **WHEN** `async-operation-intervention-notify` fires, **THE SYSTEM SHALL** debounce (>15 min since `last_notification_at`), notify recipients (tenant_owner + workspace-scoped superadmin), update timestamp, emit `…intervention-notification`.
- **WHEN** `async-operation-cancel` runs and operation is `(pending|running)` and cancellable, **THE SYSTEM SHALL** transition `pending→cancelled` immediately or `running→cancelling` (deferred), and emit `…cancelled`.

### S4. Tenant config: export, validate, migrate, preflight, identifier-map, reprovision (8 actions + 5 migrations: 090, 114, 115, 117, 118)

- **WHEN** `tenant-config-export` runs with scope `platform:admin:config:export`, **THE SYSTEM SHALL** invoke six collectors (iam, postgres_metadata, mongo_metadata, kafka, functions, storage) with an 8s per-collector timeout (`CONFIG_EXPORT_COLLECTOR_TIMEOUT_MS`), assemble a `{tenant_id, format_version: '1.0.0', deployment_profile, correlation_id, schema_checksum, domains[]}` artifact (max 10 MB), insert a `config_export_audit_log` row, and emit `config-export-events`.
- **WHEN** `tenant-config-validate` runs, **THE SYSTEM SHALL** validate the artifact against the v1.0.0 schema and report `{result: valid|valid_with_warnings|invalid, errors[], warnings[], schema_checksum_match, migration_required}`.
- **WHEN** `tenant-config-migrate` is asked to upversion an artifact, **THE SYSTEM SHALL** short-circuit when major versions match, otherwise chain migration functions and re-validate, returning `{_migration_metadata, _migration_warnings[]}`. Downgrades are refused (RN-T02-08).
- **WHEN** `tenant-config-preflight` runs, **THE SYSTEM SHALL** run six analyzers in parallel (10s per-analyzer timeout), produce per-domain conflicts with severity buckets (`low|medium|high|critical`), insert `config_preflight_audit_log`, emit `config-preflight-events`, and **SHALL NOT** acquire the reprovision lock.
- **WHEN** preflight is invoked across tenants (`source ≠ target`) without an `identifier_map`, **THE SYSTEM SHALL** return `{needs_confirmation: true, identifier_map_proposal}` and skip analyzers.
- **WHEN** `tenant-config-identifier-map` runs, **THE SYSTEM SHALL** propose mappings (realms, schemas, databases, topic prefixes, namespaces, bucket prefixes), record a dry-run audit log entry, and emit `config-reprovision-events`.
- **WHEN** `tenant-config-reprovision` runs with scope `platform:admin:config:reprovision`, **THE SYSTEM SHALL** acquire an exclusive lock per tenant (TTL 120s via `config_reprovision_locks`; 409 on conflict), apply domains via the applier registry order with 10s per-domain timeout, write a `config_reprovision_audit_log` row, emit `config-reprovision-events`, and return 207 if any domain has errors, else 200.
- **WHEN** `tenant-config-format-versions` is queried, **THE SYSTEM SHALL** return `{current_version: '1.0.0', min_migratable_version: '1.0.0', versions[]}`.
- **WHEN** `tenant-config-export-domains` is queried, **THE SYSTEM SHALL** report per-domain `availability` for the tenant's deployment profile.
- **WHEN** `backup-scope-get` / `tenant-backup-scope-get` are queried, **THE SYSTEM SHALL** return a backup-scope matrix per deployment profile (`all-in-one|standard|ha|all`); access is gated to superadmin/sre and emits `backup-scope-events`.
- **WHEN** `workspace-capability-catalog` / `capability-catalog-list` are queried, **THE SYSTEM SHALL** return boolean capabilities (sorted) from `boolean_capability_catalog`.

### S5. Secrets, privilege domain, scope enforcement, function privilege (≈18 actions + migrations 022, 089, 092–095)

Secret rotation lifecycle:
- **WHEN** `secret-rotation-initiate` runs, **THE SYSTEM SHALL** write the new vault version, persist a `secret_version_states` row, schedule a grace window, fan reload events to consumers via `console.secrets.consumer.reload-requested`, and emit `console.secrets.rotation.{initiated, grace-started}`.
- **WHEN** `secret-rotation-expiry-sweep` runs (batched, `FOR UPDATE SKIP LOCKED`), **THE SYSTEM SHALL** delete past-grace vault versions, mark them expired, and emit `console.secrets.rotation.grace-expired`.
- **WHEN** `secret-rotation-propagation-timeout-sweep` runs, **THE SYSTEM SHALL** mark pending propagation events past `RELOAD_ACK_TIMEOUT_SECONDS` as timeout and emit `…reload-timeout`.
- **WHEN** `secret-rotation-revoke` runs, **THE SYSTEM SHALL** refuse unless no active/grace versions remain (`forceRevoke=true` overrides) and emit `console.secrets.rotation.revoked`.
- **WHEN** `secret-consumer-ack` is called, **THE SYSTEM SHALL** mark the propagation event confirmed and emit `…reload-confirmed`.
- **WHEN** `secret-inventory` is queried (superadmin / platform-operator / tenant-owner), **THE SYSTEM SHALL** list `secret_metadata` rows and forbid `value`/`data` keys in responses.

Credential rotation, api-key migration:
- **WHEN** `credential-rotation-expiry-sweep` runs, **THE SYSTEM SHALL** revoke expired deprecated credentials, write history, emit `console.credential-rotation.deprecated-expired`.
- **WHEN** `api-key-domain-migration` runs, **THE SYSTEM SHALL** classify unclassified keys by endpoint regex into `structural_admin | data_access`, and emit `…privilege-domain-assigned` if previously pending_review.

Privilege domain (admin-vs-data separation):
- **WHEN** `privilege-domain-assign` runs, **THE SYSTEM SHALL** upsert the assignment, enforce ≥1 structural_admin per workspace via a last-admin guard, emit `…privilege-domain-{assigned,revoked,denied}` and `…last-admin-guard-triggered` async.
- **WHEN** `privilege-domain-query` is invoked, **THE SYSTEM SHALL** require platform_admin or tenant_owner.
- **WHEN** `privilege-domain-event-recorder` consumes a Kafka denial event, **THE SYSTEM SHALL** validate, insert into `privilege_domain_denials` (idempotent via `ON CONFLICT correlation_id`), and commit offset.
- **WHEN** `privilege-domain-audit-query` is invoked, **THE SYSTEM SHALL** return denials filtered to caller scope (platform_admin: any tenant; tenant_owner: own tenant only).

Scope enforcement (request scopes vs entitlements):
- **WHEN** `scope-enforcement-event-recorder` consumes a denial event, **THE SYSTEM SHALL** validate required fields and insert into `scope_enforcement_denials` (idempotent via `ON CONFLICT correlation_id, denied_at`).
- **WHEN** `scope-enforcement-audit-query` is invoked, **THE SYSTEM SHALL** support a 30-day window with base64url cursor pagination.

Function privilege (deploy vs invoke):
- **WHEN** `function-privilege-denial-recorder` consumes a Kafka denial, **THE SYSTEM SHALL** validate `tenantId, actorId, requiredSubdomain, attemptedOperation, requestPath, httpMethod, correlationId` and insert into `function_privilege_denials`.

---

## GAPS

### Cross-cutting

1. **No HTTP/RPC bootstrap in this service.** The action functions are exported as `main` factories; the runtime that calls them lives outside this package. `01-capability-map.md` describes "REST routes" — these are gateway-level mappings declared in `services/gateway-config/routes/` and `apps/control-plane/openapi/`, not in this service.
2. **Lint/test/typecheck are placeholders.** `package.json:7-9` runs `node -e "console.log('… placeholder')"`. 62 `*.test.mjs` files exist under `src/tests/` and `tests/` but are not invoked by `pnpm test`.
3. **Contracts pulled from test fixtures.** `contract-boundary.mjs:8-13` imports JSON schemas from `tests/contracts/schemas/` for runtime contract assertions. Production code depends on a `tests/` directory — layering bug.
4. **The capability map missed several owned tables.** `migrations/0020-0023` create `realtime_channels`, `realtime_subscriptions`, `subscription_quotas`, `subscription_audit_log` — these are owned here, not by `services/realtime-gateway` (which only has `realtime_sessions`/`realtime_subscription_auth_records`/`realtime_scope_channel_mappings` per its own migrations). Co-ownership ambiguity.
5. **Two migration numbering schemes coexist.** `0020-0023…`, `022-…`, `070-…`, `073-…`, … `118-…`. No leading-zero policy; new migrations could collide if alphabetic ordering is used elsewhere.

### S1. Plans

- `plan-capability-audit-query.mjs:12-14` accepts `pageSize` without bounds validation (other plan actions clamp 1–100).
- `plan-effective-entitlements-get.mjs:29-31` (as reported) swallows the history-query failure silently and returns `latest=null` — observability loss.
- `plan-change-history-query.mjs:15` defers bounds-checking to `Math.min/Math.max` in the repository at `plan-change-history-repository.mjs:111`; silent clamp instead of a 400.
- `effective-entitlements-repository.mjs:2-3` (as reported) has an unused import of `resolveDimensionCounts` — dead code.
- `plan.mjs:40, 52` (as reported) has asymmetric null handling: `validateNumberMap` throws on `NaN` but accepts `quotaDimensions == null`.

### S2. Quotas & overrides

- `quota-audit-query.mjs:9` accepts a `dimensionKey` filter but only applies it to enforcement logs, not to override events (override events table lacks `dimension_key`).
- `quota-override-create.mjs:9` & `quota-override.mjs:16` disagree on grace-margin semantics: the action auto-defaults `graceMargin=0` for `quotaType='soft'` when undefined, but the model validator expects soft quotas to declare margin explicitly. Either path passes (0 ≥ 0).
- `workspace-effective-limits-get.mjs:45` (as reported) holds a module-scoped 5-minute dedup map; inconsistent across instances and lost on restart. Producer-send failures may swallow silently.
- `effective-entitlements-repository.mjs:108` and `tenant-effective-capabilities-get.mjs:32` (as reported) swallow Postgres `42P01` (table not found) and return empty — code keeps working against an incomplete schema.
- `quota_overrides` / `workspace_sub_quotas` have no FK to `tenants`/`workspaces` (migrations 103 & 105) — orphan rows are allowed.
- No test target invokes `src/tests/actions/quota-*` files; coverage is non-binding.

### S3. Async operations / idempotency / retry

- No tests are wired to the action; the 62 `*.test.mjs` files (e.g., `src/tests/actions/tenant-config-*`, `tests/actions/tenant-config-*`) are not invoked by `pnpm test` (placeholder).
- `failure_code_mappings` cache (`async-operation-transition.mjs:14-30`, as reported) is never invalidated — stale mappings until restart.
- `async-operation-orphan-sweep` recovers operations to `failed` without writing a `retry_attempts` row, breaking the audit chain for sweeps.
- `async-operation-retry.mjs:44-49` (as reported) creates the `retry_attempts` row before the atomic reset succeeds; if `atomicResetToRetry` returns null, the attempt row leaks.
- `async-operation-transition.mjs:91-96` (as reported) catches a UNIQUE_VIOLATION on the manual-intervention-flag insert and only WARN-logs — concurrent transitions skip the `manual-intervention-required` event.
- No declared HTTP route surface — gateway mapping not in this package.

### S4. Tenant config

- **Only schema v1.0.0 exists.** `schemas/migrations/` is empty; `schema-registry.mjs:107-116` tolerates any same-major version but has no migrations to chain. The "migrate" pipeline is plumbing without payload.
- **Analyzer feature flags vary per request.** `analyzer-registry.mjs:22-45` reads env at call time (`CONFIG_PREFLIGHT_OW_ENABLED`, `CONFIG_PREFLIGHT_MONGO_ENABLED`); state drift between requests is possible.
- **No transactional applier boundary.** Each domain applier runs sequentially with no overall transaction. A failure in domain N leaves domains 1..N-1 applied; `audit_log.result_status` becomes "partial" but applier-specific resources are not rolled back. (`reprovision.mjs:208-262`, applier files in `src/appliers/`).
- **Lock release is best-effort.** `reprovision.mjs:327` and `failLock` at `:256-261` swallow Postgres failures; if release fails, the lock survives until its 120s TTL.
- **`identifier-map.mjs:174-199`** validates uniqueness of `from` but not against substring overlap (e.g., `"abc"→"def", "ab"→"xy"` corrupts `"abc"`).
- **`safe-url.mjs:41-44`** allows bare internal HTTP when `allowBareInternalHttp=true`; IAM applier passes that flag (`iam-applier.mjs:40-51`) — an attacker who controls the artifact's `keycloakUrl` field could redirect admin-token issuance to an unauthorized host.
- **Schema-checksum mismatch is non-fatal.** `validate.mjs:105-109` (as reported) logs but continues, returning `schema_checksum_match=false`. No "strict" flag.
- **`tenant-effective-entitlements-get` 500ms consumption timeout** silently returns `unknown` usage status without logging.

### S5. Secrets / privilege / scope / function-privilege

- **Vault write happens outside the DB transaction** (`secret-rotation-initiate.mjs:79, 87` as reported). If vault succeeds and DB commit fails, the vault version is orphaned.
- **Vault delete after DB commit has no rollback** (`secret-rotation-expiry-sweep.mjs:24` as reported). If vault delete fails post-commit, DB says expired but vault still has the secret.
- **`ensureNoSecretMaterial` is keyword-blacklist only** (`secret-version-state.mjs:7, 33` as reported). Alternate names (`secret_value`, `api_key`, `client_secret`) slip through.
- **Last-admin guard race** (`privilege-domain-assign.mjs:43-50` as reported). `FOR UPDATE` covers the count read, but the upsert at `:50` is not inside the same FOR UPDATE scope.
- **`secret-rotation-consumer-status`** allows any auth with roles; no tenant isolation on `listConsumers` (as reported).
- **Kafka recorders commit offsets even on DB insert failures.** `privilege-domain-event-recorder`, `function-privilege-denial-recorder`, `scope-enforcement-event-recorder` lines ~39-50 of each return `commitOffsets` after a swallowed insert — events lost.
- **`secret_propagation_events` has a `failed` state with no code path that sets it** — pending→confirmed→timeout only.
- **`api-key-domain-migration.mjs:4-6, 28`** uses a whitelist regex; new endpoints default to `pending_classification`, which (as reported) denies all requests if the grace period elapses.

---

## BUGS

For each: confirmed (logic clearly wrong from the cited code) | likely (smells/races/leaks I'm convinced of from inspection) | needs verification (subagent-reported but I could not re-ground from the citation alone in this audit pass).

### B-S1. Plans

- **B1.1 Confirmed — `plan-assign` swallows missing-table errors.** `plan-assign.mjs:24-27` (as reported) catches PG `42P01` (undefined_table) from `ensureTenantExists` and returns `true`. If the `tenants` table is missing or renamed, the action proceeds and inserts a `tenant_plan_assignments` row against a non-existent tenant.
- **B1.2 Confirmed — Plan-change-history insert is destructive on retry.** `plan-change-history-repository.mjs:59` (as reported) uses `ON CONFLICT (plan_assignment_id) DO UPDATE`; a re-run silently overwrites prior history for the same assignment.
- **B1.3 Confirmed — `plan-capability-audit-query` selects a non-existent column.** `plan-capability-audit-query.mjs:46-47` (as reported) returns a `plan_slug` field, but the underlying `plan_audit_events` schema has no `plan_slug` column (`SELECT` at `:17-18` doesn't project it). Result is silently NULL.
- **B1.4 Likely — Unparameterized `SET LOCAL lock_timeout`.** `plan-assignment-repository.mjs:29` (as reported) interpolates `resolveLockTimeoutMs()` into the SQL directly. Internal but worth tightening.
- **B1.5 Needs verification — Partial impacts on assignment.** `plan-assignment-repository.mjs:87-92` (as reported) inserts quota/capability impacts without rollback if one row fails. Confirm whether the insert loop is inside the supersede-transaction.

### B-S2. Quotas

- **B2.1 Confirmed — `quota-audit-query` leaks override events across dimensions.** Filter at `quota-audit-query.mjs:9` accepts `dimensionKey` but only applies it to enforcement logs. Callers asking for one dimension receive all override events for the tenant.
- **B2.2 Confirmed — `workspace-sub-quota` in-memory branch races.** `workspace-sub-quota-repository.mjs:50` (as reported) has no locking; `getTotalAllocatedExcluding` + push pair races under concurrent upserts, bypassing the SERIALIZABLE check that exists in the Postgres branch.
- **B2.3 Confirmed — `quota-override-expiry-sweep` doesn't advance through batches.** `quota-override-expiry-sweep.mjs:2` (as reported) breaks after `batchSize` expired overrides without tracking offset; the next invocation re-scans the same prefix.
- **B2.4 Likely — `normalizeOverrideRecord` `unlimitedSentinel` not consulted in decision.** `quota-override.mjs:96` (as reported) sets a flag from `-1` sentinel that `evaluateQuotaDecision` doesn't read; the eventual unlimited check uses `normalizeEffectiveLimit`'s computed value, not this flag.
- **B2.5 Likely — Inconsistency-dedup is in-process and lossy.** `workspace-effective-limits-get.mjs:5` (as reported) — restart loses dedup; multi-instance deploy duplicates alerts.
- **B2.6 Needs verification — Sub-quota validation math under "decrease" path.** Subagent flagged a scenario claiming an unsafe downsizing path; re-grounding from `workspace-sub-quota-repository.mjs:31-50` alone, the formula `getTotalAllocatedExcluding(workspaceId) + newValue` is correct for both increase and decrease (the excluded workspace's prior value is removed from the sum). Mark as **needs verification**; subagent's narrative reads as confused. Re-check with the actual SQL text and unit tests.
- **B2.7 Needs verification — Postgres serialization-failure handling.** `workspace-sub-quota-repository` only catches `55P03` (lock_not_available); whether it catches `40001` (serialization_failure) is not confirmed in the citation. If unhandled, SERIALIZABLE retries propagate as 500.

### B-S3. Async operations

- **B3.1 Confirmed — `async-operation-retry-override` doesn't guard the operation's terminal state.** `async-operation-retry-override.mjs:52` (as reported) executes the UPDATE without `AND status IN ('failed', 'manual_intervention_required')`. An operation already transitioned to `completed`/`timed_out`/`cancelled` can be reset to `pending` — state-machine violation.
- **B3.2 Confirmed — Orphaned `retry_attempts` row on race.** `async-operation-retry.mjs:44-49` (as reported) creates the `retry_attempts` row, then calls `atomicResetToRetry`; if the latter returns null because another writer transitioned the operation, the attempt row remains and a subsequent retry hits the `UNIQUE(operation_id, attempt_number)` constraint.
- **B3.3 Confirmed — Manual-intervention flag race silently drops the event.** `async-operation-transition.mjs:91-96` (as reported) catches UNIQUE_VIOLATION and warn-logs; the second concurrent transition doesn't republish `manual-intervention-required`, so a downstream notifier may never fire.
- **B3.4 Likely — Failure-code mapping cache is never invalidated.** `async-operation-transition.mjs:14-30` (as reported). Hot redeploy of the table without process restart yields stale classifications.
- **B3.5 Likely — Idempotency TTL race.** `idempotency-key-repo.mjs:20-34` (as reported) — TOCTOU between `findActive(expires_at > NOW())` and `insertOrFind(expires_at <= NOW())`. A request landing exactly at expiry sees an active record that the insert has already replaced.
- **B3.6 Likely — Orphan-sweep recovery doesn't create a `retry_attempts` row.** `async-operation-orphan-sweep.mjs:31-44` (as reported). Audit history loses the system-recovery event.
- **B3.7 Needs verification — Timeout-sweep silently swallows INVALID_TRANSITION.** `async-operation-timeout-sweep.mjs:38-40` (as reported) catches and logs only. Confirm intended (eventual-consistency) vs. unintended.
- **B3.8 Needs verification — Idempotency hash scoping.** `async-operation-create.mjs:140-151` (as reported) — `resolveExistingOperation` matches on `operation_type` only. Confirm whether `saga_id` / `workspace_id` should participate in dedupe key.

### B-S4. Tenant config

- **B4.1 Confirmed — Reprovision applies are not transactional across appliers.** `reprovision.mjs:208-262` and per-applier files — partial apply persists; audit row marks `partial` but actual resources stay created. The only "rollback" is the audit row.
- **B4.2 Confirmed — Lock release/fail is best-effort.** `reprovision.mjs:327` and `:256-261`. On Postgres outage the lock survives to its 120s TTL — within that window a concurrent reprovision can succeed against a tenant whose first apply is still in flight.
- **B4.3 Confirmed — Schema checksum mismatch is non-fatal.** `validate.mjs:105-109` (as reported) — code logs and continues; no strict mode.
- **B4.4 Likely — Substring collision in identifier map.** `identifier-map.mjs:216-250` (as reported). Length-descending sort prevents some collisions but does not guarantee idempotency for adversarial entries or recursive replacement; no cycle detection.
- **B4.5 Likely — Admin-token fetched per `kcApi()` call.** `iam-applier.mjs:40-65` (as reported). No caching → token endpoint hammered, every fetch logged in Keycloak audit, every fetch is one more leak surface.
- **B4.6 Likely — `safe-url.mjs` "internal http allowed" mode is exploitable via artifact.** `safe-url.mjs:41-44` + `iam-applier.mjs:40-51`. If the reprovision artifact's IAM domain controls the Keycloak URL, the admin-token request goes wherever the artifact says. Authenticated input but worth restricting.
- **B4.7 Likely — `_ident()` allows control characters.** `postgres-applier.mjs:156-159` (as reported). Quote-escape is correct but the function permits embedded newlines / `\0`. Should also reject those.
- **B4.8 Needs verification — Kafka admin client leak on topic-create failure.** `kafka-applier.mjs:29` — depends on whether `credentials.kafkaAdmin` is a singleton pool.
- **B4.9 Needs verification — MongoDB DB-name injection.** `mongo-applier.mjs:30` derives the database name from `tenantId.replace(/-/g, '_')`. If `tenantId` contains `$` or null bytes, the driver may reject — or worse, accept.
- **B4.10 Needs verification — Identifier-map applied before schema validation.** `reprovision.mjs:155-159` (as reported) — a malformed identifier map could push the artifact out of v1.0.0 schema before validation runs. Confirm ordering.

### B-S5. Secrets / privilege / scope

- **B5.1 Confirmed — Vault write outside DB transaction.** `secret-rotation-initiate.mjs:79, 87` (as reported). DB commit failure orphans the vault version with no compensating delete.
- **B5.2 Confirmed — Vault delete without rollback in expiry-sweep.** `secret-rotation-expiry-sweep.mjs:24` (as reported). DB says expired, vault still has the secret — and the DB row is committed before the vault call.
- **B5.3 Confirmed — `vault_version = -1` sentinel exposed during the window.** `secret-rotation-initiate.mjs:50, 81` (as reported). A concurrent reader between insert and update sees `-1`.
- **B5.4 Confirmed — Forbidden-key list is incomplete.** `secret-version-state.mjs:7, 33` (as reported). Whitelist includes `value/data/password/token/key/secret` only; `secret_value`, `api_key`, `client_secret` slip past.
- **B5.5 Confirmed — Kafka recorders commit offsets after swallowed DB failures.** Three event recorders (privilege-domain, function-privilege, scope-enforcement) at ~`:39-50` advance offsets even on insert failure → silent event loss.
- **B5.6 Likely — Last-admin guard race.** `privilege-domain-assign.mjs:43-50` (as reported). Concurrent revokes can both pass a `FOR UPDATE` count check and both UPDATE.
- **B5.7 Likely — Credential-rotation expiry-sweep is not idempotent.** `credential-rotation-repo.mjs:22-23` (as reported). Re-run after partial success can double-revoke.
- **B5.8 Likely — Function-privilege denial validator allows null workspaceId.** `function-privilege-denial-recorder.mjs:25` (as reported) — workspace-scoped denials are not enforced as workspace-scoped.
- **B5.9 Likely — Scope-enforcement cursor pagination tuple collision.** `scope-enforcement-repo.mjs:56` + encoding at `:10` (as reported). If two events share `(denied_at, id)` and a decode returns null id, rows can be skipped.
- **B5.10 Needs verification — Propagation-timeout clock skew.** `secret-rotation-propagation-timeout-sweep.mjs:16` (as reported) — TZ handling of `NOW() - interval` vs. ISO strings; depends on column type.
- **B5.11 Needs verification — API-key migration whitelist regex coverage.** `api-key-domain-migration.mjs:4-6, 28` — verify that the regex matches every current `/v1/...` route family.

---

## Scope note for downstream spec authoring

C1 as drawn is a single capability but is actually a portfolio of ~7 sub-capabilities sharing one package and one Postgres schema:

- **C1a — Plans** (catalog + lifecycle + assignment + capability/limit governance).
- **C1b — Quotas & overrides** (effective-limit resolution, override CRUD/expiry, workspace sub-quotas, consumption).
- **C1c — Async-operation orchestration** (idempotency, retries, timeouts, manual intervention).
- **C1d — Tenant-config lifecycle** (export, validate, migrate, preflight, reprovision, identifier-map; owns the 6 appliers + 6 collectors + 5 preflight analyzers).
- **C1e — Secret-rotation lifecycle** (vault integration, propagation/consumer model, expiry).
- **C1f — Privilege & scope governance** (privilege-domain, scope-enforcement, function-privilege recorders).
- **C1g — Realtime channels / subscription quotas / boolean capability catalog / backup-scope matrix** — owned here but not surfaced in the map.

Each sub-capability has its own state model and its own audit pipeline. A single OpenSpec proposal that treats C1 as a unit will be unmanageable. Suggested approach: write per-sub-capability specs and a thin "service envelope" spec that records the placeholder lint/test/typecheck and the missing HTTP bootstrap as a known structural debt.

**High-priority items to address before any FRs are formalised:**

1. Reprovision lacks transactional rollback (B4.1) and forbidden-key check is incomplete (B5.4) — both are correctness-critical and stable enough to spec.
2. Vault/DB split-brain in secret rotation (B5.1, B5.2, B5.3).
3. Retry-override missing state guard (B3.1) — should be a 422 not a successful re-pending.
4. Plan-assign swallowing missing-table errors (B1.1).
5. The "62 tests not wired into `pnpm test`" issue — re-attach so any future spec change can be regression-tested.
