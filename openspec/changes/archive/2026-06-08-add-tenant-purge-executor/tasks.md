## 1. Baseline

- [x] 1.1 Confirm baseline green: `bash tests/blackbox/run.sh` (150 pass at baseline)
- [x] 1.2 Confirm `openspec validate add-tenant-purge-executor --strict` passes

## 2. Black-box tests (write first)

- [x] 2.1 Add fixtures: deleted, purge-eligible tenants (A and B) with past `purgeEligibleAt` and a consistency checkpoint — built from `readDomainSeedFixtures()` (`growth-multi-workspace`) for the on-demand handler test and inline candidate fixtures for the sweep test
- [x] 2.2 Black-box test: on-demand purge without elevated access returns 403 with a blocker (`tests/blackbox/tenant-purge-ondemand.test.mjs::bbx-purge-ondemand-01`)
- [x] 2.3 Black-box test: on-demand purge for a non-deleted tenant returns 409 Conflict (`bbx-purge-ondemand-02`)
- [x] 2.4 Black-box test: on-demand purge with valid dual-confirmation returns 202 Accepted with an async-operation reference (`bbx-purge-ondemand-03/04/05`)
- [x] 2.5 Black-box test: successful purge transitions tenant to `purged` and emits `tenant.purged` with a non-empty destruction manifest (`tests/blackbox/tenant-purge-sweep.test.mjs::bbx-purge-sweep-01`)
- [x] 2.6 Cross-tenant probe: Tenant B unaffected after Tenant A is purged (`bbx-purge-sweep-07`)
- [x] 2.7 Confirmed all new tests fail (red) before implementation, then go green

## 3. Applier teardown methods

- [x] 3.1 `teardown` on `iam-applier.mjs` — deletes Keycloak realm via injected kcApi
- [x] 3.2 `teardown` on `kafka-applier.mjs` — deletes topics (existing only) and ACLs via injected admin
- [x] 3.3 `teardown` on `postgres-applier.mjs` — `DROP SCHEMA IF EXISTS ... CASCADE` (quoted ident) via injected query
- [x] 3.4 `teardown` on `mongo-applier.mjs` — `dropDatabase()` via injected getDb
- [x] 3.5 `teardown` on `storage-applier.mjs` — empties then deletes bucket(s) via injected s3Api
- [x] 3.6 `teardown` on `functions-applier.mjs` — deletes OpenWhisk namespace via injected owApi
- [x] 3.7 All teardown implementations are idempotent (delete-if-exists / 404-tolerant) and honor `dryRun` (`would_remove`)

## 4. Purge sweep action

- [x] 4.1 Created `services/provisioning-orchestrator/src/actions/tenant-purge-sweep.mjs` (`main` + `resolveDependencies`, mirroring `credential-rotation-expiry-sweep.mjs`)
- [x] 4.2 Eligible-tenant query is an injected dependency (`listEligibleTenants`, default `async () => []`) returning already-tenant-scoped deleted candidates
- [x] 4.3 Re-evaluates `evaluateTenantLifecycleMutation({ action: 'purge', ... })` per candidate; skips when `allowed=false` and records the blocker
- [x] 4.4 Invokes all six applier `teardown` functions in order, recording each step and accumulating the destruction manifest
- [x] 4.5 Hard-deletes service-owned rows (injected `hardDeleteServiceRows`) only after all domain teardowns succeed
- [x] 4.6 Transitions tenant to `state='purged'` (injected `transitionTenantState`)
- [x] 4.7 Emits dedicated free-form `tenant.purged` event with destruction manifest (array of `{ domain, resourceType, resourceId, status }`) — see correction #2
- [x] 4.8 On partial failure: emits `purge.failed`, does NOT emit `tenant.purged`, does NOT transition, retryable (idempotent teardowns)
- [~] 4.9 Scheduler registration with `dry_run: true` for initial deployment — DEFERRED: the action exports a `dryRun` param fully covered by black-box tests; live scheduler wiring is an ops/deployment step out of scope for this DI-driven change

## 5. On-demand purge handler

- [x] 5.1 Added `handleTenantPurgeRequest` in `apps/control-plane/src/tenant-management.mjs` wired to the existing `purgeTenant` route — CORRECTION #1: the real path is `POST /v1/tenants/{tenantId}/purge` (operationId `purgeTenant`), NOT `/v1/admin/...`; no new route added
- [x] 5.2 Accepts `approvalTicket`, `confirmationText`, `actorUserId`, and elevated-access / second-confirmation flags; builds the draft via `buildTenantPurgeDraft`
- [x] 5.3 Calls `evaluateTenantLifecycleMutation`; returns 409 with `blocker` if `allowed=false` (403 specifically for the missing-elevated-access blocker)
- [x] 5.4 Dispatches the purge saga via an injected `dispatchPurge` dep and returns 202 Accepted with an async-operation reference (`operationId`)
- [x] 5.5 N/A — the `purgeTenant` route already exists in `services/internal-contracts/src/public-route-catalog.json` (gateway routing is generated from the catalog); no `public-api-routing.yaml` edit needed — CORRECTION #1

## 6. Integration validation

- [~] 6.1 Live-mode integration against fixture tenants — DEFERRED (out of scope here): requires a real-stack environment; the DI-driven black-box tests cover the behavior end-to-end with fakes
- [~] 6.2 Verify zero orphaned rows across all six domains after purge — DEFERRED to real-stack E2E; covered in black-box via the six teardown probes + cross-tenant probe
- [~] 6.3 Verify `tenant.purged` payload contains a complete destruction manifest — covered by black-box `bbx-purge-sweep-01`; live verification DEFERRED to E2E
- [x] 6.4 `bash tests/blackbox/run.sh` — all new and existing tests pass (177 pass, was 150)
- [x] 6.5 `openspec validate add-tenant-purge-executor --strict`
