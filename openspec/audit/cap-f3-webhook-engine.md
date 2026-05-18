# Capability F3 — Webhook Engine

**Source locus:** `services/webhook-engine/` — 549 LOC across 11 `.mjs` files (7 library modules in `src/`, 4 action handlers in `actions/`) + 1 migration + 11 tests. Same "action-handlers consumed by an external runtime" pattern as the rest of the codebase — no HTTP/WS server bootstrap in this package.

**Method.** Read every file in the package end-to-end (no file exceeds 143 LOC), plus the migration and two representative tests. Did not consult `docs/`, `openspec/`, or `01-capability-map.md`.

Up-front observations:
- All four action `main(params)` handlers expect to be invoked by an external runtime (OpenWhisk per the capability map's gateway routes). They take dependency-injected `db`, `kafka`, `invoker`, `http`, `scheduler`, `env`, and consume them through duck-typed APIs.
- `package.json:8` has a `lint` placeholder. The `test` script does point at real test files (unlike most other action services in this audit), but uses a bare-glob (`../../tests/unit/webhook-*.test.mjs ...`) which is shell-globbing dependent.
- The package has no `authorization-policy` import. Authorization is implicit on `auth.tenantId`/`auth.workspaceId` passed through `params`. There is no scope check whatsoever.
- Five subscription audit topics are published (`console.webhook.subscription.{created,updated,deleted,paused,resumed}`, `console.webhook.secret.rotated`, `console.webhook.delivery.{succeeded,permanently_failed}`, `console.webhook.subscription.auto_disabled`).

---

## SPEC (what exists)

### S1. Event catalogue & subscription validation

- **WHEN** `isValidEventType(id)` is called, **THE SYSTEM SHALL** return `true` only for one of six hard-coded ids: `{document.created, document.updated, document.deleted, user.signed_up, function.completed, storage.object.created}` (`src/event-catalogue.mjs:1-13`).
- **WHEN** `validateSubscriptionInput({targetUrl, eventTypes})` runs, **THE SYSTEM SHALL** parse `targetUrl` via `new URL(...)` (throw `INVALID_URL` on parse failure), require `parsed.protocol === 'https:'`, reject hostnames matching `isPrivateHostname`, and require a non-empty `eventTypes[]` whose every entry passes `isValidEventType` (throw `INVALID_EVENT_TYPES` otherwise) (`src/webhook-subscription.mjs:19-39`).
- **WHEN** `isPrivateHostname(hostname)` runs, **THE SYSTEM SHALL** lowercase the input and return `true` for `localhost`, `127.0.0.1`, `::1`, or — only if `net.isIP(host)` — for `10.*`, `127.*`, `192.168.*`, the `172.{16-31}.*` range, or IPv6 prefixes `fc`/`fd`/`fe80:` (`src/webhook-subscription.mjs:9-17`).
- **WHEN** `buildSubscriptionRecord(input, context)` runs, **THE SYSTEM SHALL** validate input, then return a row `{id: uuid(), tenant_id, workspace_id, target_url, event_types, status: 'active', consecutive_failures: 0, max_consecutive_failures: context.maxConsecutiveFailures ?? 5, description, metadata: input.metadata ?? {}, created_by, created_at, updated_at, deleted_at: null}` (`src/webhook-subscription.mjs:41-60`).

### S2. Subscription state machine

- **WHEN** a status transition is requested, **THE SYSTEM SHALL** permit `active → {paused, disabled, deleted}`, `paused → {active, deleted}`, `disabled → {active, deleted}`, and reject all other transitions including any from `deleted` (`src/webhook-subscription.mjs:62-67`).
- **WHEN** `applyStatusTransition(subscription, status)` is called and the transition is allowed, **THE SYSTEM SHALL** return `{...subscription, status, updated_at: now}`; otherwise throw `INVALID_STATUS_TRANSITION` (`src/webhook-subscription.mjs:69-80`).
- **WHEN** `softDelete(subscription)` is called, **THE SYSTEM SHALL** apply the `'deleted'` transition and stamp `deleted_at = now` (`src/webhook-subscription.mjs:82-84`).

### S3. Signing-secret crypto

- **WHEN** `generateSigningSecret()` is called, **THE SYSTEM SHALL** return 32 random bytes as hex (`src/webhook-signing.mjs:8-10`).
- **WHEN** `encryptSecret(plaintext, masterKey)` runs, **THE SYSTEM SHALL** normalise the master key to a 32-byte buffer (SHA-256 of the input if not already 32 bytes), pick a 12-byte random IV, run AES-256-GCM, and return `{cipher: base64(ciphertext||tag), iv: base64(iv)}` (`src/webhook-signing.mjs:3-22`).
- **WHEN** `decryptSecret(cipher, iv, masterKey)` runs, **THE SYSTEM SHALL** split the trailing 16 bytes as the auth tag, verify, and return the plaintext (`src/webhook-signing.mjs:24-33`).
- **WHEN** `computeSignature(rawBody, secret)` runs, **THE SYSTEM SHALL** return `\`sha256=${HMAC-SHA256(secret, rawBody)hex}\`` (`src/webhook-signing.mjs:35-38`).
- **WHEN** `verifySignature(rawBody, secret, header)` runs, **THE SYSTEM SHALL** compute the expected signature and compare via `crypto.timingSafeEqual` after a length check (`src/webhook-signing.mjs:40-44`).
- **WHEN** `verifyAgainstSecretSet(rawBody, signatureHeader, secretRecords, now)` runs, **THE SYSTEM SHALL** iterate the records and accept the first match whose `status !== 'revoked'` AND (`status !== 'grace'` OR `grace_expires_at > now`) (`src/webhook-signing.mjs:50-56`).

### S4. Retry policy

- **WHEN** `computeNextDelay(attemptNum, {baseMs, maxMs, random})` runs, **THE SYSTEM SHALL** return `min(maxMs, exponential + jitter)` where `exponential = min(maxMs, baseMs * 2^(attemptNum-1))` and `jitter = floor(exponential * 0.2 * random())`; for `attemptNum <= 0` it **SHALL** return `null` (`src/webhook-retry-policy.mjs:1-6`).
- **WHEN** `hasRetriesRemaining(attemptCount, maxAttempts)` runs, **THE SYSTEM SHALL** return `attemptCount < maxAttempts` (`src/webhook-retry-policy.mjs:8-10`).
- **WHEN** `buildRetryPolicy(env)` runs, **THE SYSTEM SHALL** default to `{baseMs: 1000, maxMs: 300000, maxAttempts: 5}` overridable by `WEBHOOK_BASE_BACKOFF_MS / WEBHOOK_MAX_BACKOFF_MS / WEBHOOK_MAX_RETRY_ATTEMPTS` (`src/webhook-retry-policy.mjs:18-24`).

### S5. Quota

- **WHEN** `checkSubscriptionQuota(workspaceId, currentCount, limit)` runs, **THE SYSTEM SHALL** return `{allowed: currentCount < limit, currentCount, limit}` (`src/webhook-quota.mjs:3-5`).
- **WHEN** `checkDeliveryRateLimit(workspaceId, windowCounterRow, limitPerMinute)` runs, **THE SYSTEM SHALL** return `{allowed: count <= limitPerMinute, count, limitPerMinute}` (`src/webhook-quota.mjs:7-10`). (Note: inconsistent inequality with `checkSubscriptionQuota`; see B2.)
- **WHEN** `incrementRateCounter(pg, workspaceId)` runs and `pg.incrementRateCounter` exists, **THE SYSTEM SHALL** delegate; otherwise increment a module-level in-process Map keyed by workspace with a 60 s sliding window (`src/webhook-quota.mjs:12-22`).
- **WHEN** `getQuotaConfig(env)` runs, **THE SYSTEM SHALL** return `{maxSubscriptionsPerWorkspace: WEBHOOK_MAX_SUBSCRIPTIONS_PER_WORKSPACE ?? 25, maxDeliveriesPerMinutePerWorkspace: WEBHOOK_MAX_DELIVERIES_PER_MINUTE_PER_WORKSPACE ?? 100}` (`src/webhook-quota.mjs:29-34`).

### S6. Delivery primitives

- **WHEN** `buildDeliveryRecord(subscription, event, config)` runs, **THE SYSTEM SHALL** return `{id: uuid(), subscription_id, tenant_id, workspace_id, event_type: event.eventType, event_id: event.eventId, payload_ref: null, payload_size: Buffer.byteLength(JSON.stringify(event.data ?? {})), status: 'pending', attempt_count: 0, max_attempts: config.maxAttempts ?? 5, next_attempt_at: now, created_at, updated_at}` (`src/webhook-delivery.mjs:7-25`).
- **WHEN** `enforcePayloadSizeLimit(payload, maxBytes)` runs and the JSON-encoded body fits, **THE SYSTEM SHALL** return `{payload, payload_ref: null, payload_size, truncated: false}`; otherwise it **SHALL** replace `payload.data` with `{...payload.data, _truncated: true}` and return `{payload: truncatedPayload, payload_ref: \`s3://webhook-payloads/${uuid()}\`, payload_size: original bytes, truncated: true}` (`src/webhook-delivery.mjs:58-71`).
- **WHEN** `isTerminal(delivery)` runs, **THE SYSTEM SHALL** return `true` for `status ∈ {succeeded, permanently_failed, cancelled}` (`src/webhook-delivery.mjs:40-42`).
- **WHEN** `shouldAutoDisable(subscription, threshold)` runs, **THE SYSTEM SHALL** return `subscription.consecutive_failures >= threshold` (`src/webhook-delivery.mjs:44-46`).

### S7. Audit event shapes

- **WHEN** any audit builder (`subscriptionCreatedEvent`, `…UpdatedEvent`, `…DeletedEvent`, `…PausedEvent`, `…ResumedEvent`, `secretRotatedEvent`, `deliverySucceededEvent`, `deliveryPermanentlyFailedEvent`, `subscriptionAutoDisabledEvent`) runs, **THE SYSTEM SHALL** emit `{tenantId, workspaceId, actorId, action, resourceId, timestamp}` with `signingSecret` and `rawPayload` keys explicitly stripped (`src/webhook-audit.mjs:1-25`).

### S8. Management HTTP-shaped action (`actions/webhook-management.mjs`)

- **WHEN** `main` is invoked, **THE SYSTEM SHALL** route by `(method, pathParts)` where `pathParts` strips the `/v1/webhooks/?` prefix (`actions/webhook-management.mjs:11-13, 38-47`).
- **WHEN** `GET /v1/webhooks/event-types` is called, **THE SYSTEM SHALL** return `200 {eventTypes: EVENT_CATALOGUE}` (`:45`).
- **WHEN** `POST /v1/webhooks/subscriptions` is called, **THE SYSTEM SHALL** check workspace subscription quota, build + insert the subscription, generate + AES-256-GCM-encrypt a signing secret using `env.WEBHOOK_SIGNING_KEY ?? 'development-signing-key'`, publish `console.webhook.subscription.created`, and return `201 {subscriptionId, targetUrl, eventTypes, description, status, consecutiveFailures, createdAt, updatedAt, signingSecret}` (`:43, :49-65`).
- **WHEN** `GET /v1/webhooks/subscriptions` is called, **THE SYSTEM SHALL** return `200 {items, nextCursor: null}` (`:67-70`).
- **WHEN** `GET /v1/webhooks/subscriptions/{id}` is called against a row that does not belong to the auth context or is `deleted_at`-tombstoned, **THE SYSTEM SHALL** return `404` (`:32-35, :72-76`).
- **WHEN** `PATCH /v1/webhooks/subscriptions/{id}` is called, **THE SYSTEM SHALL** re-validate the merged `targetUrl`/`eventTypes`, call `db.updateSubscription(id, { ...body, target_url, event_types })`, publish `…updated`, return `200 responseSubscription` (`:78-87`).
- **WHEN** `POST /v1/webhooks/subscriptions/{id}/pause` (resp. `…/resume`) is called, **THE SYSTEM SHALL** apply the state transition and on success publish the corresponding audit event, returning `200`; invalid transitions yield `409 INVALID_STATUS_TRANSITION` (`:89-107`).
- **WHEN** `DELETE /v1/webhooks/subscriptions/{id}` is called, **THE SYSTEM SHALL** soft-delete the subscription, cancel pending deliveries, publish `…deleted`, and return `204` (`:109-114`).
- **WHEN** `POST /v1/webhooks/subscriptions/{id}/rotate-secret` is called, **THE SYSTEM SHALL** generate a new signing secret, encrypt it with `WEBHOOK_SIGNING_KEY`, call `db.rotateSecret(id, encrypted, graceExpiresAt)` with grace `body.gracePeriodSeconds ?? WEBHOOK_SECRET_GRACE_PERIOD_SECONDS ?? 86400` seconds, publish `…secret.rotated`, and return `200 {newSigningSecret, gracePeriodSeconds, graceExpiresAt}` (`:116-124`).
- **WHEN** `GET /v1/webhooks/subscriptions/{id}/deliveries` (and `…/deliveries/{deliveryId}`) is called, **THE SYSTEM SHALL** return `200 {items, nextCursor: null}` or the single delivery (`:126-135`).

### S9. Dispatcher (`actions/webhook-dispatcher.mjs`)

- **WHEN** `WEBHOOK_ENGINE_ENABLED` is `'false'`, **THE SYSTEM SHALL** return `{queued: 0, skipped: 'disabled'}` and do nothing (`:6`).
- **WHEN** an event arrives, **THE SYSTEM SHALL** look up matching subscriptions via `db.findSubscriptionsForEvent(tenantId, workspaceId, eventType)`, increment the per-workspace rate counter for each subscription, skip if over the per-minute limit, otherwise insert a delivery row and (if `invoker.invoke` is supplied) invoke `webhook-delivery-worker` with `{deliveryId}` (`:7-19`).

### S10. Delivery worker (`actions/webhook-delivery-worker.mjs`)

- **WHEN** invoked with `deliveryId`, **THE SYSTEM SHALL** load the delivery, its subscription, its decrypted signing secrets (`revealSecretRecords` via `WEBHOOK_SIGNING_KEY`), and the event payload (`:8-12`).
- **WHEN** assembling the request, **THE SYSTEM SHALL** build a payload envelope `{id: delivery.id, timestamp, eventType, workspaceId, data}`, apply payload-size enforcement (`WEBHOOK_MAX_PAYLOAD_BYTES ?? 524288`), pick the first `secret.status === 'active'` secret (else fallback to the first one), and POST the body with `redirect: 'manual'`, content-type `application/json`, and headers `x-platform-webhook-id`, `…-timestamp`, `…-event`, `…-signature`, `…-attempt`, `user-agent: 'PlatformWebhook/1.0'` (`:13-32`).
- **WHEN** the response status is 2xx, **THE SYSTEM SHALL** record a `'succeeded'` attempt, update the delivery with `status: 'succeeded', attempt_count, payload_ref, payload_size`, publish `…delivery.succeeded`, and return `{status: 'succeeded', headers: response.headers}` (`:35-41`).
- **WHEN** the response status is non-2xx, **THE SYSTEM SHALL** record a `'failed'` attempt, update the delivery to `failed`, and delegate to the retry scheduler (`:42-44`).
- **WHEN** the fetch throws (incl. AbortSignal timeout `WEBHOOK_RESPONSE_TIMEOUT_MS ?? 30000`), **THE SYSTEM SHALL** record a `'timed_out'` attempt, update the delivery to `failed`, and delegate to the retry scheduler (`:45-49`).

### S11. Retry scheduler (`actions/webhook-retry-scheduler.mjs`)

- **WHEN** invoked, **THE SYSTEM SHALL** load the delivery; if missing return `{status: 'missing'}`; if the subscription is `'deleted'`/`'paused'` return `{status: 'cancelled'}` (`:7-10`).
- **WHEN** retries remain (`attemptCount < (delivery.max_attempts ?? policy.maxAttempts)`), **THE SYSTEM SHALL** compute the next attempt time via the retry policy, set `status: 'pending', next_attempt_at`, re-invoke `webhook-delivery-worker`, and return `{status: 'scheduled', nextAttemptAt}` (`:11-16`).
- **WHEN** retries are exhausted, **THE SYSTEM SHALL** set `status: 'permanently_failed', next_attempt_at: null`, increment the subscription's failure counter, publish `…delivery.permanently_failed`, and if `subscription.consecutive_failures >= WEBHOOK_AUTO_DISABLE_THRESHOLD ?? 5` set `status: 'disabled'` and publish `…subscription.auto_disabled` (`:17-29`).

### S12. Persistence schema (`migrations/001-webhook-subscriptions.sql`)

- **WHEN** the migration runs, **THE SYSTEM SHALL** create `webhook_subscriptions(id UUID PK, tenant_id TEXT NN, workspace_id TEXT NN, target_url TEXT NN, event_types TEXT[] NN, status TEXT NN DEFAULT 'active', consecutive_failures INT NN DEFAULT 0, max_consecutive_failures INT NN DEFAULT 5, description TEXT, created_by TEXT NN, timestamps, deleted_at, metadata JSONB NN DEFAULT '{}')` plus three partial indexes (`tenant_id,workspace_id`, `status`, GIN on `event_types`, all `WHERE deleted_at IS NULL`) (`migrations/001-webhook-subscriptions.sql:1-19`).
- **WHEN** the migration runs, **THE SYSTEM SHALL** create `webhook_signing_secrets(id UUID PK, subscription_id UUID FK, secret_cipher TEXT NN, secret_iv TEXT NN, status TEXT NN DEFAULT 'active', grace_expires_at TIMESTAMPTZ, created_at, revoked_at)` (`:21-30`).
- **WHEN** the migration runs, **THE SYSTEM SHALL** create `webhook_deliveries(id UUID PK, subscription_id UUID FK, tenant_id, workspace_id, event_type, event_id, payload_ref, payload_size, status DEFAULT 'pending', attempt_count DEFAULT 0, max_attempts DEFAULT 5, next_attempt_at, timestamps, UNIQUE(subscription_id, event_id))` plus three indexes (`subscription_id`, `(status, next_attempt_at) WHERE status='pending'`, `(tenant_id, workspace_id)`) (`:33-52`).
- **WHEN** the migration runs, **THE SYSTEM SHALL** create `webhook_delivery_attempts(id UUID PK, delivery_id UUID FK, attempt_num INT NN, attempted_at, http_status, response_ms, error_detail, outcome TEXT NN)` (`:54-64`).

---

## GAPS

### G-cross. Cross-cutting

1. **No HTTP/WS server, no Kafka consumer bootstrap.** Same pattern as the other action services. The handlers' `main(params)` shape is OpenWhisk-y; the gateway routes that hand traffic to them live in `services/gateway-config/`.
2. **No scope/role authorization anywhere in the package.** `webhook-management.mjs:38-47` reads `auth.tenantId`/`workspaceId`/`actorId` and uses them as tenancy filters, but does no `auth.scopes` check. By contrast, every backup-status action in B1 audit checks `token.scopes.includes('backup-status:read:own')`. Webhooks are effectively self-authorising on tenant identity alone.
3. **`auth` fields are not validated for presence.** If `auth.tenantId`/`workspaceId`/`actorId` are missing, `ctx` carries undefined values that flow into `buildSubscriptionRecord` and become the row's `tenant_id`/`workspace_id`/`created_by`. The migration enforces `NOT NULL` on these columns, so the DB rejects, but with a low-level Postgres error rather than a `400` envelope (`actions/webhook-management.mjs:38-44`).
4. **`auth` is implicitly trusted.** Same upstream-trust pattern as elsewhere — if a misconfigured gateway passes a forged `auth.tenantId`, tenant isolation collapses.
5. **Cross-replica state is fragile.** `webhook-quota.incrementRateCounter` falls back to a module-level Map keyed by workspace. With more than one process replica, each has its own counter and the per-minute limit is multiplied by the replica count.
6. **No catalogue evolution policy.** `event-catalogue.mjs:1-13` hard-codes six event types. There is no per-plan or per-workspace gating; adding a seventh type universally opens it to every subscription on next deploy.

### G-validation

- **G-S1.1** `isPrivateHostname` only checks if the literal hostname is a private IP. **No DNS resolution** — a hostname like `attacker.example` resolving to `192.168.1.1` passes validation. SSRF vector. See B1.
- **G-S1.2** `isPrivateHostname` IPv6 logic short-circuits on `net.isIP(host) === false` (line 12), so any non-IP hostname skips the `fc`/`fd`/`fe80:` checks. With B1, this means the IPv6 link-local guard is vestigial for hostnames.
- **G-S1.3** `validateSubscriptionInput` rejects HTTP (`protocol !== 'https:'`) — good. No additional check on port (`:8080` allowed), no allow-list of TLD or domain.

### G-management

- **G-S8.1** `webhook-management.mjs:43, 141` — `signingKey = env.WEBHOOK_SIGNING_KEY ?? 'development-signing-key'`. Same fallback in two places. See B2.
- **G-S8.2** `webhook-management.mjs:81` — PATCH spreads `body` into `db.updateSubscription`: `{ ...body, target_url, event_types }`. The handler does not field-allowlist. If `db.updateSubscription` blindly applies any field, a client could overwrite `status`, `tenant_id`, `workspace_id`, `consecutive_failures`, etc. See B6.
- **G-S8.3** `webhook-management.mjs:55` — `buildSubscriptionRecord(body, ctx)` reads `context.maxConsecutiveFailures` from the second arg, but the handler passes `ctx = {tenantId, workspaceId, actorId}` only. There is no path for a caller to set the per-subscription `max_consecutive_failures`; the field is hard-coded to `5` via the `?? 5` fallback at `webhook-subscription.mjs:52`.
- **G-S8.4** No quota check on rotate-secret. `webhook-management.mjs:116-124` issues unbounded rotations.
- **G-S8.5** PATCH does not republish a `secret.rotated`-style event if `target_url` changes. A new URL silently inherits the existing signing secret.
- **G-S8.6** No pagination cursor returned (`{nextCursor: null}` always — `:69, :128`). Either list endpoints are unpaginated (caller filters), or the handler does not honour `query.limit`/`cursor`.
- **G-S8.7** `webhook-management.mjs:34` — `requireSubscription` enforces tenant/workspace match. Good. But the handler does NOT enforce that the `auth.actorId` has any specific role within the workspace; any authenticated principal of the same workspace can pause/resume/delete any subscription, including one created by someone else.
- **G-S8.8** `cancelPendingDeliveries(subscription.id)` is called on soft-delete but not on `pause` (`:111`). A paused subscription would not have new deliveries dispatched (per dispatcher subscription lookup), but any already-queued deliveries continue until retry-scheduler at `:10` checks `status` and returns `cancelled`. Smell, not a bug.

### G-dispatcher

- **G-S9.1** `webhook-dispatcher.mjs:8` — `db.findSubscriptionsForEvent` is opaque. The handler relies on it filtering `status='active', deleted_at IS NULL`. Verify the DB impl.
- **G-S9.2** Rate limiter increments the per-workspace counter for **every** subscription matched, even those that turn out to be quota-skipped. The counter inflates above the true delivered count.
- **G-S9.3** No idempotency at the dispatcher level. If the same Kafka event is replayed (consumer rebalance), the dispatcher re-inserts deliveries. The `UNIQUE(subscription_id, event_id)` constraint on `webhook_deliveries` saves this — the `insertDelivery` will fail/return falsy on duplicate, and `if (!inserted) continue` (`:15`) is the dedup. OK.

### G-delivery worker

- **G-S10.1** `webhook-delivery-worker.mjs:11` — `secret = secretRows.find(active) ?? secretRows[0]`. If `secretRows` is empty, `secret` is `undefined`; the next access at `:27` (`secret.secret`) throws TypeError with no graceful handling. See B7.
- **G-S10.2** `webhook-delivery-worker.mjs:19-33` — uses globalThis `fetch` by default. `fetch` honours `HTTP_PROXY`/`HTTPS_PROXY` environment variables (Node ≥ 24). An attacker who controls the worker's env can redirect outbound webhooks to internal services. SSRF-by-proxy.
- **G-S10.3** Worker constructs `x-platform-webhook-timestamp: String(Math.floor(Date.now()/1000))` but **does not include the timestamp in the signed body**. Replay attacks against the receiver are not prevented. See B5.
- **G-S10.4** `enforcePayloadSizeLimit` returns `payload_ref: 's3://webhook-payloads/<uuid>'` for oversized payloads but **no S3 client is referenced anywhere in the package**. The original `payload.data` is discarded, replaced by `{_truncated: true}`. See B3.
- **G-S10.5** Worker success path does not set `next_attempt_at: null` when updating the delivery (`:37`). Minor — the row remains with the historic `next_attempt_at` value.
- **G-S10.6** Worker logs no structured error context on fetch throws; only the message is recorded in `error_detail` (`:46`).

### G-retry scheduler

- **G-S11.1** `webhook-retry-scheduler.mjs:10` — `['deleted', 'paused']` triggers cancellation. `'disabled'` is not in the list, so a disabled subscription's queued deliveries continue to be retried. After success, the worker publishes `…delivery.succeeded` even though the subscription is disabled — likely unintended.
- **G-S11.2** `incrementSubscriptionFailures(id)` (DI) is not in source. Atomicity depends on the impl. If implemented as `UPDATE ... SET consecutive_failures = consecutive_failures + 1`, it's atomic; if `SELECT` then `UPDATE`, two concurrent permanent-fail paths could double-count.
- **G-S11.3** When `shouldAutoDisable` fires, the scheduler updates `status: 'disabled'` but does not flip the subscription's deliveries to `cancelled`. Combined with G-S11.1, in-flight deliveries continue.

### G-signing

- **G-S3.1** `verifyAgainstSecretSet` iterates secrets sequentially and short-circuits on first match (`webhook-signing.mjs:51-55`). The number of comparisons leaks whether the active or grace secret matched. Minor side-channel.
- **G-S3.2** `verifySignature` length-checks before `timingSafeEqual` (`:43`). If lengths differ, returns `false` immediately with no constant-time guarantee on length-mismatched inputs — minor for HMAC-SHA256-hex which is always 64 hex chars.

### G-tests

- **G-T1** `package.json:7` test script: `node --test ../../tests/unit/webhook-*.test.mjs ../../tests/integration/webhook-*.test.mjs ../../tests/contracts/webhook-api.contract.test.mjs`. Relative paths assume `pnpm test` is run from the package directory. The contract test passes synthetic `db` mocks — no real Postgres state.
- **G-T2** No test exercises the SSRF guard against hostname resolution attacks (only literal IP prefixes are checked in `tests/unit/webhook-subscription.test.mjs`, per the test pattern verified by reading the integration test fixture).
- **G-T3** No test asserts the fallback to `'development-signing-key'` (B2) is detected/refused in production.
- **G-T4** The integration test in `tests/integration/webhook-delivery-worker.test.mjs` uses an in-memory `Map`-based db with the literal cipher `'5vAkzPLhHf5l6NI7afqXNy2wK4fA'` and IV `'c29tZWl2'` — a hard-coded test fixture that wouldn't decrypt cleanly with the encrypt/decrypt round-trip. The test then re-encrypts with a known plaintext for the real assertions. Confusing setup, but functional.

### G-database

- **G-DB.1** `webhook_signing_secrets` has no UNIQUE constraint on `subscription_id, status='active'`. Two simultaneous rotations could leave two active secrets, both used.
- **G-DB.2** `webhook_deliveries.UNIQUE(subscription_id, event_id)` is the only dedup. Event IDs from upstream sources must be deterministic for this to work.
- **G-DB.3** No FK constraint on `webhook_subscriptions.tenant_id/workspace_id`. Orphan rows are possible if a tenant is deleted out from under the table.
- **G-DB.4** `webhook_signing_secrets.subscription_id` has FK but no `ON DELETE CASCADE`. Deleting a subscription leaves orphan signing-secret rows.

---

## BUGS

### Confirmed (verified-by-author from the cited lines)

- **B1. SSRF via DNS-resolved private hostname.**
  `services/webhook-engine/src/webhook-subscription.mjs:9-17` (**verified-by-author**) — `isPrivateHostname` returns `false` immediately when `net.isIP(host)` is `false` (`:12`). A hostname like `internal.example.com` that resolves to `192.168.1.1` (or `metadata.google.internal` resolving to `169.254.169.254`) passes validation. The subsequent webhook POST from `webhook-delivery-worker.mjs:19-33` will hit the private address. No DNS pre-resolution, no resolved-IP check, no allow-list — classic SSRF.

- **B2. Default master encryption key is the literal string `'development-signing-key'`.**
  `services/webhook-engine/actions/webhook-management.mjs:43, 141` (**verified-by-author**) — `env.WEBHOOK_SIGNING_KEY ?? 'development-signing-key'`. This key is the master AES-256-GCM key for *every* webhook signing secret in the DB. If the env var is absent in production, every secret in `webhook_signing_secrets` is encrypted with this known string and a leaked DB dump can be decrypted instantly. The fallback fires silently — no startup check, no warning, no production guard.

- **B3. Oversized payload "spill to S3" is a fiction — payloads are silently truncated with audit-only `payload_ref`.**
  `services/webhook-engine/src/webhook-delivery.mjs:58-71` (**verified-by-author**) — when the payload exceeds `maxBytes`, the function replaces `payload.data` with `{...payload.data, _truncated: true}` and returns a `payload_ref: 's3://webhook-payloads/<uuid>'`. **There is no S3 client in the package** (`grep -l 'S3\\|s3 .' services/webhook-engine` returns nothing). The original data is lost, the receiver gets a marker-only body, the `payload_ref` points at nothing.

- **B4. `checkDeliveryRateLimit` off-by-one — allows N+1 deliveries per minute.**
  `services/webhook-engine/src/webhook-quota.mjs:7-10` (**verified-by-author**) — `allowed: count <= limitPerMinute`. With `limitPerMinute = 100`, the 100th delivery has `count = 100` after increment, the check `100 <= 100` returns `true`, the 101st has `count = 101` and is rejected. Confirmed: limit `N` permits `N+1` deliveries.
  Compare with `checkSubscriptionQuota` (`:3-5`) which uses `currentCount < limit` (correct). The two functions disagree on boundary semantics.

- **B5. Webhook signature does not include a timestamp — replay-prone.**
  `services/webhook-engine/actions/webhook-delivery-worker.mjs:27` (**verified-by-author**) — `'x-platform-webhook-signature': computeSignature(rawBody, secret.secret)`. The timestamp header `'x-platform-webhook-timestamp'` (`:25`) is sent alongside the signature but **not signed**. An attacker intercepting a delivery can replay the exact body + headers indefinitely against the receiver; receiver has no way to detect age. Modern webhook signing (Stripe, GitHub) signs `${timestamp}.${body}` or similar.

- **B6. PATCH endpoint may overwrite tenant-isolated columns.**
  `services/webhook-engine/actions/webhook-management.mjs:81` (**verified-by-author**) — `await db.updateSubscription(subscription.id, { ...body, target_url: validated.targetUrl, event_types: validated.eventTypes })`. The body is spread first. If `db.updateSubscription` blindly applies any included field, a client passing `body: {tenant_id: 'other-tenant', status: 'active', consecutive_failures: 0, max_consecutive_failures: 99999, …}` can re-tenant the subscription, re-enable a disabled one, or zero out failure counters. Whether the bug is exploitable depends entirely on the (out-of-package) `db.updateSubscription` implementation — but the handler offers no allow-list defence.

- **B7. Worker throws TypeError if a subscription has no signing secrets.**
  `services/webhook-engine/actions/webhook-delivery-worker.mjs:11-27` (**verified-by-author**) — `secret = secretRows.find(active) ?? secretRows[0]`. If `secretRows` is empty (e.g., manual DB cleanup, or a rotation race that revoked everything), `secret` is `undefined`. `secret.secret` at `:27` throws `Cannot read properties of undefined`. The worker has no try/catch around this access; the error propagates and the delivery never advances. No `permanently_failed` transition fires.

- **B8. Disabled subscriptions are not in the scheduler's cancellation list.**
  `services/webhook-engine/actions/webhook-retry-scheduler.mjs:10` (**verified-by-author**) — `['deleted', 'paused'].includes(subscription.status)`. A subscription auto-disabled by the threshold logic at `:22-26` has `status = 'disabled'`, which is not in the list. Already-queued deliveries continue to retry. If one succeeds, the worker emits `…delivery.succeeded` for a disabled subscription.

### Likely (smells / leaks / race conditions)

- **B9. Replicas inflate per-workspace rate limits.** `services/webhook-engine/src/webhook-quota.mjs:1, 12-22` — module-level `counters` Map. With `replicas: N`, the effective limit is `N × WEBHOOK_MAX_DELIVERIES_PER_MINUTE_PER_WORKSPACE`. The fallback path (`!pg.incrementRateCounter`) is what the package ships; a real shared counter requires the DI to provide one.

- **B10. `auth.tenantId`/`workspaceId`/`actorId` not validated for presence.** `actions/webhook-management.mjs:38-44`. Missing values flow to `buildSubscriptionRecord`, which writes `null` into NN columns → DB error envelope is opaque.

- **B11. PATCH does not re-validate `body.targetUrl` against `isPrivateHostname` if the body provides only a hostname change with the existing event-types.** Actually it does (line 80 calls `validateSubscriptionInput` with `targetUrl: body.targetUrl ?? subscription.target_url`). OK. But: if the gateway forwards `body.targetUrl: undefined` (rather than omitting it), the `??` picks the existing URL — fine. Mark as **non-bug after verification**.

- **B12. `WEBHOOK_AUTO_DISABLE_THRESHOLD` (`actions/webhook-retry-scheduler.mjs:22`) defaults to `5` but `webhook_subscriptions.max_consecutive_failures` defaults to `5` too** (`migrations/001-webhook-subscriptions.sql:9`). The scheduler reads the env-level threshold, not the per-subscription `max_consecutive_failures` column. The column exists but is never consulted by the runtime — dead schema field.

- **B13. `db.updateSubscription` ignores `created_by`/`tenant_id`/`workspace_id`/`metadata`/`consecutive_failures` (if it does)** — opaque. Combined with B6, a hostile PATCH body's only defence is the unseen DB impl.

- **B14. Per-attempt headers leak attempt count to the receiver.** `actions/webhook-delivery-worker.mjs:28` — `x-platform-webhook-attempt`. Useful for receiver, but combined with auto-disable (B8) means an attacker who replies 429-then-200 can probe the threshold.

- **B15. `fetch` is the global default, susceptible to proxy env.** `actions/webhook-delivery-worker.mjs:7` — `http = fetch`. If the worker pod has `HTTPS_PROXY` set, outbound webhooks go through that proxy with no allow-list.

- **B16. `webhook_signing_secrets` lacks UNIQUE on `(subscription_id, status='active')`.** Two concurrent rotations could leave two `active` rows; worker's `find(active)` picks the first.

- **B17. `webhook_signing_secrets` FK on `subscription_id` has no `ON DELETE CASCADE`.** Soft-deleted subscriptions accumulate orphan signing-secret rows forever. (Even though the subscription is soft-deleted, not removed, the orphan only materialises if hard-deletion is ever done — minor today.)

- **B18. PATCH doesn't audit `target_url` changes specifically.** `subscriptionUpdatedEvent` is opaque to which fields changed. An auditor cannot detect "URL changed from X to Y".

- **B19. `subscription.consecutive_failures` is reset only by `db.updateSubscription`** — there is no source-of-truth resetter on a successful delivery. The worker's success path (`:37`) does not patch the subscription. If a webhook flaps fail/succeed, failures accumulate across the successful runs.

- **B20. Delivery worker's payload envelope uses `delivery.id` as `id`, not `event.eventId`.** `src/webhook-delivery.mjs:48-56`. The receiver cannot dedupe by source event id because the field is the platform-internal delivery id (different on each retry of the same event).

### Needs verification

- **B21. Whether `db.updateSubscription` actually allow-lists fields.** Critical for B6 — opaque DB impl could either save or doom the system.
- **B22. Whether `db.findSubscriptionsForEvent` filters `status = 'active' AND deleted_at IS NULL`.** Confirm with the implementation file outside this package.
- **B23. Whether `db.rotateSecret` flips the prior active secret to `'grace'` status with `grace_expires_at`.** The handler at `actions/webhook-management.mjs:121` calls `db.rotateSecret(id, encrypted, graceExpiresAt)` but the API contract for this method is implicit. If it inserts a new `active` row without flipping the old one, two-active-secrets state (B16) is the default.
- **B24. Whether `db.incrementSubscriptionFailures` is atomic.** If not, concurrent failures double-count.
- **B25. Whether `db.cancelPendingDeliveries(subscription.id)` flips delivery status to `cancelled` or just deletes them.** Affects audit completeness.
- **B26. Whether the gateway's `webhook-engine` route ingresses sanitise `body.tenant_id`/`workspace_id`/`status` before forwarding to the action.** B6 mitigation could live at the gateway.

---

## Scope note for downstream spec authoring

F3 is the most complete of the action services audited — it has a real test suite (G-T1), a coherent migration, and one of the more fleshed-out audit-event sets. Three security items must be addressed before any spec proposal:

1. **B1 (SSRF via DNS).** The fix is either pre-resolve hostnames and re-check the resolved IPs against the private-IP list (and forbid any address mismatch between validation and POST), or proxy outbound webhooks through a vetted egress with allow-list. Without this, the webhook engine is a generic-purpose internal-network probe.
2. **B2 (default master key).** The fallback must be removed or replaced with a startup assertion (`if (env === 'production' && WEBHOOK_SIGNING_KEY === 'development-signing-key') process.exit(1)`).
3. **B3 (oversized payload silent truncation).** Either implement the S3 spillover (the `payload_ref` shape suggests intent) or fail the delivery with `413`-equivalent retry semantics. Today's behaviour silently corrupts the delivery contract.

Secondary cleanup before specs:

- **B4** (off-by-one rate limit) and **B12** (dead `max_consecutive_failures` column) are quick fixes.
- **B5** (no timestamp in signature) needs a header convention change — coordinate with whatever consumers exist.
- **B6** (PATCH body spread) needs an explicit allow-list of patchable fields.
- **B7/B8** (worker TypeError on no secrets; disabled subscriptions retried) are robustness items.
- **G-cross.2** (no scope authorization) is the largest structural gap. Decide whether the API gateway provides scope checks for `/v1/webhooks/*` and document that contract, or add per-action scope checks.

After these, the rest of F3 can be spec'd straightforwardly: the migration, state machine, retry policy, and event catalogue are all clean.
