## Why

Five defects in the webhook engine's rate-limiter, PATCH handler, and
auth-field handling together let a tenant escape per-workspace quotas
and silently re-tenant subscriptions. From
`openspec/audit/cap-f3-webhook-engine.md`:

- **B4** (`services/webhook-engine/src/webhook-quota.mjs:7-10`) —
  `allowed: count <= limitPerMinute` is off-by-one. With
  `limitPerMinute = 100`, the 100th delivery has `count = 100` and is
  allowed, the 101st is rejected. The limiter ships N+1 deliveries per
  minute. Compare with `checkSubscriptionQuota` (`:3-5`) which uses
  `<` correctly.
- **B6** (`services/webhook-engine/actions/webhook-management.mjs:81`)
  — `db.updateSubscription(id, { ...body, target_url, event_types })`.
  The body is spread before the validated overrides. If the DB layer
  blindly persists fields, a client can pass `tenant_id`, `status`,
  `consecutive_failures`, `max_consecutive_failures` and re-tenant or
  zero-out a subscription. No allow-list defence in the handler.
- **B9** (`services/webhook-engine/src/webhook-quota.mjs:1, 12-22`) —
  the fallback rate counter is a module-level `Map`. With `replicas:
  N`, the effective limit is `N × limitPerMinute`.
- **B10** (`services/webhook-engine/actions/webhook-management.mjs:38-44`)
  — `auth.tenantId`/`workspaceId`/`actorId` are not validated for
  presence. Missing values flow into `buildSubscriptionRecord` and
  the DB rejects with a `NOT NULL` violation rather than a
  `400`-shaped envelope.
- **B14** (`services/webhook-engine/actions/webhook-delivery-worker.mjs:28`)
  — `x-platform-webhook-attempt` exposes the per-attempt count to the
  receiver. Combined with auto-disable, an attacker who responds
  `429`-then-`200` can probe the threshold.

## What Changes

- Change `checkDeliveryRateLimit` to `count < limitPerMinute`; make
  the two quota functions agree on boundary semantics.
- In PATCH, build the update body from an explicit allow-list
  (`target_url`, `event_types`, `description`, `metadata`) and ignore
  everything else; assert the row's `tenant_id` and `workspace_id`
  match `auth.*` before calling `db.updateSubscription`.
- Replace the module-level Map fallback with a hard requirement that
  `pg.incrementRateCounter` is wired; throw at boot if not.
- Validate `auth.tenantId`/`workspaceId`/`actorId` at handler entry;
  return `401 missing_auth_context` instead of letting DB constraints
  reject opaquely.
- Drop `x-platform-webhook-attempt` from outbound headers; expose
  attempt count via the `x-platform-webhook-delivery-id`
  cross-reference instead (receiver can call the dedicated deliveries
  API to fetch attempt detail).

## Capabilities

### Modified Capabilities

- `realtime-and-events`: rate-limit semantics consistent across
  quotas; PATCH cannot re-tenant; missing rate-counter wiring fails
  at boot; missing auth context returns a typed 401; outbound headers
  no longer leak the threshold-probe signal.

## Impact

- **Affected code**:
  `services/webhook-engine/src/webhook-quota.mjs`,
  `services/webhook-engine/actions/webhook-management.mjs`,
  `services/webhook-engine/actions/webhook-delivery-worker.mjs`.
- **Migration**: ops must wire `pg.incrementRateCounter` (a shared
  Postgres sliding-window counter); document the SQL helper in PR.
- **Breaking changes**: deployments relying on the in-memory rate
  counter will crash at boot. Receivers parsing
  `x-platform-webhook-attempt` will stop seeing the header.
- **Out of scope**: signing / payload fixes
  (`fix-f3-signing-and-payload-truncation`), SSRF & secret defaults
  (`fix-f3-ssrf-and-default-secrets`).
