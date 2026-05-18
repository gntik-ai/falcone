# Capability L1 — Backup Status, Operations, Audit

**Source locus:** `services/backup-status/` — **5117 LOC of TypeScript** across 50+ source files (first TS service in the audit; others are `.mjs`) + 4 SQL migrations + 20 test files.

**Test framework:** vitest (`package.json:8`), with `tsc --noEmit` typecheck. Real `pnpm test`/`pnpm typecheck`/`pnpm lint` wiring (not placeholder).

**Method.** Read `package.json`, `shared/audit.ts`, `shared/deployment-profile.ts` myself for orientation. Delegated four parallel Explore agents covering: (1) API + auth + schema, (2) operations + dispatcher + restore simulation, (3) confirmations + prechecks + 2FA + risk calculator, (4) adapters + collector + audit-trail + DB migrations. After the agents returned, **spot-verified five of the most damaging claims** by direct reads of cited line ranges:
- `superadmin` as scope literal in `initiate-restore.action.ts:20, 62` and `confirm-restore.action.ts:21, 25` — **CONFIRMED**.
- `isSafeSimulationProfile` substring match at `restore-simulation.types.ts:52` — **CONFIRMED**.
- `findActive` race condition at `operations.repository.ts:100-118` — **CONFIRMED**.
- `findByTokenHash` "double-hash on abort" claim — **CORRECTED**: the regex test at line 112 (`/^[a-f0-9]{64}$/i.test(tokenOrHash) ? tokenOrHash : hashToken(tokenOrHash)`) prevents double-hashing. The agent's claim was wrong.
- JWKS verification absent from production path — **CONFIRMED**: `backup-status.auth.ts:36-62` throws if `KEYCLOAK_JWKS_URL` is unset but never actually fetches JWKS or verifies signatures. Source even comments "Using a simplified verification approach for the MVP".

**Up-front structural observations:**

- The TS migration is real (`tsconfig.json`, `.ts` source, `@types/*` dev deps, vitest), and a coherent set of subsystems exist: 6 prechecks, a risk calculator, OTP + second-actor 2FA, restore simulation with sandbox/integration profiles, audit-trail with chained Kafka fallback, 5 adapters (postgres, mongo, s3, keycloak, kafka), a collector, and 4 normalised migrations.
- **Four of the five adapters are stubs.** Only `postgresql.adapter.ts` has real logic (Velero → Barman → K8s annotation fallback chain, ~323 LOC). `mongodb`, `s3`, `kafka`, `keycloak` all return `not_available` and throw `not_implemented` on `triggerBackup`/`triggerRestore`/`listSnapshots`. Comments explicitly mark them TODO.
- **Production JWT validation is unsigned.** `backup-status.auth.ts:43-62` parses payload base64 and checks expiry — no signature verification.
- **`superadmin` is checked everywhere as a scope literal**, but per the B1 audit, `superadmin` is a **realm role** (propagated through `$jwt_claim_realm_access_roles`, not `$jwt_claim_scope`). The `TokenClaims` interface has no `roles` field. **Every `token.scopes.includes('superadmin')` check is false for a real superadmin.**
- **Restore confirmation flow is end-to-end implemented** (prechecks → risk calculation → token issuance → second-factor → dispatch) and is the most-complete subsystem in the package.

---

## SPEC (what exists)

### S1. API entry surface

- **WHEN** `GET /v1/backup/status` is called, **THE SYSTEM SHALL** extract Bearer token, validate it (TEST_MODE bypass available), and enforce: `backup-status:read:global` for cross-tenant queries (no `?tenant_id`); `backup-status:read:own` + tenant-match for per-tenant queries; technical fields gated on `backup-status:read:technical`; shared instances filtered unless technical scope present (`api/backup-status.action.ts:25-29, :64-153, :86-103, :119-121`).
- **WHEN** a successful status read returns, **THE SYSTEM SHALL** fire `logAccessEvent` audit (non-blocking, errors swallowed) (`backup-status.action.ts:142-151`).
- **WHEN** `POST /v1/backup/restore/initiate` is called, **THE SYSTEM SHALL** require `backup:restore:global` OR `superadmin` (verified-by-author at `:20`), decode base64 body, call `confirmations.service.initiate(...)`, return `202` (`api/initiate-restore.action.ts:11-77`).
- **WHEN** `POST /v1/backup/restore/confirm` is called, **THE SYSTEM SHALL** require `backup:restore:global` OR `superadmin` (`:21`), accept confirmation token + tenant-name-confirmation + warnings + optional 2FA, return `200` (abort) or `202` (confirm) (`api/confirm-restore.action.ts:12-70`).
- **WHEN** the auth helper validates a token in TEST_MODE, **THE SYSTEM SHALL** decode base64url payload without signature verification and return `{sub, tenantId, scopes, exp, iat}` (`api/backup-status.auth.ts:20-35`).
- **WHEN** the auth helper validates in production, **THE SYSTEM SHALL** require `KEYCLOAK_JWKS_URL` to be set (throws 500 otherwise) but **SHALL NOT** verify the JWT signature — only decode payload and check `exp` (verified-by-author at `:36-62`).

### S2. Operation lifecycle

- **WHEN** a backup or restore operation is created, **THE SYSTEM SHALL** insert with status `'accepted'` and auto-stamp `acceptedAt` (`operations.repository.ts:73-87`).
- **WHEN** the dispatcher runs an operation, **THE SYSTEM SHALL** transition `accepted → in_progress → completed/failed` with timestamps (`operation-dispatcher.ts:54, :238-270`); only transitions from `'accepted'` are allowed.
- **WHEN** a restore's metadata declares `execution_mode: 'simulation'`, **THE SYSTEM SHALL** bypass the adapter and run `runRestoreSimulation()` instead (`operation-dispatcher.ts:77-172`).
- **WHEN** a simulation runs, **THE SYSTEM SHALL** verify `targetEnvironment` against `SAFE_SIMULATION_PROFILES = ['sandbox', 'integration']` (`restore-simulation.types.ts:48-53`), execute 3 default checks (`target_isolated, snapshot_present, post_restore_integrity`), and produce `completed/warning/failed` outcome with evidence refs (`restore-simulation.service.ts:36-58, :86-105`).
- **WHEN** `findActive(tenantId, componentType, instanceId, type)` is called, **THE SYSTEM SHALL** select operations with `status IN ('accepted', 'in_progress')` (verified-by-author at `:100-118`).
- **WHEN** backup/restore is triggered, **THE SYSTEM SHALL** check `findActive` before insert (`trigger-backup.action.ts:116-120`, `trigger-restore.action.ts:102-104, :212-215`).
- **WHEN** `list-snapshots` runs, **THE SYSTEM SHALL** delegate to `adapter.listSnapshots()` and return sanitised `{snapshot_id, created_at, available, size_bytes, label}` rows (`list-snapshots.action.ts:44-75`).
- **WHEN** `get-operation` returns, **THE SYSTEM SHALL** include technical metadata only if caller carries `backup-status:read:technical` (`get-operation.action.ts:90`).
- **WHEN** `query-audit` runs, **THE SYSTEM SHALL** enforce `backup-audit:read:own` (tenant filter) vs `:read:global` (cross-tenant), 90-day max window, cursor pagination (default limit 50), and role-based serialisation (`query-audit.action.ts:70-74, :15, :103-104, :109-177`).

### S3. Restore confirmation flow

- **WHEN** `confirmations.service.initiate` runs, **THE SYSTEM SHALL** reject `execution_mode: 'simulation'` with 422 (`confirmations.service.ts:178-182`), run 6 prechecks in parallel with 10s per-precheck timeout, classify warnings, derive risk level, generate a 32-byte random token + SHA256 hash with TTL (default 300s), persist `restore_confirmation_requests` row, return `{confirmationToken, confirmationRequestId, expiresAt, riskLevel, availableSecondFactors, prechecks, warnings, target_info}` (`:177-307`, prechecks at `prechecks/index.ts:44-86`).
- **WHEN** prechecks run, **THE SYSTEM SHALL** execute (1) `active-restore` (blocking if in-flight), (2) `snapshot-exists` (blocking if missing/unavailable, **warning if adapter null**), (3) `snapshot-age` (warning >48h default), (4) `newer-snapshots` (warning if newer available), (5) `active-connections` (warning if any), (6) `operational-hours` (warning outside UTC HH:MM window).
- **WHEN** the risk calculator runs, **THE SYSTEM SHALL** classify: `critical` if `scope=full` OR warning_count ≥ 3 (default); `elevated` if snapshot_age > warning_threshold OR any warning OR outside operational hours OR has timeout; otherwise `normal` (`risk-calculator.ts:57-70`).
- **WHEN** any precheck returns `blocking_error`, **THE SYSTEM SHALL** throw 422 `blocking_precheck_failed` and emit `restore.confirmation_pending` audit with `result: 'rejected'` (`confirmations.service.ts:209-233`).
- **WHEN** `confirm` is called, **THE SYSTEM SHALL** require: matching token hash (not expired, else 410), `tenantNameConfirmation === expected`, `acknowledgeWarnings=true` for non-normal risk, second-factor for critical (OTP or second-actor); re-validate `snapshot-exists` (line 409-419); create the operation; update decision to `confirmed`; dispatch async; emit `restore.confirmed` audit (`confirmations.service.ts:309-470`).
- **WHEN** OTP verification runs, **THE SYSTEM SHALL** POST `{otp_code, requester_id}` to `keycloakOtpVerifyUrl` with 5s timeout, return `{valid:true}` on 2xx, `{valid:false, error:'otp_invalid'}` on 401/422 (`second-factor/otp-verifier.ts:8-53`).
- **WHEN** second-actor verification runs, **THE SYSTEM SHALL** validate the second token, reject if `claims.sub === requesterId`, require role `superadmin` or `backup:restore:global`, require tenant access via `tenantId/tenant_ids/tenants` claim (`second-factor/second-actor-verifier.ts:20-43`).
- **WHEN** the expiry job runs, **THE SYSTEM SHALL** select pending requests past `expires_at`, mark `expired`, emit `restore.confirmation_expired` audit (`expiry-job.action.ts`, `confirmations.service.ts:473-498`).

### S4. Adapter interface

- **WHEN** any adapter implements `BackupAdapter`, **THE SYSTEM SHALL** expose `check(instanceId, tenantId, context): Promise<BackupCheckResult>` returning `{status ∈ {success,failure,partial,in_progress,not_configured,not_available,pending}, lastSuccessfulBackupAt?, detail?, metadata?}` (`adapters/types.ts:28-36`).
- **WHEN** `postgresql.adapter.ts` checks, **THE SYSTEM SHALL** try in order: Velero VolumeSnapshot → Barman API at `${BARMAN_PROTOCOL}://cnpg-barman.${ns}.svc:${BARMAN_PORT}` → K8s Backup CRD annotation; staleness threshold `BACKUP_STALENESS_HOURS` (default 25h) (`postgresql.adapter.ts:3, :44-323, :17`).
- **WHEN** `postgresql.adapter.triggerBackup` runs, **THE SYSTEM SHALL** create a CloudNativePG `Backup` object via K8s API at hard-coded `https://kubernetes.default.svc` (`postgresql.adapter.ts:148-200`).
- **WHEN** `postgresql.adapter.triggerRestore` runs, **THE SYSTEM SHALL** create a new CNPG `Cluster` with `bootstrap.recovery` referencing the snapshot (`postgresql.adapter.ts:202-260`).
- **WHEN** `mongodb/s3/keycloak/kafka` adapters are invoked, **THE SYSTEM SHALL** return `not_available` and throw `not_implemented` for any mutation (`mongodb.adapter.ts:30-36`, same shape across the four stubs).
- **WHEN** the adapter registry looks up by `componentType`, **THE SYSTEM SHALL** return a registered adapter or a fallback `not_available` adapter; `isActionAdapter()` duck-types mutation capabilities (`adapters/registry.ts:15-48`).

### S5. Collector

- **WHEN** the collector action runs, **THE SYSTEM SHALL** iterate managed instances (from `shared/deployment-profile.ts:getManagedInstances` — currently a stub returning 6 demo instances), invoke `adapter.check` per instance with `Promise.race` against `BACKUP_ADAPTER_TIMEOUT_MS` (default 10s), upsert to `backup_status_snapshots`, emit collector audit (`collector/collector.action.ts:32-111`).
- **WHEN** an adapter times out, **THE SYSTEM SHALL** resolve with `{status: 'not_available', detail: 'adapter_timeout'}` (`collector.action.ts:26-29, :63-66`).
- **WHEN** the collector config is loaded, **THE SYSTEM SHALL** read `BACKUP_COLLECTOR_INTERVAL_MS` (default 300s), `BACKUP_ADAPTER_TIMEOUT_MS` (default 10s), `BACKUP_STALE_THRESHOLD_MINUTES` (default 15m) — note the postgres adapter ignores this and uses its own `BACKUP_STALENESS_HOURS` env var (`collector.config.ts:11-17`).

### S6. Audit-trail

- **WHEN** an audit event is emitted, **THE SYSTEM SHALL** persist to `backup_audit_events` synchronously, then fire-and-forget Kafka publish; DB always commits, Kafka failures logged only (`audit/audit-trail.ts:21-33`).
- **WHEN** the fallback worker runs, **THE SYSTEM SHALL** select events with `published_at IS NULL AND publish_attempts < MAX_PUBLISH_ATTEMPTS` (default 5), retry publish, increment attempt count, and emit an operational alert to `ALERT_TOPIC` when max attempts is reached (`audit/audit-trail.fallback.ts:18-66`).
- **WHEN** event types are emitted, **THE SYSTEM SHALL** use one of 24 types (`backup.*`, `restore.*`) declared in `audit-trail.types.ts:5-24` — plus 4 additional types added by migration 004 (`restore.confirmation_pending/confirmed/aborted/confirmation_expired/simulation.*`) that are **not** in the TS enum.

### S7. Persistence schema

- **WHEN** the migrations run, **THE SYSTEM SHALL** create 4 tables:
  - `backup_status_snapshots` (`001`): `(tenant_id, component_type, instance_id)` unique; status CHECK 7 values; indexes `(tenant_id, last_checked_at)`, `(status, last_checked_at)`.
  - `backup_operations` (`002`): type CHECK `(backup|restore)`; status CHECK `(accepted|in_progress|completed|failed|rejected)`; `accepted_at/in_progress_at/completed_at/failed_at` timestamps; indexes on tenant/active/requester.
  - `backup_audit_events` (`003`): `schema_version`, `event_type`, `operation_id`, `correlation_id`, `tenant_id`, `actor_id`, `result`, `rejection_reason{_public}`, `detail` (JSONB), `detail_truncated`, `destructive`, `published_at`, `publish_attempts`, `publish_last_error`; 5 indexes.
  - `restore_confirmation_requests` (`004`): `token_hash UNIQUE` (but no PK), `status (pending_confirmation|confirmed|aborted|expired|rejected)`, `decision (confirmed|aborted|expired)`, `risk_level (normal|elevated|critical)`, `prechecks_result JSONB`, `warnings_shown JSONB`, `available_second_factors JSONB`, `expires_at`, `decision_at`, `second_actor_id`.

---

## GAPS

### G-cross. Cross-cutting

1. **Production JWT signature verification absent.** `backup-status.auth.ts:43-62` (verified-by-author) — comment says "simplified verification approach for the MVP". Tokens with any valid base64 payload + unexpired `exp` pass.
2. **`TokenClaims` has no `roles` field**, but the code consistently checks `token.scopes.includes('superadmin')` (5+ sites). Per the B1 audit, `superadmin` is a realm role propagated via `$jwt_claim_realm_access_roles`. The role would never appear in `scopes`. See B1.
3. **Four of five adapters are TODO stubs** (`mongodb.adapter.ts`, `s3.adapter.ts`, `kafka.adapter.ts`, `keycloak.adapter.ts`). `check()` returns `not_available`; mutations throw `not_implemented`. Only postgres has real backup logic.
4. **Hard-coded K8s API URL** `https://kubernetes.default.svc` in `postgresql.adapter.ts:158, etc.` — no environment override.
5. **Deployment-profile / managed-instance source is a stub** that returns 6 demo instances by default (`shared/deployment-profile.ts:44-104`). Production-grade integration is a TODO (line 43 comment: `TODO: reemplazar por integración real con US-DEP-03`).
6. **Shared/audit.ts produceToKafka is a stub** (`shared/audit.ts:21-33`) — logs to console, never publishes. Mirror of the audit-trail fallback's `publishToKafka` stub (`audit-trail.fallback.ts:39-45`).
7. **Spanish-language label strings in the stub managed-instances** (`shared/deployment-profile.ts:65, 73, 80, 87, 94, 101`) — `'Base de datos relacional'`, `'Servicio de identidad'`, etc. Same i18n issue flagged in C2 audit B15.

### G-API (subagent reports)

- **G-S1.1** `enforceScope` helper defined and exported at `backup-status.auth.ts:65-69` but never called.
- **G-S1.2** Bearer-token extraction duplicated 3 times (each action file has its own copy at `backup-status.action.ts:25-29`, `initiate-restore.action.ts:15-17`, `confirm-restore.action.ts:16-17`).
- **G-S1.3** No tenant isolation check in `initiate-restore` or `confirm-restore` body. `body.tenant_id` is trusted from the request. See B2.
- **G-S1.4** Confirm-restore GET extracts `request_id` from URL path without validation (`confirm-restore.action.ts:29`).
- **G-S1.5** Inconsistent error envelopes across actions (some `{error}`, some `{error, code, ...detail}`).

### G-Operations (subagent reports)

- **G-S2.1** `rejected` and `cancelled` states declared in `operations.types.ts:13-18` but no code path reaches them.
- **G-S2.2** Adapter capability validation missing — `isActionAdapter()` checks shape but not per-operation-type capability.
- **G-S2.3** Snapshot validation duplicated in `trigger-restore.action.ts:54-69` and inline at `:309-319`.
- **G-S2.4** Legacy restore dispatch path (`RESTORE_CONFIRMATION_ENABLED=false`) bypasses confirmation flow entirely.
- **G-S2.5** `list-snapshots` has no pagination — fixed `LIMIT 20` (`operations.repository.ts:178`).
- **G-S2.6** No filtering by component type or instance ID in `query-audit`.
- **G-S2.7** Audit events from dispatcher are fire-and-forget; if process crashes mid-flow, audit-trail loses transitions (`operation-dispatcher.ts:63, :96, :145-159, :216, :246-260`).

### G-Confirmations (subagent reports)

- **G-S3.1** Precheck rejections in `Promise.allSettled` are wrapped as `timeoutWarning('unknown')` with no diagnostic (`prechecks/index.ts:81-85`).
- **G-S3.2** `snapshotCreatedAt` defaults to `new Date()` if resolver returns null (`confirmations.service.ts:162-169`). Risk calculator then sees age 0 even for very old snapshots.
- **G-S3.3** `snapshot-exists` and `active-connections` prechecks return `warning` (not `blocking_error`) when adapter is null or throws (`snapshot-exists.precheck.ts:17-23`, `active-connections.precheck.ts:46-52`). Security-critical checks silently degrade.
- **G-S3.4** OTP code length/format not validated client-side (`otp-verifier.ts:32`).
- **G-S3.5** No replay protection: same OTP can be verified multiple times within the 5s fetch window (`otp-verifier.ts:23`).
- **G-S3.6** Operational-hours precheck uses UTC (`operational-hours.precheck.ts:26`), no timezone offset.
- **G-S3.7** `risk-calculator.isOutsideOperationalHours` parameter is declared but callers always pass `false` (`confirmations.service.ts:240`). Outside-hours warnings visible to user, never elevate risk.
- **G-S3.8** Only `snapshot-exists` is re-validated at confirm time. The other 5 prechecks may be stale at the moment of execution.
- **G-S3.9** No audit on OTP failures or second-actor failures.
- **G-S3.10** `abort()` does not emit an explicit abort audit — calls confirm with `confirmed:false` (`:563-567`).

### G-Adapters / Collector / Audit-trail (subagent reports)

- **G-S4.1** 4 of 5 adapters are stubs (mongo, s3, kafka, keycloak).
- **G-S5.1** Adapter failures in collector are silent (`collector.action.ts:67-69`) — caught, set `not_available`, no log of adapter type or error.
- **G-S5.2** Staleness thresholds inconsistent: `BACKUP_STALE_THRESHOLD_MINUTES` (collector) vs `BACKUP_STALENESS_HOURS` (postgres adapter); postgres adapter ignores collector config.
- **G-S5.3** Collector timeout from config not used by postgres adapter's sub-checks (Velero and Barman have hardcoded timeouts; only annotation respects config).
- **G-S6.1** Audit-trail repository's `findPendingPublish()` doesn't lock rows; concurrent fallback workers can process the same event multiple times.
- **G-S6.2** `schema_version` hardcoded to `'1'`; no migration path.
- **G-S6.3** New event types added by migration 004 (`restore.simulation.*`, etc.) are not declared in `audit-trail.types.ts:5-24`. Type and DB drift.

### G-DB

- **G-DB.1** `restore_confirmation_requests` has `token_hash UNIQUE` but **no primary key declaration** in the migration as reported (`004_restore_confirmations.sql:35-57`). UPSERT and bulk operations may misbehave.
- **G-DB.2** `prechecks_result` JSONB has no schema constraint.
- **G-DB.3** No DB-level CHECK on `expires_at > now()` for new confirmation requests.

---

## BUGS

### Confirmed

- **B1. `superadmin` realm role checked as a scope literal.**
  `services/backup-status/src/api/initiate-restore.action.ts:20, :62` and `confirm-restore.action.ts:21, :25` (verified-by-author). `TokenClaims` (`backup-status.auth.ts:5-11`) has no `roles` field. Per the B1 capability audit, `superadmin` is a Keycloak realm role propagated via `$jwt_claim_realm_access_roles` (separate JWT claim from `scope`). The `enforce` predicate is `token.scopes.includes('backup:restore:global') || token.scopes.includes('superadmin')` — the second arm is dead. A user with the `superadmin` realm role but lacking the `backup:restore:global` scope is denied. Conversely, the actor object at `initiate-restore.action.ts:62` assigns `role: 'superadmin' | 'sre'` based on the same broken check — every actor ends up tagged `'sre'` (which per B1 audit is itself a phantom role nowhere declared in `values.yaml::realmRoles`).

- **B2. No tenant isolation in `initiate-restore` / `confirm-restore`.**
  `initiate-restore.action.ts:20-75` extracts `body.tenant_id` from the request body and passes it to `confirmations.service.initiate()` without checking it matches `token.tenantId` (verified-by-author, no such check visible). Compare with `backup-status.action.ts:93` which DOES check tenant match for the read path. A tenant-scoped caller who has obtained `backup:restore:global` (e.g., misconfigured grant) can initiate restore for any tenant by setting `body.tenant_id`. The downstream `confirmations.service.initiate` may add a check (not in this audit's read-set), but the action surface offers none.

- **B3. Production JWT signature verification absent.**
  `services/backup-status/src/api/backup-status.auth.ts:36-62` (verified-by-author). Production path requires `KEYCLOAK_JWKS_URL` env var to be set (throws 500 if not), but the implementation only parses the JWT payload via `Buffer.from(parts[1], 'base64url')` and checks `exp` — no signature verification. Source comment says "Using a simplified verification approach for the MVP". Any forged JWT with a valid base64 payload and unexpired `exp` claim passes auth.

- **B4. `isSafeSimulationProfile` substring match allows `integration-prod` to pass.**
  `services/backup-status/src/operations/restore-simulation.types.ts:50-53` (verified-by-author):
  ```ts
  return SAFE_SIMULATION_PROFILES.some((allowed) =>
    normalized === allowed || normalized.includes(allowed)
  )
  ```
  `SAFE_SIMULATION_PROFILES = ['sandbox', 'integration']`. The `.includes(allowed)` branch matches any string containing `'integration'` — including `'integration-prod'`, `'integration-east'`, `'integration-staging-mirror'`. A profile that's adjacent to production but happens to share a substring with `'integration'` passes the safety gate.

- **B5. `findActive` + create is a TOCTOU race.**
  `services/backup-status/src/operations/operations.repository.ts:100-118` (verified-by-author) — `SELECT ... WHERE ... AND status IN ('accepted', 'in_progress') LIMIT 1` with no `FOR UPDATE` or advisory lock. Callers at `trigger-backup.action.ts:116-120` and `trigger-restore.action.ts:102-104, :212-215` issue this SELECT then `create()` in a separate query. Two concurrent triggers for the same `(tenant, component, instance, type)` both see no active operation and both insert.

- **B6. Snapshot age defaults to "now" when resolver is missing.**
  `services/backup-status/src/confirmations/confirmations.service.ts:162-169` (subagent-reported). If `resolveSnapshotCreatedAt()` is undefined or returns null, `snapshotCreatedAt = new Date()`. The risk calculator then computes age as 0 hours regardless of actual snapshot age. A year-old snapshot looks brand-new; risk classification drops from elevated to normal.

- **B7. Snapshot-exists precheck returns 'ok' when adapter is null.**
  `prechecks/snapshot-exists.precheck.ts:17-23` (subagent-reported). If `adapterClient === null` the precheck returns status `'ok'` with detail "unavailable". A security-critical check that verifies the snapshot exists and is `available` silently passes when the adapter is missing or misconfigured. Confirms restore can proceed against a snapshot that was never validated.

- **B8. Active-connections precheck returns 'warning' on any adapter exception.**
  `prechecks/active-connections.precheck.ts:46-52` (subagent-reported). No distinction between "0 connections" and "adapter crashed before answering". Bypassable via adapter DoS.

- **B9. OTP empty code submitted to Keycloak.**
  `second-factor/otp-verifier.ts:32` (subagent-reported). `otpCode ?? ''` allows empty string. Empty OTP forwarded to Keycloak for validation — rejection is post-hoc only. Multiple submissions possible within the 5s fetch timeout.

- **B10. Risk calculator `isOutsideOperationalHours` parameter is dead.**
  `risk-calculator.ts:23-71` (subagent-reported). Function accepts the parameter at `:27` and uses it at `:64` for elevated-risk classification. All callers (`confirmations.service.ts:240`) pass `false`. Outside-hours warnings emitted to user but never elevate risk.

- **B11. Audit emission from dispatcher is fire-and-forget.**
  `operation-dispatcher.ts:63, :96-114, :145-159, :216-228, :246-260` (subagent-reported). `void emitAuditEvent(...)` not awaited. Process crash between status transition and audit emission leaves operation completed without audit row.

- **B12. Kafka failures don't change operation status.**
  `operation-dispatcher.ts:211-237` (subagent-reported). Operation marked `completed` first, then Kafka emission tried. If Kafka fails, operation stays `completed` but no event is published. Status diverges from audit stream.

- **B13. Four of five adapters are TODO stubs.**
  `mongodb/s3/kafka/keycloak.adapter.ts:3-4, :30-36` (verified-by-author across the four files). `check()` returns `not_available`; mutations throw `not_implemented`. The `backup-status` and `backup-operations` API surfaces accept requests for these component types and silently fail or no-op.

- **B14. Shared `produceToKafka` is a console stub.**
  `services/backup-status/src/shared/audit.ts:21-33` (verified-by-author) and `audit/audit-trail.fallback.ts:39-45` — both implementations are TODO stubs that only console.log. No actual Kafka producer. The audit-trail DB rows accumulate with `published_at IS NULL` and `publish_attempts` increment, but nothing is ever published.

- **B15. Managed-instances source is a hard-coded stub.**
  `shared/deployment-profile.ts:43-103` (verified-by-author) — `TODO: reemplazar por integración real con US-DEP-03`. Returns 6 literal demo instances (`pg-main-001`, `pg-shared-001`, etc.). If `DEPLOYMENT_PROFILE_API_URL` is unset, every collection cycle iterates these demo instances.

- **B16. `INTEGRATION` substring also matches `'integrationcd'`.** Continuation of B4: any single-word substring of a safe profile is accepted. Worth flagging separately because it implies new "safe" tokens leak in over time.

### Likely (subagent-reported, plausible from cited lines)

- **B17. Snapshot validation duplicated and inconsistent.** `trigger-restore.action.ts:54-69` vs `:131-150`.
- **B18. Audit detail truncation produces invalid JSON.** `audit-trail.ts:40-42` — mid-stream byte truncation at `MAX_DETAIL_BYTES` (4096) doesn't preserve JSON validity.
- **B19. Audit `correlation_id` randomly generated if missing.** `audit-trail.ts:50` — related events (e.g., `backup.requested → backup.started`) get different correlation ids.
- **B20. Snapshot upsert doesn't validate status enum** — relies on DB CHECK to fail at runtime (`repository.ts:110`).
- **B21. `audit-trail.fallback` retry loop ignores `publishAttempts ≥ maxAttempts` until after publish.** `audit-trail.fallback.ts:20` — publishes one extra time after the threshold.
- **B22. Operational-hours precheck uses UTC without tenant TZ.** `operational-hours.precheck.ts:26`.
- **B23. Bare bearer-token extraction duplicated across actions** — three inline implementations of the same parser.
- **B24. PostgreSQL adapter Velero / Barman / annotation strategies have hardcoded sub-timeouts** that ignore the collector-supplied context timeout (`postgresql.adapter.ts:303-319`).
- **B25. Restore confirmation requests table has no PK** — `004_restore_confirmations.sql:35-57` (subagent-reported).
- **B26. `event_type` for restore confirmations/simulation added by migration 004 not in TS enum.** `audit-trail.types.ts:5-24` lags the migration.

### Needs verification

- **B27. Whether `findByTokenHash` double-hashes on abort.**
  Subagent claimed `abort()` calls with `request.tokenHash` and the function re-hashes. **Re-grounding the cited code**: `confirmations.repository.ts:111-118` (verified-by-author) — `const tokenHash = /^[a-f0-9]{64}$/i.test(tokenOrHash) ? tokenOrHash : hashToken(tokenOrHash)`. The regex prevents double-hashing when a stored hash is passed in. **Subagent claim corrected — not a bug.**
- **B28. Whether `confirmations.service.initiate` enforces tenant scoping downstream of the action.** Action layer doesn't (B2); service layer wasn't read by this audit. Confirm.
- **B29. Whether the OTP endpoint URL `keycloakOtpVerifyUrl` defaults to an internal-only host or accepts arbitrary URLs.** `otp-verifier.ts:14-23` normalises via `normalizeServiceBaseUrl`; if `allowBareInternalHttp: true` it accepts any internal-looking hostname.
- **B30. Whether `K8S_SERVICE_ACCOUNT_TOKEN` is exposed via the adapter context object.** `operation-dispatcher.ts:184-188` passes it. If an adapter logs or echoes the context, the token leaks.
- **B31. Whether the per-event Kafka `produceToKafka` stub is ever wired to a real producer in production.** Both `shared/audit.ts:29` and `audit-trail.fallback.ts:39-45` are stubs. Confirm with deployment manifests.

---

## Scope note for downstream spec authoring

L1 is the largest service audited so far (5117 LOC) and has the most-complete confirmation/2FA scaffolding, but has at least six **blocking** correctness/security issues that any OpenSpec proposal must address first:

1. **B3 (no JWT signature verification in prod)** — until this is fixed, every other auth check is decorative.
2. **B1 (superadmin checked as scope literal)** — drives B2 (no tenant isolation) into a wider blast radius and produces dead-tagged actors (`role:'sre'`) that don't exist in Keycloak.
3. **B2 (tenant isolation in initiate/confirm)** — body-controlled `tenant_id` is currently trusted by the action surface.
4. **B7/B8 (snapshot-exists / active-connections degrade to non-blocking when adapter is null/throws)** — security-critical prechecks fail-open.
5. **B14 (audit Kafka is a stub)** — audit rows persist but never publish; the "DB-first then Kafka" guarantee is half a guarantee.
6. **B13 (4 of 5 adapters stubbed)** — the only working backup target is PostgreSQL. Mongo/S3/Kafka/Keycloak backups return `not_available` and silently no-op.

Secondary issues (B4 substring match for simulation profiles, B5 TOCTOU on `findActive`, B6 snapshot-age default to "now", B10 dead `isOutsideOperationalHours` parameter, B11/B12 fire-and-forget audit, B17 duplicated snapshot validation, B25 missing PK on confirmation requests) are quick fixes that don't block but should land before formalisation.

The restore-confirmation flow, the 6 prechecks, the risk calculator, OTP + second-actor 2FA, and the audit-trail-with-fallback design are all well-decomposed and worth specifying as-is — but the underlying primitives (auth, tenant isolation, Kafka emit, adapters) need to be real before the confirmation flow can deliver on what its design promises.
