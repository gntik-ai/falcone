## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add a case to `tests/unit/webhook-quota.test.mjs`
      that calls `checkDeliveryRateLimit('ws', {count: 100},
      100)` and asserts `allowed: false` (today it returns `true`).
- [ ] 1.2 [test] Add a case to
      `tests/integration/webhook-management.test.mjs` that PATCHes a
      subscription with `body: {tenant_id: 'other', status: 'active',
      consecutive_failures: 0, target_url: 'https://example.com/hook',
      event_types: ['document.created']}` and asserts the persisted row
      retained its original `tenant_id` and `status`.
- [ ] 1.3 [test] Add a case that boots the quota module without
      `pg.incrementRateCounter` and asserts the module throws
      `WebhookRateCounterNotConfiguredError` rather than falling back
      to the in-process Map.
- [ ] 1.4 [test] Add a case that invokes
      `actions/webhook-management.main({method: 'POST', path:
      '/v1/webhooks/subscriptions', auth: {}})` and asserts a `401
      missing_auth_context` envelope (today it lets `null` flow to the
      DB).
- [ ] 1.5 [test] Add a case that records the outbound headers from
      the delivery worker and asserts `x-platform-webhook-attempt` is
      NOT present.

## 2. Implementation

- [ ] 2.1 [fix] Change
      `services/webhook-engine/src/webhook-quota.mjs:7-10` to `allowed:
      count < limitPerMinute`; align with `checkSubscriptionQuota` at
      `:3-5`.
- [ ] 2.2 [fix] In
      `services/webhook-engine/actions/webhook-management.mjs:81`,
      build the update body from an explicit allow-list (`target_url`,
      `event_types`, `description`, `metadata`); never spread
      `body`.
- [ ] 2.3 [fix] Add `requireSubscriptionOwnership(subscription,
      auth)` at the top of every PATCH/pause/resume/delete/rotate
      handler asserting `subscription.tenant_id === auth.tenantId &&
      subscription.workspace_id === auth.workspaceId`.
- [ ] 2.4 [fix] Replace the module-level `Map` fallback at
      `services/webhook-engine/src/webhook-quota.mjs:12-22` with a
      hard boot-time assertion that `pg.incrementRateCounter` is
      callable; throw otherwise.
- [ ] 2.5 [fix] Add `assertAuthContext(auth)` at the top of
      `actions/webhook-management.mjs:38-44`; return `401
      missing_auth_context` when any of `tenantId`/`workspaceId`/`actorId`
      is missing or non-string.
- [ ] 2.6 [fix] Remove `x-platform-webhook-attempt` from outbound
      headers in `actions/webhook-delivery-worker.mjs:28`; receivers
      who need attempt detail can query `GET
      /v1/webhooks/subscriptions/{id}/deliveries/{deliveryId}`.

## 3. Validation

- [ ] 3.1 [test] Run `corepack pnpm test:unit -- webhook-quota`,
      `pnpm test:integration -- webhook-management`, and
      `openspec validate fix-f3-rate-limit-and-tenant-isolation
      --strict`; all green before merge.
