## Why

`workspace-sub-quota-repository.mjs::getTotalAllocatedExcluding` (lines 17-23) issues, on its real-Postgres path:

```
SELECT COALESCE(SUM(allocated_value), 0) AS total
  FROM workspace_sub_quotas
 WHERE tenant_id = $1 AND dimension_key = $2 AND workspace_id <> $3
 FOR UPDATE
```

PostgreSQL rejects `FOR UPDATE` combined with an aggregate function with `ERROR: FOR UPDATE is not allowed with aggregate functions` (SQLSTATE `0A000`). This query runs inside `upsertSubQuota` for **every** `workspace-sub-quota-set` write, so the action returns HTTP 500 on real Postgres and the per-tenant over-allocation guard (the `SUB_QUOTA_EXCEEDS_TENANT_LIMIT` 422 path) never executes — a workspace can never be assigned a sub-quota, and the noisy-neighbor quota-isolation control is inoperative in production.

The defect was masked because the repository's unit/integration tests inject an in-memory store (`pgClient._workspaceSubQuotas !== undefined`) that bypasses this SQL entirely; it was surfaced by running the real action against real Postgres in the `tests/env` HTTP request-chain slice.

## What Changes

- Keep the author's intended pessimistic row lock but make it legal: move `FOR UPDATE` onto a non-aggregate inner subquery that selects the sibling rows, and apply `SUM(...)` in the outer query. This both takes the row locks (preventing concurrent over-allocation) and computes the total, without combining `FOR UPDATE` with an aggregate.
- No behavior change to the in-memory-store branch.
- No change to the `upsertSubQuota` `SERIALIZABLE` transaction or the limit-comparison logic.

## Capabilities

### Modified Capabilities

- `tenant-provisioning`: Workspace sub-quota allocation enforces the tenant effective limit against the database (the over-allocation check executes successfully on PostgreSQL instead of erroring on `SUM ... FOR UPDATE`).

## Impact

- `services/provisioning-orchestrator/src/repositories/workspace-sub-quota-repository.mjs::getTotalAllocatedExcluding` (lines 17-23)
- Exercised by `services/provisioning-orchestrator/src/actions/workspace-sub-quota-set.mjs::main`
- Real-stack reproduction: `tests/env/e2e-smoke/run.sh` steps [31]-[34] and `tests/env/e2e-smoke/workspace-sub-quota-http-slice.spec.ts`
