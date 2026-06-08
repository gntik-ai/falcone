# Bugs & Defects — Falcone (multitenant BaaS)

> Source-only audit. Multitenancy-first. Each finding is code-grounded (`path::symbol` / `file:line`). Folded-in tenant-isolation findings (`iso-*`) were re-verified against the cited code; verdicts noted. Severity ranking: **P0 (Critical)** cross-tenant exposure / unauthenticated trust; **P1 (High)** authz/identity gaps; **P2 (Medium/Low)** quota bypass, hardening, reliability.
>
> Cross-tenant exposure ⇒ Critical, per project rule.

Confidence: `⚠` marks claims whose exploitability depends on deployment configuration I cannot fully verify from source (gateway topology, scope-grant policy, JWKS sharing).

---

## P0 — Critical

### bug-001 — Unverified JWT decoded as trusted tenant identity in realtime capture actions (folds iso-002)
- **Severity:** Critical (cross-tenant write)
- **Area:** `cap-pg-cdc`, `cap-mongo-cdc`, `cap-realtime` / `fn-pg-cdc-*`, `fn-realtime-*`
- **Location:** `services/provisioning-orchestrator/src/actions/realtime/pg-capture-enable.mjs::decodeAuth` (lines 8-19); identical pattern in `mongo-capture-enable.mjs`, `pg/mongo-capture-disable.mjs`, `pg/mongo-capture-list.mjs`, `pg/mongo-capture-tenant-summary.mjs` (8 files total).
- **Root cause:** `decodeAuth` does `JSON.parse(Buffer.from(header.slice(7), 'base64url'))` on the Bearer token and trusts `claims.tenant_id` / `claims.workspace_id` to scope creates/reads/writes — **no signature verification, no issuer/audience/exp check**. The gateway already injects trusted `X-Tenant-Id`/`X-Workspace-Id` headers (`services/gateway-config/base/public-api-routing.yaml:211-218`), but these actions ignore them and trust the raw token payload instead.
- **Impact:** Anyone who can present (or reach the action with) a syntactically-valid unsigned JWT carrying an arbitrary `tenant_id`/`workspace_id` can enable/disable/list CDC captures for **any tenant** — cross-tenant data-capture provisioning and disclosure of other tenants' capture inventory (via `*-capture-list` / `*-tenant-summary`). Safe only if APISIX is the sole reachable ingress AND it strips/forces the Authorization claims — fragile and untestable. Correct reference pattern: `services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity` (trusted gateway headers, rejects client X-* via request-validation maxLength:0).
- **Repro (bbx-cdc-forged-tenant):** Call the OpenWhisk action `pg-capture-enable` with `__ow_headers.authorization = "Bearer " + base64url(JSON.stringify({tenant_id:"ten_VICTIM", workspace_id:"wrk_VICTIM", sub:"attacker"}))` and a valid `data_source_ref`/`table_name`; observe a `201` row created under the victim tenant. Then `pg-capture-list` with the same forged claim returns the victim's captures.
- **Suggested fix:** Read identity exclusively from trusted gateway headers (`x-tenant-id`, `x-workspace-id`, `x-auth-subject`) like scheduling, OR perform full JWKS signature + iss/aud/exp verification (as `realtime-gateway/src/auth/token-validator.mjs`). Never derive tenant scope from an unverified token payload.

### bug-002 — Privilege escalation via unverified `realm_access.roles` in tenant-config actions (variant of iso-002)
- **Severity:** Critical (platform-admin privilege forgery)
- **Area:** `cap-tenant-provisioning` / `fn-provisioning-*`
- **Location:** `services/provisioning-orchestrator/src/actions/tenant-config-migrate.mjs::extractAuth` (lines 23-41); same pattern in `tenant-config-validate.mjs` (line 29-37) and the other `tenant-config-*.mjs` actions.
- **Root cause:** `extractAuth` base64url-decodes `token.split('.')[1]` (no signature check) and grants `actor_type = 'superadmin' | 'sre' | 'service_account'` based on the unverified `realm_access.roles` / `scope` claims. An attacker forges `{"realm_access":{"roles":["superadmin"]},"scope":"platform:admin:config:export"}` in an unsigned token.
- **Impact:** Forged platform-admin role on tenant config migrate/validate/export/reprovision endpoints — config export/migration of arbitrary tenants, potential tenant reprovisioning. Worse than bug-001 because the forged claim grants a *role/privilege*, not just a data scope.
- **Repro (bbx-config-forged-superadmin):** Invoke `tenant-config-migrate` with an unsigned Bearer carrying `realm_access.roles:["superadmin"]` and `scope` including `platform:admin:config:export`; observe acceptance instead of `403`.
- **Suggested fix:** JWKS-verify the token (iss/aud/exp) before reading roles, or source the role/actor-type from a trusted gateway header derived from a verified token.

### bug-003 — IDOR on backup operation fetch: no tenant predicate + actor-only check (folds iso-001)
- **Severity:** Critical (cross-tenant read + existence oracle)
- **Area:** `cap-backup-restore` / `fn-backup-*`
- **Location:** `services/backup-status/src/operations/operations.repository.ts::findById` (lines 91-98) — `SELECT * FROM backup_operations WHERE id = $1` with no `tenant_id`; caller `services/backup-status/src/operations/get-operation.action.ts::main` (lines 80-88).
- **Root cause:** `findById` is unscoped; `get-operation` fetches the record **before** the access check and then gates on `token.sub === operation.requesterId` (the *actor*, not the tenant) OR a global scope. The 404-vs-403 split (line 82 vs 87) leaks operation existence across tenants, and the technical-detail serialization (line 90) can expose `failure_reason`.
- **Impact:** A caller can probe arbitrary operation IDs cross-tenant (existence oracle); any actor holding `backup:read:global` reads every tenant's operation incl. snapshot ids and instance ids.
- **Repro (bbx-backup-op-idor):** As tenant A's user, GET `/v1/backup/operations/<op-id-belonging-to-tenant-B>`. A non-existent id returns 404; a real cross-tenant id returns 403 — the differential leaks existence. With a global scope the body is returned.
- **Suggested fix:** Add `AND tenant_id = $2` to `findById` (pass the token's tenant), and gate the access check on `token.tenantId === operation.tenantId` before fetch-or-uniformly-404. Return 404 (not 403) for cross-tenant misses to avoid the oracle.

### bug-004 — confirm-restore: cross-tenant restore confirmation when `tenant_id` omitted (folds iso-003 + iso-005)
- **Severity:** Critical (cross-tenant destructive restore)
- **Area:** `cap-backup-restore` / `fn-backup-03`
- **Location:** `services/backup-status/src/api/confirm-restore.action.ts::main` (tenant guard at lines 71-75, **only runs if `body.tenant_id` is a string**); `services/backup-status/src/confirmations/confirmations.service.ts::ConfirmationsService.confirm` (lines 313-475 — **never** checks `actor.tenantId === request.tenantId`).
- **Root cause:** Asymmetry with the initiate path: `initiate-restore.action.ts:46-55` *requires* `tenant_id` and unconditionally rejects mismatches; `confirm-restore.action.ts` makes `tenant_id` optional and only verifies it when present. The service-layer `confirm()` has no tenant gate at all (contrast `getStatus()` line 511 and `abort()` which do). Any actor holding `backup:restore:global` can confirm a pending restore belonging to another tenant by simply omitting `tenant_id`.
- **Impact:** Cross-tenant destructive restore execution. The only residual barrier is `tenantNameConfirmation` matching the resolved tenant name (lines 375-378) — a "type-the-name" UX gate, not an authz boundary (the name is shown in the initiate response and otherwise resolvable). iso-005: the critical-risk second-factor (`verifySecondActor`) then validates the *second* actor against `request.tenantId`, but the *primary* actor is never tenant-checked — so a cross-tenant primary actor reaches the second-factor path.
- **Repro (bbx-confirm-restore-crosstenant):** Tenant A initiates a restore (gets confirmation token + sees tenant name). An actor with `backup:restore:global` in tenant B calls confirm-restore with `{confirmation_token, confirmed:true, tenant_name_confirmation:"<A's name>"}` and **no `tenant_id`** → restore is accepted (202).
- **Suggested fix:** In `ConfirmationsService.confirm`, add an unconditional `if (!isSuperadmin && actor.tenantId !== request.tenantId) throw 403` before any decision. Make `tenant_id` a required field in `confirm-restore.action.ts` and enforce match unconditionally, mirroring initiate.

### bug-005 — Realtime session refreshToken allows tenant/actor drift (confused deputy) (folds iso-004)
- **Severity:** Critical (cross-tenant session hijack)
- **Area:** `cap-realtime`, `cap-token-validation` / `fn-realtime-02`
- **Location:** `services/realtime-gateway/src/auth/session-manager.mjs::refreshToken` (lines 185-232).
- **Root cause:** `refreshToken` verifies the new token's signature (`validateTokenFn`) but then blindly does `session.claims = claims` (line 194) and overwrites `tokenJti`/`tokenExpiresAt` **without asserting** `claims.tenant_id === session.tenantId` or `claims.sub === session.actorIdentity`. The DB columns `tenant_id`/`actor_identity` are never re-checked or updated (lines 202-211), so the persisted row keeps tenant A while in-memory `session.claims` (used by `startPolling`→`checkScopesFn`, line 120-124) now reflects the refreshing token's identity.
- **Impact:** A validly-signed token from tenant B used to refresh tenant A's `sessionId` rebinds A's subscription/scope-revalidation context to B's claims — confused deputy / cross-tenant subscription takeover. (Requires knowing/guessing a target `sessionId`, which is a `randomUUID`.)
- **Repro (bbx-refresh-tenant-drift):** Open a session for tenant A (session S). Call `refreshToken(S, <validToken for tenant B>)`. Assert that subsequent scope checks/publish-guard for S evaluate B's `tenant_id` instead of being rejected.
- **Suggested fix:** In `refreshToken`, if `claims.tenant_id !== session.tenantId || claims.sub !== session.actorIdentity`, reject (and `closeSession`); only refresh when identity is stable.

---

## P1 — High

### bug-006 — Realtime token validation omits issuer/audience binding
- **Severity:** High (authentication weakness; potential cross-tenant if JWKS shared) ⚠
- **Area:** `cap-token-validation`, `cap-realtime` / `fn-realtime-01`
- **Location:** `services/realtime-gateway/src/auth/token-validator.mjs::verifyLocally` (line 161) and `src/config/env.mjs::loadEnv` (no `KEYCLOAK_ISSUER`/`KEYCLOAK_AUDIENCE`).
- **Root cause:** `jwtVerifyFn(token, key, { clockTolerance: '5 seconds' })` passes **only** clock tolerance — no `issuer`/`audience`. `loadEnv` never reads issuer/audience, so they cannot be enforced. Contrast `services/backup-status/src/api/backup-status.auth.ts:116-120` which passes `issuer`/`audience` to `jwtVerify`.
- **Impact:** Any RS256 token signed by a key in the configured JWKS is accepted regardless of `aud`/`iss`. In a realm-per-tenant Keycloak where the JWKS endpoint serves multiple realms/clients, a token minted for a different client/realm/audience would be accepted, enabling token reuse across trust boundaries. Exploitability depends on whether the JWKS is shared across realms (`⚠ not fully code-verifiable`).
- **Repro (bbx-realtime-aud-binding):** Present a validly-signed token whose `aud`/`iss` is a non-realtime client; assert it is rejected (currently accepted).
- **Suggested fix:** Add `KEYCLOAK_ISSUER`/`KEYCLOAK_AUDIENCE` to env and pass `{ issuer, audience }` to `jwtVerify`; reject tokens whose `azp`/`aud` is not the realtime client.

### bug-007 — backup-status TEST_MODE accepts unsigned tokens outside production
- **Severity:** High (auth bypass in non-prod / e2e) ⚠
- **Area:** `cap-backup-restore`, `cap-token-validation`
- **Location:** `services/backup-status/src/api/backup-status.auth.ts::validateToken` (lines 82-102).
- **Root cause:** When `TEST_MODE === 'true'` and `NODE_ENV !== 'production'`, `validateToken` parses `token.split('.')[1]` with **no signature check** and returns the claimed `sub`/`tenantId`/`scopes`. The guard only blocks the combination prod+TEST_MODE. Any environment where TEST_MODE leaks (staging, CI cluster reachable by tenants, a forgotten env var) accepts fully-forged backup/restore tokens — including forged `backup:restore:global`/`superadmin` scopes, compounding bug-003/bug-004.
- **Impact:** Complete auth bypass for the entire backup-status service in any non-production deployment that has the flag set. Tenants on a shared non-prod cluster could forge cross-tenant restore confirmations.
- **Repro (bbx-backup-testmode-bypass):** With `TEST_MODE=true`, `NODE_ENV=staging`, present an unsigned token with `scopes:["superadmin"]`; assert it is rejected (currently accepted).
- **Suggested fix:** Gate TEST_MODE on an explicit allow-list of non-shared environments, or remove the payload-parse path and require a local test JWKS (`_setJwksOverride`) even in tests. At minimum, refuse TEST_MODE whenever `KEYCLOAK_JWKS_URL` points at a real IdP.

### bug-008 — list-snapshots authorizes any global-scope holder to read arbitrary tenant snapshots
- **Severity:** High (cross-tenant read if scope mis-granted) ⚠
- **Area:** `cap-backup-restore` / `fn-backup-02`
- **Location:** `services/backup-status/src/operations/list-snapshots.action.ts::main` (lines 40-66).
- **Root cause:** Requires only `backup-status:read:global`, then takes `tenant_id` from the **caller-supplied** query param and lists that tenant's snapshots — there is no per-tenant variant and no `tenant_id === token.tenantId` check. Inconsistent with `query-audit.action.ts:62-74` which distinguishes `:global` vs `:own` and enforces tenant match for non-global callers.
- **Impact:** If `backup-status:read:global` is ever granted to a tenant-scoped role (plausible given the `:own`/`:global` split exists elsewhere), the holder enumerates every tenant's snapshot inventory (snapshot ids, sizes, labels). Even as platform-operator-only, the missing `:own` path forces over-privileged grants.
- **Repro (bbx-snapshots-scope):** With a token holding `backup-status:read:global` but `tenantId=ten_A`, GET `/v1/backup/snapshots?tenant_id=ten_B&...`; assert it is rejected unless the actor is a platform operator (currently returns B's snapshots).
- **Suggested fix:** Mirror query-audit: add `backup-status:read:own` and enforce `tenant_id === token.tenantId` for non-global callers; restrict `:global` to platform operators by policy.

---

## P2 — Medium / Low

### bug-009 — Scheduling cron floor (`min_interval_seconds`) never enforced (quota/noisy-neighbor bypass)
- **Severity:** Medium (per-tenant quota bypass)
- **Area:** `cap-scheduling`, `cap-quotas-plans` / `fn-scheduling-01`, `fn-scheduling-04`
- **Location:** create path `services/scheduling-engine/actions/scheduling-management.mjs::main` (POST jobs, lines 146-176) and PATCH (lines 234-251); helper `services/scheduling-engine/src/quota.mjs::assertCronFloor` / `cron-validator.mjs::assertAboveFloor` (line 75) **defined but never called**.
- **Root cause:** Create/update only run `validateCronExpression` (syntax) and the active-job-count quota. The configured `config.min_interval_seconds` is read for display (lines 91, 119) but the floor is never asserted against the submitted cron. A workspace whose plan sets, e.g., `min_interval_seconds=3600` can still register `* * * * *` (every 60s).
- **Impact:** Tenants bypass their scheduling-frequency quota, generating up to 60× the intended trigger volume — noisy-neighbor / resource exhaustion on the trigger+runner path.
- **Repro (bbx-cron-floor):** PATCH config to `minIntervalSeconds=3600`, then POST a job with `cronExpression:"* * * * *"`; assert `400 INVALID_CRON_EXPRESSION`/floor error (currently `201`).
- **Suggested fix:** Call `assertCronFloor(params.body.cronExpression, config.min_interval_seconds)` in the POST and PATCH handlers and return 422 on violation.

### bug-010 — Restore confirmation treats stored token-hash as a bearer credential
- **Severity:** Medium (credential model weakness) ⚠
- **Area:** `cap-backup-restore` / `fn-backup-03`
- **Location:** `services/backup-status/src/confirmations/confirmations.repository.ts::findByTokenHash` (lines 111-118); used by `confirmations.service.ts::confirm` (line 314) and `abort` (line 581).
- **Root cause:** `findByTokenHash` accepts **either** a raw token **or** a 64-hex-char value, treating a hex input as the already-computed `token_hash` and matching directly (`/^[a-f0-9]{64}$/i`). The system itself passes the stored hash as a credential (`abort` → `confirm({confirmationToken: request.tokenHash})`). Thus the SHA-256 `token_hash` *is* a valid confirmation credential, not just a lookup key.
- **Impact:** Anyone who learns a pending request's `token_hash` (DB read, backup, replication, future log/detail exposure) can confirm/abort the restore without the original random token. Combined with bug-004 (no tenant gate in `confirm`), exposure is cross-tenant. Mitigant: the hash is currently not logged in audit detail (verified), so the practical path requires DB-level access today.
- **Repro (bbx-tokenhash-credential):** Given a pending request's `token_hash`, call confirm-restore with `confirmation_token=<that hash>`; assert it is rejected (currently the hash is accepted as the token).
- **Suggested fix:** Remove the hex-passthrough branch; always hash the supplied token. Change `abort` to look up by request id and call an internal abort path that does not round-trip the hash as a "token".

### bug-011 — Webhook SSRF guard is validation-time only; no delivery-time IP re-pin (DNS rebinding)
- **Severity:** Medium (SSRF via DNS rebinding) ⚠
- **Area:** `cap-webhooks` / `fn-webhooks-02`, `fn-webhooks-03`
- **Location:** `services/webhook-engine/src/webhook-subscription.mjs::validateSubscriptionInput` (lines 154-214) resolves DNS and blocks private IPs at **subscription** time; `services/webhook-engine/src/webhook-delivery.mjs` contains only record builders — **no egress client re-resolves/re-checks at send time**, and `isBlockedIp` (exported "for reuse in delivery-time re-validation") has no caller in the delivery path.
- **Root cause:** The blocklist is enforced when the subscription is created, but a hostname can resolve to a public IP then (passing validation) and to `169.254.169.254`/`127.0.0.1`/RFC1918 at delivery time (DNS rebinding / TTL=0). Without delivery-time re-resolution + pinning, the guard is bypassable.
- **Impact:** SSRF to cloud metadata / internal services from the webhook egress worker, cross-tenant if the egress identity is shared.
- **Repro (bbx-webhook-rebind):** Register a webhook whose hostname first resolves to a public IP (passes), then flip DNS to `169.254.169.254`; trigger a delivery and assert the request is refused at send time. (Requires the delivery worker, which is not present in source — flagged for coverage.)
- **Suggested fix:** In the (missing) delivery client, re-resolve the hostname, run `isBlockedIp` on every resolved address, and connect to a **pinned** vetted IP (set `lookup`/agent to the validated address); reject on mismatch. Also add a redirect guard (block redirects to private IPs).

### bug-012 — `callerContext` trusted verbatim by async-operation actions
- **Severity:** Medium (tenant scope depends on caller-supplied context) ⚠
- **Area:** `cap-tenant-provisioning`, `cap-context-propagation`
- **Location:** `services/provisioning-orchestrator/src/actions/async-operation-query.mjs::getCallerContext` (lines 42-43, 173-181) and `async-operation-create.mjs::getCallerContext` (lines 19-21, 170).
- **Root cause:** Tenant isolation (`resolveTenantScope`, line 69-82) and superadmin bypass derive entirely from `params.callerContext.{tenantId, actor.type}`. If `callerContext` is populated from anything other than a verified/trusted source (e.g., forwarded request body, or the unverified-JWT pattern of bug-001/002), an attacker sets `actor.type='superadmin'` or an arbitrary `tenantId` and reads/creates cross-tenant operations.
- **Impact:** Cross-tenant operation read/create and privilege bypass — but only if the invoker passes attacker-controlled `callerContext`. The action's own logic is correct; the risk is the trust boundary at its input.
- **Repro (bbx-callercontext-trust):** Invoke `async-operation-query` with `callerContext:{actor:{id:"x",type:"superadmin"},tenantId:"ten_B"}` and `queryType:"list"`; assert it cannot return tenant B's operations unless the context came from a verified token.
- **Suggested fix:** Build `callerContext` inside a trusted boundary from verified gateway headers/JWKS-verified claims only; never accept `actor.type`/`tenantId` from the client. Document and assert the invariant at the action entrypoint.

### bug-013 — CDC publisher per-workspace rate-limit map is unbounded and keyed without tenant
- **Severity:** Low (memory growth; theoretical cross-tenant counter aliasing)
- **Area:** `cap-pg-cdc`, `cap-mongo-cdc`
- **Location:** `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs::_allow` (line 34) — `this.windows.set(workspaceId, ...)`.
- **Root cause:** The rate-limit window `Map` is keyed by `workspaceId` only (not `tenantId:workspaceId`) and entries are never evicted. Workspace ids are globally-unique ULIDs so aliasing is unlikely, but the map grows one permanent entry per workspace ever seen — an unbounded resource over a long-lived process.
- **Impact:** Slow memory growth in the CDC bridge; if a workspace id were ever reused/colliding, rate windows would alias across tenants.
- **Repro:** N/A (internal); covered by a leak/soak test.
- **Suggested fix:** Key by `${tenantId}:${workspaceId}` and evict idle windows (e.g., drop entries whose `windowStart` is older than the window).

### bug-014 — Scheduling job runner has no execution-claim guard (double-run on duplicate invocation)
- **Severity:** Low (at-least-once semantics; possible duplicate target invocation)
- **Area:** `cap-scheduling` / `fn-scheduling-02`
- **Location:** `services/scheduling-engine/actions/scheduling-job-runner.mjs::main` (lines 11-35).
- **Root cause:** The runner sets `started_at` and invokes `params.invokeAction` with no compare-and-set on execution status (e.g., no `UPDATE ... WHERE status='running' AND started_at IS NULL`). If the trigger or OpenWhisk delivers the same `executionId` twice, the target action runs twice. The trigger does dedupe inserts via `ON CONFLICT (job_id, scheduled_at) DO NOTHING` (`scheduling-trigger.mjs:52`), but the runner itself is not idempotent.
- **Impact:** Duplicate side-effecting invocations of tenant target actions under retry/redelivery.
- **Repro (bbx-runner-idempotency):** Invoke the runner twice with the same `executionId`; assert `invokeAction` fires once.
- **Suggested fix:** Atomically claim the execution: `UPDATE scheduled_executions SET started_at=$2 WHERE id=$1 AND started_at IS NULL RETURNING *`; skip if no row claimed.

### bug-015 — Secret-audit sanitizer strips only by key name, not by value
- **Severity:** Low (secret leakage if secret appears in a string value) ⚠
- **Area:** `cap-secrets`, `cap-audit` / `fn-secrets-01`
- **Location:** `services/secret-audit-handler/src/sanitizer.mjs::stripForbidden` (lines 13-25).
- **Root cause:** Redaction removes object entries whose **key** matches `FORBIDDEN_FIELDS`. A secret value embedded inside an allowed string field (e.g., a Vault log `message`/`error`/`request.path` containing the secret) survives and is published to `console.secrets.audit`.
- **Impact:** Potential secret material leaked into the Kafka audit topic depending on Vault audit-log structure.
- **Repro (bbx-secret-sanitize-value):** Feed a log entry where a forbidden value appears inside an allowed string field; assert it is redacted (currently passes through).
- **Suggested fix:** In addition to key-based stripping, redact known secret value patterns / hashed-value matching, or allow-list (rather than deny-list) the exported fields.

---

## Folded-in findings — verdicts

| id | verdict | note |
|----|---------|------|
| iso-001 | **Confirmed** → bug-003 | `findById` unscoped (line 91-98); actor-not-tenant check + fetch-before-gate (get-operation lines 80-88). |
| iso-002 | **Confirmed** → bug-001 (+ bug-002 for the role-forgery variant) | 8 capture actions decode unsigned JWT for `tenant_id`/`workspace_id`; tenant-config actions additionally forge roles. |
| iso-003 | **Confirmed** → bug-004 | `confirm-restore.action.ts:71-75` guards only when `body.tenant_id` present; service `confirm()` has no tenant gate. Initiate path is correct (required + unconditional), proving the asymmetry. |
| iso-004 | **Confirmed** → bug-005 | `refreshToken` overwrites `session.claims` without tenant/actor stability assertion (lines 185-232). |
| iso-005 | **Confirmed** → folded into bug-004 | Depends on iso-003; second-factor checks the *second* actor's tenant but not the *primary* actor's. |
| iso-006 | **Confirmed but not independently exploitable** | `CaptureConfigRepository.updateStatus/disable(id)` lack a tenant predicate (structural fragility), but callers (`pg/mongo-capture-disable.mjs`) gate via `findById(tenant, workspace, id)` first. Tracked as latent risk; fix by adding tenant/workspace predicate to the update for defense-in-depth. Not raised to its own P-level bug. |

## Coverage-gap-implied risks (from `audit/coverage.md` surface)
- **Webhook delivery worker absent from source** (bug-011): the SSRF re-validation and signing-on-send path cannot be tested; the egress client is the missing link. Prioritize a `bbx-`/integration test once the delivery worker exists.
- **Trust-boundary population of `callerContext` and capture-action identity** (bug-001/002/012): no black-box test exercises a *forged/unsigned* token against these actions; add cross-tenant probes with forged claims to the contract suite.
