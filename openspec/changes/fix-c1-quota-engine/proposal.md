## Why

The quota engine in `services/provisioning-orchestrator/` has three confirmed bugs plus two majors that compromise correctness of effective-limit reporting, multi-workspace sub-quota math, and sweep progress. From `openspec/audit/cap-c1-plan-tenant-provisioning.md`:

- **B2.1** (`quota-audit-query.mjs:9`) — `dimensionKey` filter is applied to enforcement logs but not to override events (the override-events table has no `dimension_key`). A caller asking for one dimension's audit history receives all the tenant's override events.
- **B2.2** (`workspace-sub-quota-repository.mjs:50`) — the in-memory branch has no locking; the `getTotalAllocatedExcluding + push` pair races under concurrent upserts, bypassing the SERIALIZABLE check the Postgres branch performs.
- **B2.3** (`quota-override-expiry-sweep.mjs:2`) — the loop breaks after `batchSize` expired overrides without recording offset; the next invocation re-scans the same prefix and never progresses past the first batch.
- **G11** — `quota_overrides` and `workspace_sub_quotas` lack FK to `tenants`/`workspaces` (migrations 103 & 105) — orphan rows are permitted.
- **G14** — `tenant-effective-entitlements-get` 500ms consumption timeout silently returns `unknown` usage status without logging.

Together these mean we mis-report override audit history, allow oversubscription under load, and have a sweep that wastes work.

## What Changes

- Add a dedicated `dimension_key` column (or denormalised tag) on override events so `quota-audit-query` can filter override events by dimension.
- Guard the in-memory `workspace-sub-quota-repository` branch with a per-tenant mutex so it cannot violate the SERIALIZABLE invariant the SQL branch enforces.
- Rewrite `quota-override-expiry-sweep` to advance using a cursor (last seen `expires_at, id`) and bound by total iterations rather than break-after-first-batch.
- Add FK constraints with `ON DELETE CASCADE` from `quota_overrides` and `workspace_sub_quotas` to `tenants`/`workspaces`.
- Emit a structured `tenant.entitlements.consumption_timed_out` log line whenever the 500ms consumption timeout returns `unknown`.

## Capabilities

### Modified Capabilities

- `quota-and-billing`: tightens dimension-scoped audit, sub-quota concurrency, sweep progress, referential integrity, and consumption-timeout observability.

## Impact

- Affected code: `services/provisioning-orchestrator/src/actions/quota-audit-query.mjs`, `services/provisioning-orchestrator/src/repositories/workspace-sub-quota-repository.mjs`, `services/provisioning-orchestrator/src/actions/quota-override-expiry-sweep.mjs`, `services/provisioning-orchestrator/src/actions/tenant-effective-entitlements-get.mjs`, `services/provisioning-orchestrator/migrations/`.
- Migrations: yes — add `dimension_key` to override-events table; add FK from `quota_overrides`/`workspace_sub_quotas` to `tenants`/`workspaces`.
- Breaking changes: callers that consumed cross-dimension override events from `quota-audit-query` will see a narrower result set.
- Out of scope: override grace-margin semantics (B2.4), inconsistency dedup distribution (B2.5), serialization-failure handling (B2.7).
